//! Serialized FIFO write queue and shutdown drain for vault mutations.
//!
//! Write commands reserve a monotonic ticket synchronously at IPC ingress (`wrap_handler` /
//! `arm_accepted`) and move the `IngressLease` into the future passed to
//! `respond_async_serialized`, before that future is polled. The slot is `Slot::Pending` while
//! the lease is held. The task claims it with `take_ingress` and submits the mutation
//! (`WriteTicket::submit`), returning a non-blocking `Reply` future resolved by the dedicated
//! `"vault-write"` worker thread.
//!
//! On shutdown (`on_exit_requested`, `shutdown`, or `Drop`), the queue seals new ingress and
//! cancels only reservations that can no longer run: bare unclaimed `Slot::Reserved` tickets, a
//! dropped `IngressLease` (the handler future is gone before `take_ingress`), or a dropped
//! `WriteTicket` (claimed, never submitted). A save accepted before shutdown is waited out and
//! written. Nothing is skipped because a timer fired. Jobs then drain in FIFO order and the
//! worker thread is joined.

use crate::AppState;
use std::collections::BTreeMap;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};
use std::thread::{self, JoinHandle, ThreadId};
use tauri::Manager;

enum Slot {
    Reserved,
    Pending,
    Job(Box<dyn FnOnce() + Send>),
    Skip,
}

#[derive(Default)]
struct WorkerState {
    turn: u64,
    next_ticket: u64,
    ingress: BTreeMap<usize, u64>,
    slots: BTreeMap<u64, Slot>,
    running: bool,
    closing: bool,
    drained: bool,
    exit_waiter_spawned: bool,
    drain_thread_active: bool,
    /// `true` while an `IngressLease` still owns this ticket (accepted, not yet claimed).
    owners: BTreeMap<u64, Arc<AtomicBool>>,
    pending_exit: Option<(i32, Box<dyn FnOnce(i32) + Send>)>,
    worker_thread: Option<ThreadId>,
}

#[derive(Default)]
pub(crate) struct QueueShared {
    worker: Mutex<WorkerState>,
    ready: Condvar,
    handle: Mutex<Option<JoinHandle<()>>>,
    #[cfg(test)]
    pub(crate) fail_drain_spawn: std::sync::atomic::AtomicBool,
}

pub(crate) struct WriteQueue {
    pub(crate) shared: Arc<QueueShared>,
}

pub(crate) struct WriteTicket {
    shared: Arc<QueueShared>,
    ticket: Option<u64>,
    submitted: bool,
}

/// Owns an accepted reservation until `take_ingress` claims it.
/// Dropping it skips the slot: the handler is gone and will never submit.
pub(crate) struct IngressLease {
    shared: Arc<QueueShared>,
    ticket: u64,
    live: Arc<AtomicBool>,
}

#[cfg(test)]
pub(crate) struct IngressDispatch {
    pub handled: bool,
    pub lease: Option<IngressLease>,
}

struct ReplyState<T> {
    value: Option<T>,
    waker: Option<Waker>,
}

pub(crate) struct Reply<T>(Arc<Mutex<ReplyState<T>>>);

fn lock_m<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl<T> Reply<T> {
    pub(crate) fn ready(value: T) -> Self {
        Self(Arc::new(Mutex::new(ReplyState {
            value: Some(value),
            waker: None,
        })))
    }
}

