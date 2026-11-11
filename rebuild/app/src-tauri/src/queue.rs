//! Serialized FIFO write queue and shutdown drain for vault mutations.
//!
//! Write commands reserve a monotonic ticket synchronously at IPC ingress (`wrap_handler` /
//! `dispatch_ingress`) before `#[tauri::command(async)]` spawns its task on Tauri's async runtime.
//! The spawned task claims that ticket via `CommandArg for WriteTicket` (`take_ingress`) and
//! submits the mutation closure (`WriteTicket::submit`), returning a non-blocking `Reply` future
//! resolved by the dedicated `"vault-write"` worker thread.
//!
//! On shutdown (`on_exit_requested`, `shutdown`, or `Drop`), the queue seals ingress, cancels any
//! unclaimed or unsubmitted reservations (`Slot::Reserved -> Slot::Skip`), drains all accepted
//! `Slot::Job` entries and the currently running job in FIFO order, and joins the worker thread.

use crate::AppState;
use std::collections::BTreeMap;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::pin::Pin;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};
use std::thread::{self, JoinHandle, ThreadId};
use tauri::Manager;

enum Slot {
    Reserved,
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
    worker_thread: Option<ThreadId>,
}

#[derive(Default)]
pub(crate) struct QueueShared {
    worker: Mutex<WorkerState>,
    ready: Condvar,
    handle: Mutex<Option<JoinHandle<()>>>,
}

pub(crate) struct WriteQueue {
    pub(crate) shared: Arc<QueueShared>,
}

pub(crate) struct WriteTicket {
    shared: Arc<QueueShared>,
    ticket: Option<u64>,
    submitted: bool,
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
                Some(Slot::Reserved) | None => {
                    if w.closing && w.slots.is_empty() {
                        w.drained = true;
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

    pub(crate) fn dispatch_ingress_shared(
        shared: &Arc<QueueShared>,
        is_write: bool,
        key: usize,
        handler: impl FnOnce() -> bool,
    ) -> bool {
        if !is_write {
            return handler();
        }
        Self::reserve_ingress_shared(shared, key);
        let handled = handler();
        if !handled {
            Self::cancel_ingress_shared(shared, key);
        }
        handled
    }

    #[cfg(test)]
    pub(crate) fn dispatch_ingress(&self, cmd: &str, key: usize, handler: impl FnOnce() -> bool) -> bool {
        Self::dispatch_ingress_shared(&self.shared, Self::is_write_command(cmd), key, handler)
    }

    pub(crate) fn reserve_ingress_shared(shared: &QueueShared, key: usize) {
        let mut w = lock_m(&shared.worker);
        if w.closing {
            return;
        }
        let ticket = w.next_ticket;
        w.next_ticket += 1;
        w.slots.insert(ticket, Slot::Reserved);
        if let Some(old) = w.ingress.insert(key, ticket) {
            if matches!(w.slots.get(&old), Some(Slot::Reserved)) {
                w.slots.insert(old, Slot::Skip);
                shared.ready.notify_one();
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn reserve_ingress(&self, key: usize) {
        Self::reserve_ingress_shared(&self.shared, key);
    }

    pub(crate) fn cancel_ingress_shared(shared: &QueueShared, key: usize) {
        let mut w = lock_m(&shared.worker);
        if let Some(ticket) = w.ingress.remove(&key) {
            if matches!(w.slots.get(&ticket), Some(Slot::Reserved)) {
                w.slots.insert(ticket, Slot::Skip);
                drop(w);
                shared.ready.notify_one();
            }
        }
    }

    pub(crate) fn take_ingress(&self, key: usize) -> WriteTicket {
        let mut w = lock_m(&self.shared.worker);
        if w.closing {
            return WriteTicket {
                shared: Arc::clone(&self.shared),
                ticket: None,
                submitted: true,
            };
        }
        if let Some(ticket) = w.ingress.remove(&key) {
            return WriteTicket {
                shared: Arc::clone(&self.shared),
                ticket: Some(ticket),
                submitted: false,
            };
        }
        if key == 0 {
            let ticket = w.next_ticket;
            w.next_ticket += 1;
            w.slots.insert(ticket, Slot::Reserved);
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

    /// Seal ingress, cancel any unclaimed/unsubmitted reservations, and report whether all
    /// accepted jobs and the running job have already finished.
    pub(crate) fn begin_shutdown(shared: &QueueShared) -> bool {
        let mut w = lock_m(&shared.worker);
        if !w.closing {
            w.closing = true;
            w.ingress.clear();
            for slot in w.slots.values_mut() {
                if matches!(slot, Slot::Reserved) {
                    *slot = Slot::Skip;
                }
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
        prevent_exit();
        let should_spawn = {
            let mut w = lock_m(&self.shared.worker);
            if w.exit_waiter_spawned {
                false
            } else {
                w.exit_waiter_spawned = true;
                true
            }
        };
        if should_spawn {
            let shared = Arc::clone(&self.shared);
            let exit_code = code.unwrap_or(0);
            let mut req = Some(request_exit);
            if thread::Builder::new()
                .name("vault-write-drain".into())
                .spawn({
                    let shared = Arc::clone(&shared);
                    let f = req.take().unwrap();
                    move || {
                        Self::shutdown_shared(&shared);
                        f(exit_code);
                    }
                })
                .is_err()
            {
                Self::shutdown_shared(&shared);
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
        if w.closing || !matches!(w.slots.get(&ticket), Some(Slot::Reserved)) {
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

impl Drop for WriteTicket {
    fn drop(&mut self) {
        if !self.submitted {
            if let Some(ticket) = self.ticket {
                let mut w = lock_m(&self.shared.worker);
                if matches!(w.slots.get(&ticket), Some(Slot::Reserved)) {
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
