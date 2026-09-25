//! The vault file API and the embedded UI, independent of how requests arrive
//! (native window custom protocol, or the localhost server in --browser mode).

use serde_json::{Value, json};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------- embedded UI

const INDEX_HTML: &str = include_str!("../ui/index.html");
const APP_JS: &str = include_str!("../ui/app.js");
const GRAPH_JS: &str = include_str!("../ui/graph.js");
const DRAW_JS: &str = include_str!("../ui/draw.js");
const THEMES_JS: &str = include_str!("../ui/themes.js");
const DRAW_RENDER_JS: &str = include_str!("../ui/draw-render.js");
const STYLE_CSS: &str = include_str!("../ui/style.css");
const MARKED_JS: &str = include_str!("../ui/vendor/marked.min.js");
const PURIFY_JS: &str = include_str!("../ui/vendor/purify.min.js");
const EDITOR_JS: &str = include_str!("../ui/vendor/editor.bundle.js");
const VIRGIL_WOFF2: &[u8] = include_bytes!("../ui/vendor/Virgil.woff2");

/// Everything the page may load comes from Folio itself; nothing else is allowed.
pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
                       img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; \
                       object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

pub const MAX_BODY: u64 = 64 * 1024 * 1024;

pub struct Ctx {
    pub vault: RwLock<PathBuf>,
    pub token: String,
    pub native: bool,
}

impl Ctx {
    pub fn vault(&self) -> PathBuf {
        self.vault.read().unwrap().clone()
    }
}

/// A transport-neutral response.
pub struct Out {
    pub status: u16,
    pub ctype: &'static str,
    pub body: Vec<u8>,
    pub csp: bool,
}

type ApiResult = Result<Out, (u16, String)>;

fn out(status: u16, ctype: &'static str, body: Vec<u8>) -> Out {
    Out { status, ctype, body, csp: false }
}
pub fn text(status: u16, s: &str) -> Out {
    out(status, "text/plain; charset=utf-8", s.as_bytes().to_vec())
}
fn json_out(status: u16, v: Value) -> Out {
    out(status, "application/json", v.to_string().into_bytes())
}

// ---------------------------------------------------------------- routing

/// Handle one request. `header` looks up a request header (case-insensitive).
pub fn dispatch(ctx: &Ctx, method: &str, path: &str, query: &str, header: &dyn Fn(&str) -> Option<String>, body: Vec<u8>) -> Out {
    let q = |k: &str| query_param(query, k);

    if method == "GET" {
        match path {
            "/" | "/index.html" => {
                let vault = ctx.vault();
                let name = vault.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "vault".into());
                let html = INDEX_HTML
                    .replace("{{TOKEN}}", &ctx.token)
                    .replace("{{VAULT}}", &html_escape(&name))
                    .replace("{{MODE}}", if ctx.native { "native" } else { "browser" });
                let mut o = out(200, "text/html; charset=utf-8", html.into_bytes());
                o.csp = true;
                return o;
            }
            "/app.js" => return out(200, "text/javascript", APP_JS.into()),
            "/graph.js" => return out(200, "text/javascript", GRAPH_JS.into()),
            "/draw.js" => return out(200, "text/javascript", DRAW_JS.into()),
            "/themes.js" => return out(200, "text/javascript", THEMES_JS.into()),
            "/draw-render.js" => return out(200, "text/javascript", DRAW_RENDER_JS.into()),
            "/style.css" => return out(200, "text/css", STYLE_CSS.into()),
            "/vendor/marked.min.js" => return out(200, "text/javascript", MARKED_JS.into()),
            "/vendor/purify.min.js" => return out(200, "text/javascript", PURIFY_JS.into()),
            "/vendor/editor.bundle.js" => return out(200, "text/javascript", EDITOR_JS.into()),
            "/vendor/Virgil.woff2" => return out(200, "font/woff2", VIRGIL_WOFF2.to_vec()),
            _ => {}
        }
    }

    if !path.starts_with("/api/") {
        return text(404, "not found");
    }

    // A per-launch token only the served page knows. Custom header for fetch();
    // query param only for /api/raw (used by <img src>).
    let tok_ok = header("X-Folio-Token").as_deref() == Some(ctx.token.as_str())
        || (path == "/api/raw" && q("t").as_deref() == Some(ctx.token.as_str()));
    if !tok_ok {
        return text(401, "bad token");
    }
    if body.len() as u64 > MAX_BODY {
        return json_out(413, json!({ "error": "too large" }));
    }

    let vault = ctx.vault();
    let parse = |b: &[u8]| serde_json::from_slice::<Value>(b).map_err(|e| (400, e.to_string()));
    let result: ApiResult = match (method, path) {
        ("GET", "/api/list") => api_list(&vault),
        ("GET", "/api/info") => Ok(json_out(200, json!({ "vault": vault.display().to_string(), "native": ctx.native }))),
        ("POST", "/api/read") => parse(&body).and_then(|v| {
            let paths = v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            api_read(&vault, paths)
        }),
        ("GET", "/api/raw") => api_raw(&vault, &q("path").unwrap_or_default()),
        ("PUT", "/api/file") => {
            let base = header("X-Base-Mtime").and_then(|s| s.parse::<u64>().ok());
            api_write(&vault, &q("path").unwrap_or_default(), &body, base)
        }
        ("POST", "/api/rename") => parse(&body).and_then(|v| api_rename(&vault, &str_field(&v, "from")?, &str_field(&v, "to")?)),
        ("POST", "/api/delete") => parse(&body).and_then(|v| api_delete(&vault, &str_field(&v, "path")?)),
        ("POST", "/api/mkdir") => parse(&body).and_then(|v| api_mkdir(&vault, &str_field(&v, "path")?)),
        ("POST", "/api/vault") => parse(&body).and_then(|v| api_switch_vault(ctx, &str_field(&v, "path")?)),
        _ => Err((404, "no such endpoint".into())),
    };
    result.unwrap_or_else(|(code, msg)| json_out(code, json!({ "error": msg })))
}