impl<T> Future for Reply<T> {
    type Output = T;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut s = lock_m(&self.0);
        if let Some(v) = s.value.take() {
            Poll::Ready(v)
        } else {
            s.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

impl Default for WriteQueue {
    fn default() -> Self {
        let shared = Arc::new(QueueShared::default());
        let w = Arc::clone(&shared);
        let handle = thread::Builder::new()
            .name("vault-write".into())
            .spawn(move || worker_loop(w))
            .expect("vault-write");
        *lock_m(&shared.handle) = Some(handle);
        Self { shared }
    }
}

impl Drop for WriteQueue {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn worker_loop(shared: Arc<QueueShared>) {
    lock_m(&shared.worker).worker_thread = Some(thread::current().id());
    let mut fallback_exit = None;
    while let Some(run) = {
        let mut w = lock_m(&shared.worker);
        loop {
            let turn = w.turn;
            match w.slots.get(&turn) {
                Some(Slot::Job(_)) => {
                    let Some(Slot::Job(job)) = w.slots.remove(&turn) else {
                        unreachable!()
                    };
                    w.turn += 1;
                    w.running = true;
                    break Some(job);
                }
                Some(Slot::Skip) => {
                    w.slots.remove(&turn);
                    w.turn += 1;
                }
                // Reserved: handler not finished accepting, or a bare reserve.
                // Pending: accepted lease still held, or a WriteTicket not yet submitted.
                // Only a drop of that owner turns the slot into Skip.
                Some(Slot::Reserved | Slot::Pending) => {
                    w = shared.ready.wait(w).unwrap_or_else(|e| e.into_inner());
                }
                None => {
                    if w.closing && w.slots.is_empty() {
                        w.drained = true;
                        if !w.drain_thread_active {
                            fallback_exit = w.pending_exit.take();
                        }
                        break None;
                    }
                    w = shared.ready.wait(w).unwrap_or_else(|e| e.into_inner());
                }
            }
        }
    } {
        struct RunGuard<'a>(&'a QueueShared);
        impl Drop for RunGuard<'_> {
            fn drop(&mut self) {
                let mut w = lock_m(&self.0.worker);
                w.running = false;
                self.0.ready.notify_all();
            }
        }
        let _guard = RunGuard(&shared);
        run();
    }
    if let Some((code, req)) = fallback_exit {
        req(code);
    }
}

impl WriteQueue {
    pub(crate) fn is_write_command(cmd: &str) -> bool {
        matches!(
            cmd,
            "open_vault"
                | "create_vault"
                | "write_note"
                | "set_property"
                | "write_file_bytes"
                | "create_note"
                | "create_folder"
                | "rename_path"
                | "delete_path"
                | "write_config"
        )
    }

    #[cfg(test)]
    fn dispatch_ingress_shared(
        shared: &Arc<QueueShared>,
        is_write: bool,
        key: usize,
        handler: impl FnOnce() -> bool,
    ) -> IngressDispatch {
        if !is_write {
            return IngressDispatch {
                handled: handler(),
                lease: None,
            };
        }
        let Some(lease) = Self::arm_lease(shared, key, false) else {
            return IngressDispatch {
                handled: handler(),
                lease: None,
            };
        };
        let handled = handler();
        if !handled {
            drop(lease);
            return IngressDispatch {
                handled: false,
                lease: None,
            };
        }
        Self::activate_ingress_shared(shared, key);
        IngressDispatch {
            handled: true,
            lease: Some(lease),
        }
    }

    /// Reserve the next ticket and hand the caller an `IngressLease` that owns it until
    /// `take_ingress`. `pending` marks the handler as already accepted.
    fn arm_lease(shared: &Arc<QueueShared>, key: usize, pending: bool) -> Option<IngressLease> {
        let mut w = lock_m(&shared.worker);
        if w.closing {
            return None;
        }
        let ticket = w.next_ticket;
        w.next_ticket += 1;
        let live = Arc::new(AtomicBool::new(true));
        w.slots.insert(
            ticket,
            if pending {
                Slot::Pending
            } else {
                Slot::Reserved
            },
        );
        w.owners.insert(ticket, Arc::clone(&live));
        if let Some(old) = w.ingress.insert(key, ticket) {
            Self::supersede(&mut w, old);
            shared.ready.notify_one();
        }
        Some(IngressLease {
            shared: Arc::clone(shared),
            ticket,
            live,
        })
    }

    /// IPC accepted this write. The returned lease must be moved into the handler future.
    pub(crate) fn arm_accepted(shared: &Arc<QueueShared>, key: usize) -> Option<IngressLease> {
        Self::arm_lease(shared, key, true)
    }

    fn supersede(w: &mut WorkerState, ticket: u64) {
        if let Some(live) = w.owners.remove(&ticket) {
            live.store(false, Ordering::SeqCst);
        }
        if matches!(w.slots.get(&ticket), Some(Slot::Reserved | Slot::Pending)) {
            w.slots.insert(ticket, Slot::Skip);
        }
    }

    #[cfg(test)]
    pub(crate) fn dispatch_ingress(
        &self,
        cmd: &str,
        key: usize,
        handler: impl FnOnce() -> bool,
    ) -> IngressDispatch {
        Self::dispatch_ingress_shared(&self.shared, Self::is_write_command(cmd), key, handler)
    }

