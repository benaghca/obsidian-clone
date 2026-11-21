//! The page's link reads (`link_index`, `link_changes`, `backlinks`) without long holds of the
//! vault lock (review 3).
//!
//! A write that queues a large link update returns at once (`Index::settle_links`). A read
//! first resolves the queue (`settle`), in jobs whose resolution runs off the lock and whose
//! results are stored only if no file or map changed meanwhile (`index::link_jobs`), then
//! builds its reply in steps that each copy a bounded number of shared entries under the read
//! lock (`index::link_replies`). Before each hold it lets any waiting writer go first, so a save
//! queued behind a read waits for one bounded step at most.
//!
//! The reply equals the table, settled, at one version: what `Index::link_changes` and
//! `Index::backlinks` return when called at once.

use crate::index::{BacklinkReply, Index, LinkReply, LinkSlice, ReplyStep};
use crate::model::{Backlink, LinkChanges, LinkIndex};
use crate::{lock, read, Inner, WRITERS_WAITING};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, RwLock};

const NO_VAULT: &str = "no vault open";

/// One settler at a time: two would only resolve the same notes twice.
static SETTLER: Mutex<()> = Mutex::new(());

/// Wait (briefly, up to 50 ms) while any writer is queued for the lock.
fn writers_first() {
    for _ in 0..500 {
        if WRITERS_WAITING.load(Ordering::SeqCst) == 0 {
            return;
        }
        std::thread::sleep(std::time::Duration::from_micros(100));
    }
}

#[cfg(test)]
thread_local! {
    static LONGEST: std::cell::Cell<std::time::Duration> = const { std::cell::Cell::new(std::time::Duration::ZERO) };
}

/// Tests: the longest step of a reply or a publish on this thread that held the lock (resets).
#[cfg(test)]
pub(crate) fn take_longest_hold() -> std::time::Duration {
    LONGEST.with(|l| l.replace(std::time::Duration::ZERO))
}

fn held(_started: std::time::Instant) {
    #[cfg(test)]
    LONGEST.with(|l| l.set(l.get().max(_started.elapsed())));
}

/// Resolve every queued note (see `index::link_jobs`).
pub(crate) fn settle(inner: &RwLock<Inner>) -> Result<(), String> {
    let _one = SETTLER.lock().unwrap_or_else(|e| e.into_inner());
    'job: loop {
        writers_first();
        let started = std::time::Instant::now();
        let job = lock(inner).vault.as_mut().ok_or(NO_VAULT)?.index.link_job();
        held(started);
        let Some(mut job) = job else {
            return Ok(());
        };
        job.ask();
        loop {
            writers_first();
            let started = std::time::Instant::now();
            let got = read(inner).vault.as_ref().ok_or(NO_VAULT)?.index.answer(&mut job);
            held(started);
            match got {
                LinkSlice::Done => break,
                LinkSlice::More => {}
                LinkSlice::Stale => continue 'job,
            }
        }
        job.finish();
        loop {
            writers_first();
            let started = std::time::Instant::now();
            let got = lock(inner).vault.as_mut().ok_or(NO_VAULT)?.index.publish(&mut job);
            held(started);
            match got {
                LinkSlice::Done => break,
                LinkSlice::More => {}
                LinkSlice::Stale => continue 'job,
            }
        }
    }
}

/// Step a reply under the read lock until it is done, settling when it asks. `absorb` merges
/// each step's copy after the lock is released; `between` runs then too (tests edit there).
fn reply(inner: &RwLock<Inner>, mut step: impl FnMut(&Index) -> ReplyStep, mut absorb: impl FnMut(), between: &mut dyn FnMut()) -> Result<(), String> {
    loop {
        writers_first();
        let started = std::time::Instant::now();
        let next = step(&read(inner).vault.as_ref().ok_or(NO_VAULT)?.index);
        held(started);
        absorb();
        between();
        match next {
            ReplyStep::Done => return Ok(()),
            ReplyStep::More => {}
            ReplyStep::Settle => settle(inner)?,
        }
    }
}

pub(crate) fn link_index(inner: &RwLock<Inner>) -> Result<LinkIndex, String> {
    let reply = std::cell::RefCell::new(LinkReply::new(None));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb(), &mut || {})?;
    Ok(reply.into_inner().into_index())
}

pub(crate) fn link_changes(inner: &RwLock<Inner>, since: Option<(u64, u64)>) -> Result<LinkChanges, String> {
    let reply = std::cell::RefCell::new(LinkReply::new(since));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb(), &mut || {})?;
    Ok(reply.into_inner().into_changes())
}

pub(crate) fn backlinks(inner: &RwLock<Inner>, paths: &[String]) -> Result<BTreeMap<String, Vec<Backlink>>, String> {
    backlinks_stepping(inner, paths, &mut || {})
}

/// `backlinks`, running `between` after each step with the lock released (tests edit there).
pub(crate) fn backlinks_stepping(inner: &RwLock<Inner>, paths: &[String], between: &mut dyn FnMut()) -> Result<BTreeMap<String, Vec<Backlink>>, String> {
    let reply = std::cell::RefCell::new(BacklinkReply::new(paths));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb(), between)?;
    Ok(reply.into_inner().finish())
}