fn str_field(v: &Value, k: &str) -> Result<String, (u16, String)> {
    v.get(k).and_then(|x| x.as_str()).map(String::from).ok_or((400, format!("missing field {k}")))
}

// ---------------------------------------------------------------- handlers

fn api_list(vault: &Path) -> ApiResult {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    walk(vault, vault, &mut files, &mut dirs);
    Ok(json_out(200, json!({ "files": files, "dirs": dirs })))
}

fn walk(root: &Path, dir: &Path, files: &mut Vec<Value>, dirs: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // .trash, .obsidian, .git, temp files
        }
        if e.file_type().is_ok_and(|t| t.is_symlink()) {
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        let p = e.path();
        let rel = rel_path(root, &p);
        if md.is_dir() {
            dirs.push(rel);
            walk(root, &p, files, dirs);
        } else if md.is_file() {
            files.push(json!({ "path": rel, "mtime": mtime_ms(&md), "size": md.len() }));
        }
    }
}

fn api_read(vault: &Path, paths: Vec<String>) -> ApiResult {
    let mut res = serde_json::Map::new();
    for p in paths {
        let full = resolve(vault, &p)?;
        if let (Ok(s), Ok(md)) = (fs::read(&full), fs::metadata(&full)) {
            res.insert(p, json!({ "content": String::from_utf8_lossy(&s), "mtime": mtime_ms(&md) }));
        }
    }
    Ok(json_out(200, Value::Object(res)))
}

fn api_raw(vault: &Path, p: &str) -> ApiResult {
    let full = resolve(vault, p)?;
    let data = fs::read(&full).map_err(|e| (404, e.to_string()))?;
    Ok(out(200, mime_for(p), data))
}

fn api_write(vault: &Path, p: &str, body: &[u8], base: Option<u64>) -> ApiResult {
    let full = resolve(vault, p)?;
    if let (Some(base), Ok(md)) = (base, fs::metadata(&full)) {
        let disk = mtime_ms(&md);
        if disk != base {
            return Err((409, format!("changed on disk ({disk})")));
        }
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    // Atomic write: temp file in the same folder, then rename over the target.
    let name = full.file_name().unwrap().to_string_lossy().to_string();
    let tmp = full.with_file_name(format!(".{name}.folio-tmp"));
    fs::write(&tmp, body).map_err(io_err)?;
    fs::rename(&tmp, &full).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_err(e)
    })?;
    let md = fs::metadata(&full).map_err(io_err)?;
    Ok(json_out(200, json!({ "mtime": mtime_ms(&md) })))
}