    #[cfg(test)]
    pub(crate) fn reserve_ingress_shared(shared: &QueueShared, key: usize) {
        let mut w = lock_m(&shared.worker);
        if w.closing {
            return;
        }
        let ticket = w.next_ticket;
        w.next_ticket += 1;
        w.slots.insert(ticket, Slot::Reserved);
        if let Some(old) = w.ingress.insert(key, ticket) {
            if matches!(w.slots.get(&old), Some(Slot::Reserved | Slot::Pending)) {
                w.slots.insert(old, Slot::Skip);
                shared.ready.notify_one();
            }
        }
    }

    #[cfg(test)]
    fn activate_ingress_shared(shared: &QueueShared, key: usize) {
        let mut w = lock_m(&shared.worker);
        if let Some(&ticket) = w.ingress.get(&key) {
            if matches!(w.slots.get(&ticket), Some(Slot::Reserved)) {
                w.slots.insert(ticket, Slot::Pending);
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn reserve_ingress(&self, key: usize) {
        Self::reserve_ingress_shared(&self.shared, key);
    }

    pub(crate) fn take_ingress(&self, key: usize) -> WriteTicket {
        let mut w = lock_m(&self.shared.worker);
        if let Some(ticket) = w.ingress.remove(&key) {
            if matches!(w.slots.get(&ticket), Some(Slot::Reserved | Slot::Pending)) {
                if let Some(live) = w.owners.remove(&ticket) {
                    live.store(false, Ordering::SeqCst);
                }
                w.slots.insert(ticket, Slot::Pending);
                return WriteTicket {
                    shared: Arc::clone(&self.shared),
                    ticket: Some(ticket),
                    submitted: false,
                };
            }
        }
        if !w.closing && key == 0 {
            let ticket = w.next_ticket;
            w.next_ticket += 1;
            w.slots.insert(ticket, Slot::Pending);
            return WriteTicket {
                shared: Arc::clone(&self.shared),
                ticket: Some(ticket),
                submitted: false,
            };
        }
        WriteTicket {
            shared: Arc::clone(&self.shared),
            ticket: None,
            submitted: true,
        }
    }

    /// Seal new ingress. Bare `Slot::Reserved` entries with no lease are skipped. Accepted
    /// leases and claimed tickets stay until their owner submits or drops.
    pub(crate) fn begin_shutdown(shared: &QueueShared) -> bool {
        let mut w = lock_m(&shared.worker);
        if !w.closing {
            w.closing = true;
            let dead: Vec<u64> = w
                .slots
                .iter()
                .filter_map(|(&ticket, slot)| {
                    let owned = w
                        .owners
                        .get(&ticket)
                        .is_some_and(|live| live.load(Ordering::SeqCst));
                    (matches!(slot, Slot::Reserved) && !owned).then_some(ticket)
                })
                .collect();
            for ticket in dead {
                w.slots.insert(ticket, Slot::Skip);
                w.ingress.retain(|_, t| *t != ticket);
                w.owners.remove(&ticket);
            }
            shared.ready.notify_all();
        }
        !w.running && w.slots.is_empty()
    }

    pub(crate) fn shutdown_shared(shared: &QueueShared) {
        Self::begin_shutdown(shared);
        if lock_m(&shared.worker).worker_thread == Some(thread::current().id()) {
            return;
        }
        let mut guard = lock_m(&shared.handle);
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    pub(crate) fn shutdown(&self) {
        Self::shutdown_shared(&self.shared);
    }

    /// Coordinate Tauri `RunEvent::ExitRequested` without blocking the GTK main thread or holding
    /// the vault/queue locks while jobs finish. Returns `true` when exit may proceed immediately.
    pub(crate) fn on_exit_requested(
        &self,
        code: Option<i32>,
        prevent_exit: impl FnOnce(),
        request_exit: impl FnOnce(i32) + Send + 'static,
    ) -> bool {
        if Self::begin_shutdown(&self.shared) {
            self.shutdown();
            return true;
        }
        let exit_code = code.unwrap_or(0);
        let req_box: Box<dyn FnOnce(i32) + Send> = Box::new(request_exit);
        let should_spawn = {
            let mut w = lock_m(&self.shared.worker);
            if w.drained {
                None
            } else {
                w.pending_exit = Some((exit_code, req_box));
                if w.exit_waiter_spawned {
                    Some(false)
                } else {
                    w.exit_waiter_spawned = true;
                    w.drain_thread_active = true;
                    Some(true)
                }
            }
        };
        let Some(should_spawn) = should_spawn else {
            self.shutdown();
            return true;
        };
        prevent_exit();
        if should_spawn {
            let shared = Arc::clone(&self.shared);
            #[cfg(test)]
            let force_fail = self
                .shared
                .fail_drain_spawn
                .swap(false, std::sync::atomic::Ordering::SeqCst);
            #[cfg(not(test))]
            let force_fail = false;
            let spawned = if force_fail {
                Err(std::io::Error::other("injected drain spawn failure"))
            } else {
                thread::Builder::new()
                    .name("vault-write-drain".into())
                    .spawn(move || {
                        Self::shutdown_shared(&shared);
                        let pending = lock_m(&shared.worker).pending_exit.take();
                        if let Some((c, f)) = pending {
                            f(c);
                        }
                    })
            };
            if spawned.is_err() {
                let finished_pending = {
                    let mut w = lock_m(&self.shared.worker);
                    w.drain_thread_active = false;
                    w.exit_waiter_spawned = false;
                    if w.drained {
                        w.pending_exit.take()
                    } else {
                        None
                    }
                };
                if let Some((c, f)) = finished_pending {
                    self.shutdown();
                    f(c);
                }
            }
        }
        false
    }

    #[cfg(test)]
    pub(crate) fn is_terminated(&self) -> bool {
        lock_m(&self.shared.worker).drained && lock_m(&self.shared.handle).is_none()
    }
}

impl WriteTicket {
    pub(crate) fn submit<T: Send + 'static>(
        mut self,
        f: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Reply<Result<T, String>> {
        self.submitted = true;
        let Some(ticket) = self.ticket else {
            return Reply::ready(Err("vault write queue is closed".into()));
        };
        let mut w = lock_m(&self.shared.worker);
        if !matches!(w.slots.get(&ticket), Some(Slot::Reserved | Slot::Pending)) {
            return Reply::ready(Err("vault write queue is closed".into()));
        }
        let reply = Arc::new(Mutex::new(ReplyState {
            value: None,
            waker: None,
        }));
        let out = Reply(Arc::clone(&reply));
        let job = Box::new(move || {
            let val = match catch_unwind(AssertUnwindSafe(f)) {
                Ok(v) => v,
                Err(_) => Err("vault write worker panicked".into()),
            };
            let waker = {
                let mut s = lock_m(&reply);
                s.value = Some(val);
                s.waker.take()
            };
            if let Some(wk) = waker {
                wk.wake();
            }
        });
        w.slots.insert(ticket, Slot::Job(job));
        drop(w);
        self.shared.ready.notify_one();
        out
    }
}

impl Drop for IngressLease {
    fn drop(&mut self) {
        let mut w = lock_m(&self.shared.worker);
        if !self.live.swap(false, Ordering::SeqCst) {
            return;
        }
        w.owners.remove(&self.ticket);
        if matches!(
            w.slots.get(&self.ticket),
            Some(Slot::Reserved | Slot::Pending)
        ) {
            w.slots.insert(self.ticket, Slot::Skip);
            w.ingress.retain(|_, t| *t != self.ticket);
            drop(w);
            self.shared.ready.notify_one();
        }
    }
}

impl Drop for WriteTicket {
    fn drop(&mut self) {
        if !self.submitted {
            if let Some(ticket) = self.ticket {
                let mut w = lock_m(&self.shared.worker);
                if matches!(w.slots.get(&ticket), Some(Slot::Reserved | Slot::Pending)) {
                    w.slots.insert(ticket, Slot::Skip);
                    drop(w);
                    self.shared.ready.notify_one();
                }
            }
        }
    }
}

pub(crate) fn invoke_key<R: tauri::Runtime>(msg: &tauri::ipc::InvokeMessage<R>) -> usize {
    msg.command().as_ptr() as usize
}

impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for WriteTicket {
    fn from_command(cmd: tauri::ipc::CommandItem<'de, R>) -> Result<Self, tauri::ipc::InvokeError> {
        Ok(cmd
            .message
            .webview_ref()
            .state::<AppState>()
            .write_queue
            .take_ingress(invoke_key(cmd.message)))
    }
}
