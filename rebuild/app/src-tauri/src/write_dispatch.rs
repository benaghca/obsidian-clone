//! Write-command bodies, spawned by `wrap_handler` with an [`IngressLease`] in the future.
//!
//! The lease is captured when the future is built, so dropping the task before its first poll
//! skips the reservation. `take_ingress` then hands that ownership to `WriteTicket` for the rest
//! of argument parsing and `submit`.

use crate::queue::IngressLease;
use crate::{
    create_folder, create_note, create_vault, delete_path, open_vault, rename_path, set_property,
    write_config, write_file_bytes, write_note, AppState,
};
use tauri::ipc::{CommandArg, CommandItem, InvokeError, InvokeResponseBody, IpcResponse};
use tauri::{Manager, State};

type Acl = Option<Vec<tauri::utils::acl::resolved::ResolvedCommand>>;
type Msg = tauri::ipc::InvokeMessage<tauri::Wry>;

pub(crate) async fn run(
    lease: IngressLease,
    message: Msg,
    acl: Acl,
    key: usize,
) -> Result<InvokeResponseBody, InvokeError> {
    let _lease = lease;
    let cmd = message.command().to_string();
    let ticket = message
        .webview_ref()
        .state::<AppState>()
        .write_queue
        .take_ingress(key);
    match cmd.as_str() {
        "open_vault" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "open_vault", "state")?;
            let path = arg::<String>(&message, &acl, "open_vault", "path")?;
            settle(open_vault(ticket, state, path).await)
        }
        "create_vault" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "create_vault", "state")?;
            let path = arg::<String>(&message, &acl, "create_vault", "path")?;
            settle(create_vault(ticket, state, path).await)
        }
        "write_note" => {
            let window = arg::<tauri::Window>(&message, &acl, "write_note", "window")?;
            let state = arg::<State<'_, AppState>>(&message, &acl, "write_note", "state")?;
            let path = arg::<String>(&message, &acl, "write_note", "path")?;
            let content = arg::<String>(&message, &acl, "write_note", "content")?;
            settle(write_note(ticket, window, state, path, content).await)
        }
        "set_property" => {
            let window = arg::<tauri::Window>(&message, &acl, "set_property", "window")?;
            let state = arg::<State<'_, AppState>>(&message, &acl, "set_property", "state")?;
            let path = arg::<String>(&message, &acl, "set_property", "path")?;
            let edit = arg::<crate::edit::PropertyEdit>(&message, &acl, "set_property", "edit")?;
            let dry_run = arg::<Option<bool>>(&message, &acl, "set_property", "dryRun")?;
            settle(set_property(ticket, window, state, path, edit, dry_run).await)
        }
        "write_file_bytes" => {
            let window = arg::<tauri::Window>(&message, &acl, "write_file_bytes", "window")?;
            let state = arg::<State<'_, AppState>>(&message, &acl, "write_file_bytes", "state")?;
            let request =
                arg::<tauri::ipc::Request>(&message, &acl, "write_file_bytes", "request")?;
            settle(write_file_bytes(ticket, window, state, request).await)
        }
        "create_note" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "create_note", "state")?;
            let path = arg::<String>(&message, &acl, "create_note", "path")?;
            let content = arg::<String>(&message, &acl, "create_note", "content")?;
            settle(create_note(ticket, state, path, content).await)
        }
        "create_folder" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "create_folder", "state")?;
            let path = arg::<String>(&message, &acl, "create_folder", "path")?;
            settle(create_folder(ticket, state, path).await)
        }
        "rename_path" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "rename_path", "state")?;
            let from = arg::<String>(&message, &acl, "rename_path", "from")?;
            let to = arg::<String>(&message, &acl, "rename_path", "to")?;
            settle(rename_path(ticket, state, from, to).await)
        }
        "delete_path" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "delete_path", "state")?;
            let path = arg::<String>(&message, &acl, "delete_path", "path")?;
            let permanent = arg::<Option<bool>>(&message, &acl, "delete_path", "permanent")?;
            settle(delete_path(ticket, state, path, permanent).await)
        }
        "write_config" => {
            let state = arg::<State<'_, AppState>>(&message, &acl, "write_config", "state")?;
            let name = arg::<String>(&message, &acl, "write_config", "name")?;
            let content = arg::<String>(&message, &acl, "write_config", "content")?;
            settle(write_config(ticket, state, name, content).await)
        }
        _ => Err(InvokeError::from(format!("unknown write command {cmd}"))),
    }
}

fn arg<'a, T>(
    message: &'a Msg,
    acl: &'a Acl,
    name: &'static str,
    key: &'static str,
) -> Result<T, InvokeError>
where
    T: CommandArg<'a, tauri::Wry>,
{
    T::from_command(CommandItem {
        plugin: None,
        name,
        key,
        message,
        acl,
    })
}

fn settle<T: serde::Serialize>(
    result: Result<T, String>,
) -> Result<InvokeResponseBody, InvokeError> {
    IpcResponse::body(result.map_err(InvokeError::from)?).map_err(InvokeError::from)
}