fn api_rename(vault: &Path, from_rel: &str, to_rel: &str) -> ApiResult {
    let from = resolve(vault, from_rel)?;
    let to = resolve(vault, to_rel)?;
    if !from.exists() {
        return Err((404, "source missing".into()));
    }
    let same_ignoring_case = from_rel.to_lowercase() == to_rel.to_lowercase();
    if to.exists() && !same_ignoring_case {
        return Err((409, "a file with that name already exists".into()));
    }
    if to.starts_with(&from) && from != to && !same_ignoring_case {
        return Err((400, "can't move a folder into itself".into()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    fs::rename(&from, &to).map_err(io_err)?;
    Ok(json_out(200, json!({ "ok": true })))
}

fn api_delete(vault: &Path, p: &str) -> ApiResult {
    // Never hard-delete: move into <vault>/.trash, like Obsidian's default.
    let full = resolve(vault, p)?;
    if !full.exists() {
        return Err((404, "missing".into()));
    }
    let mut dest = vault.join(".trash").join(p);
    if dest.exists() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let name = dest.file_name().unwrap().to_string_lossy().to_string();
        dest = dest.with_file_name(format!("{stamp} {name}"));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    fs::rename(&full, &dest).map_err(io_err)?;
    Ok(json_out(200, json!({ "ok": true })))
}

fn api_mkdir(vault: &Path, p: &str) -> ApiResult {
    let full = resolve(vault, p)?;
    fs::create_dir_all(full).map_err(io_err)?;
    Ok(json_out(200, json!({ "ok": true })))
}

fn api_switch_vault(ctx: &Ctx, path: &str) -> ApiResult {
    let p = PathBuf::from(path.trim().trim_matches('"'));
    if !p.is_absolute() {
        return Err((400, "use a full path, e.g. C:\\Users\\you\\Documents\\Notes".into()));
    }
    fs::create_dir_all(&p).map_err(io_err)?;
    let p = canonical(&p).map_err(io_err)?;
    if !p.is_dir() {
        return Err((400, "not a folder".into()));
    }
    *ctx.vault.write().unwrap() = p.clone();
    crate::config::remember_vault(&p);
    Ok(json_out(200, json!({ "vault": p.display().to_string() })))
}

// ---------------------------------------------------------------- path safety

/// Canonicalize without Windows' `\\?\` prefix where possible.
pub fn canonical(p: &Path) -> std::io::Result<PathBuf> {
    let c = fs::canonicalize(p)?;
    #[cfg(windows)]
    {
        let s = c.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return Ok(PathBuf::from(rest));
            }
        }
    }
    Ok(c)
}

/// Map a vault-relative "a/b/c.md" path to a real path, refusing anything that
/// could escape the vault or touch hidden files.
pub fn resolve(vault: &Path, rel: &str) -> Result<PathBuf, (u16, String)> {
    let bad = || (400, format!("invalid path: {rel}"));
    if rel.is_empty() || rel.contains('\\') || rel.contains(':') || rel.contains('\0') {
        return Err(bad());
    }
    let mut res = vault.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                if s.starts_with('.') || s.trim().is_empty() {
                    return Err(bad());
                }
                res.push(&*s);
            }
            _ => return Err(bad()), // .., ., root, prefix
        }
    }
    // Refuse to walk through symlinks that point outside the vault.
    let mut probe = res.clone();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    if let Ok(real) = canonical(&probe) {
        if !real.starts_with(vault) {
            return Err(bad());
        }
    }
    Ok(res)
}

fn rel_path(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

// ---------------------------------------------------------------- helpers

fn mtime_ms(md: &fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn io_err(e: std::io::Error) -> (u16, String) {
    (500, e.to_string())
}

pub fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (percent_decode(k) == key).then(|| percent_decode(v))
    })
}

pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut res = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => res.push(b' '),
            b'%' if i + 2 < b.len() => {
                match std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        res.push(v);
                        i += 2;
                    }
                    None => res.push(b'%'),
                }
            }
            c => res.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&res).into_owned()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn mime_for(p: &str) -> &'static str {
    let ext = p.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "md" | "txt" | "csv" | "json" | "excalidraw" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode() {
        assert_eq!(percent_decode("a%20b+c%2Fd"), "a b c/d");
        assert_eq!(percent_decode("%E2%9C%93"), "✓");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%4"), "%4");
    }

    #[test]
    fn serves_drawing_assets() {
        let ctx = Ctx { vault: RwLock::new(std::env::temp_dir()), token: "t".into(), native: true };
        let get = |p: &str| dispatch(&ctx, "GET", p, "", &|_| None, Vec::new());
        for (p, ctype) in [("/themes.js", "text/javascript"), ("/draw.js", "text/javascript"), ("/draw-render.js", "text/javascript"), ("/vendor/Virgil.woff2", "font/woff2")] {
            let o = get(p);
            assert_eq!((o.status, o.ctype), (200, ctype), "{p}");
            assert!(!o.body.is_empty(), "{p}");
        }
        let page = String::from_utf8(get("/").body).unwrap();
        assert!(page.contains("/draw.js") && page.contains("/draw-render.js") && page.contains("id=\"view-drawing\""));
    }

    #[test]
    fn resolve_rejects_escapes() {
        let v = canonical(&std::env::temp_dir()).unwrap();
        for bad in ["../x.md", "/etc/passwd", "a/../../x", ".trash/x.md", "a/.git/config", "C:/x", "a\\b", ""] {
            assert!(resolve(&v, bad).is_err(), "{bad}");
        }
        assert!(resolve(&v, "Notes/Hello world.md").is_ok());
    }
}
