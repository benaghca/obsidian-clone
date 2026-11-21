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

/// Resolve every queued note (see `index::link_jobs`).
pub(crate) fn settle(inner: &RwLock<Inner>) -> Result<(), String> {
    let _one = SETTLER.lock().unwrap_or_else(|e| e.into_inner());
    'job: loop {
        writers_first();
        let job = lock(inner).vault.as_mut().ok_or(NO_VAULT)?.index.link_job();
        let Some(mut job) = job else {
            return Ok(());
        };
        job.ask();
        loop {
            writers_first();
            let guard = read(inner);
            match guard.vault.as_ref().ok_or(NO_VAULT)?.index.answer(&mut job) {
                LinkSlice::Done => break,
                LinkSlice::More => {}
                LinkSlice::Stale => continue 'job,
            }
        }
        job.finish();
        writers_first();
        lock(inner).vault.as_mut().ok_or(NO_VAULT)?.index.publish(job);
    }
}

/// Step a reply under the read lock until it is done, settling when it asks. `absorb` merges
/// each step's copy after the lock is released.
fn reply(inner: &RwLock<Inner>, mut step: impl FnMut(&Index) -> ReplyStep, mut absorb: impl FnMut()) -> Result<(), String> {
    loop {
        writers_first();
        let next = step(&read(inner).vault.as_ref().ok_or(NO_VAULT)?.index);
        absorb();
        match next {
            ReplyStep::Done => return Ok(()),
            ReplyStep::More => {}
            ReplyStep::Settle => settle(inner)?,
        }
    }
}

pub(crate) fn link_index(inner: &RwLock<Inner>) -> Result<LinkIndex, String> {
    let reply = std::cell::RefCell::new(LinkReply::new(None));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb())?;
    Ok(reply.into_inner().into_index())
}

pub(crate) fn link_changes(inner: &RwLock<Inner>, since: Option<(u64, u64)>) -> Result<LinkChanges, String> {
    let reply = std::cell::RefCell::new(LinkReply::new(since));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb())?;
    Ok(reply.into_inner().into_changes())
}

pub(crate) fn backlinks(inner: &RwLock<Inner>, paths: &[String]) -> Result<BTreeMap<String, Vec<Backlink>>, String> {
    let reply = std::cell::RefCell::new(BacklinkReply::new(paths));
    self::reply(inner, |index| reply.borrow_mut().step(index), || reply.borrow_mut().absorb())?;
    Ok(reply.into_inner().finish())
}
