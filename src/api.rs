//! The vault file API and the embedded UI, independent of how requests arrive
//! (native window custom protocol, or the localhost server in --browser mode).

use serde_json::{Value, json};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------- embedded UI

const INDEX_HTML: &str = include_str!("../ui/index.html");
// The front end's own code lives in pieces (ui/app/*.js, one per concern) that are joined here,
// in this order, into one script. They share one scope exactly as a single file would, so
// there's no module loader and no build step: add a piece by adding it to this list.
const APP_JS: &str = concat!(
    include_str!("../ui/app/core.js"),
    include_str!("../ui/app/vault-index.js"),
    include_str!("../ui/app/navigation.js"),
    include_str!("../ui/app/drawings.js"),
    include_str!("../ui/app/window.js"),
    include_str!("../ui/app/tabs.js"),
    include_str!("../ui/app/canvases.js"),
    include_str!("../ui/app/bases.js"),
    include_str!("../ui/app/tasks.js"),
    include_str!("../ui/app/markdown.js"),
    include_str!("../ui/app/file-tree.js"),
    include_str!("../ui/app/files.js"),
    include_str!("../ui/app/templates.js"),
    include_str!("../ui/app/editor.js"),
    include_str!("../ui/app/properties.js"),
    include_str!("../ui/app/link-embeds.js"),
    include_str!("../ui/app/images.js"),
    include_str!("../ui/app/dialogs.js"),
    include_str!("../ui/app/commands.js"),
    include_str!("../ui/app/settings.js"),
    include_str!("../ui/app/vaults.js"),
    include_str!("../ui/app/appearance.js"),
    include_str!("../ui/app/panels.js"),
    include_str!("../ui/app/graph.js"),
    include_str!("../ui/app/actions.js"),
    include_str!("../ui/app/native-ui.js"),
    include_str!("../ui/app/boot.js"),
);
const GRAPH_JS: &str = include_str!("../ui/graph.js");
const DRAW_JS: &str = include_str!("../ui/draw.js");
const THEMES_JS: &str = include_str!("../ui/themes.js");
const TEMPLATER_JS: &str = include_str!("../ui/templater.js");
const CANVAS_JS: &str = include_str!("../ui/canvas.js");
const BASES_JS: &str = include_str!("../ui/bases.js");
const TASKS_JS: &str = include_str!("../ui/tasks.js");
const IMAGES_JS: &str = include_str!("../ui/images.js");
const PROPERTIES_JS: &str = include_str!("../ui/properties.js");
const LOGO_SVG: &str = include_str!("../ui/logo.svg");
const DRAW_RENDER_JS: &str = include_str!("../ui/draw-render.js");
const STYLE_CSS: &str = include_str!("../ui/style.css");
const MARKED_JS: &str = include_str!("../ui/vendor/marked.min.js");
const PURIFY_JS: &str = include_str!("../ui/vendor/purify.min.js");
const EDITOR_JS: &str = include_str!("../ui/vendor/editor.bundle.js");
/// Fonts and data files served as-is from /vendor/.
const VENDOR_FILES: &[(&str, &str, &[u8])] = &[
    ("Virgil.woff2", "font/woff2", include_bytes!("../ui/vendor/Virgil.woff2")),
    ("SymbolsNerdFontMono.woff2", "font/woff2", include_bytes!("../ui/vendor/SymbolsNerdFontMono.woff2")),
    ("JetBrainsMono-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/JetBrainsMono-Regular.woff2")),
    ("JetBrainsMono-Bold.woff2", "font/woff2", include_bytes!("../ui/vendor/JetBrainsMono-Bold.woff2")),
    ("JetBrainsMono-Italic.woff2", "font/woff2", include_bytes!("../ui/vendor/JetBrainsMono-Italic.woff2")),
    ("JetBrainsMono-BoldItalic.woff2", "font/woff2", include_bytes!("../ui/vendor/JetBrainsMono-BoldItalic.woff2")),
    ("nerd-icons.txt", "text/plain; charset=utf-8", include_bytes!("../ui/vendor/nerd-icons.txt")),
    // KaTeX (math), its mhchem extension, and its fonts
    ("katex/katex.min.js", "text/javascript", include_bytes!("../ui/vendor/katex/katex.min.js")),
    ("katex/mhchem.min.js", "text/javascript", include_bytes!("../ui/vendor/katex/mhchem.min.js")),
    ("katex/katex.min.css", "text/css", include_bytes!("../ui/vendor/katex/katex.min.css")),
    ("katex/fonts/KaTeX_AMS-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_AMS-Regular.woff2")),
    ("katex/fonts/KaTeX_Caligraphic-Bold.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2")),
    ("katex/fonts/KaTeX_Caligraphic-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2")),
    ("katex/fonts/KaTeX_Fraktur-Bold.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2")),
    ("katex/fonts/KaTeX_Fraktur-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2")),
    ("katex/fonts/KaTeX_Main-Bold.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Main-Bold.woff2")),
    ("katex/fonts/KaTeX_Main-BoldItalic.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2")),
    ("katex/fonts/KaTeX_Main-Italic.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Main-Italic.woff2")),
    ("katex/fonts/KaTeX_Main-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Main-Regular.woff2")),
    ("katex/fonts/KaTeX_Math-BoldItalic.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2")),
    ("katex/fonts/KaTeX_Math-Italic.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Math-Italic.woff2")),
    ("katex/fonts/KaTeX_SansSerif-Bold.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2")),
    ("katex/fonts/KaTeX_SansSerif-Italic.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2")),
    ("katex/fonts/KaTeX_SansSerif-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2")),
    ("katex/fonts/KaTeX_Script-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Script-Regular.woff2")),
    ("katex/fonts/KaTeX_Size1-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Size1-Regular.woff2")),
    ("katex/fonts/KaTeX_Size2-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Size2-Regular.woff2")),
    ("katex/fonts/KaTeX_Size3-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Size3-Regular.woff2")),
    ("katex/fonts/KaTeX_Size4-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Size4-Regular.woff2")),
    ("katex/fonts/KaTeX_Typewriter-Regular.woff2", "font/woff2", include_bytes!("../ui/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2")),
];

/// Everything the page may load comes from Cinder itself; nothing else is allowed.
pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
                       img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; \
                       object-src 'none'; frame-src http: https:; base-uri 'none'; form-action 'none'";

pub const MAX_BODY: u64 = 64 * 1024 * 1024;

pub struct Ctx {
    pub vault: RwLock<PathBuf>,
    pub token: String,
    pub native: bool,
    /// Hide (true) or show again (false) the app window; set by the desktop window.
    pub hide_window: OnceLock<Box<dyn Fn(bool) + Send + Sync>>,
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
                    .replace("{{MODE}}", if ctx.native { "native" } else { "browser" })
                    .replace("{{FRAME}}", if ctx.native && crate::native::custom_frame() { "custom" } else { "native" });
                let mut o = out(200, "text/html; charset=utf-8", html.into_bytes());
                o.csp = true;
                return o;
            }
            "/app.js" => return out(200, "text/javascript", APP_JS.into()),
            "/graph.js" => return out(200, "text/javascript", GRAPH_JS.into()),
            "/draw.js" => return out(200, "text/javascript", DRAW_JS.into()),
            "/themes.js" => return out(200, "text/javascript", THEMES_JS.into()),
            "/templater.js" => return out(200, "text/javascript", TEMPLATER_JS.into()),
            "/canvas.js" => return out(200, "text/javascript", CANVAS_JS.into()),
            "/bases.js" => return out(200, "text/javascript", BASES_JS.into()),
            "/tasks.js" => return out(200, "text/javascript", TASKS_JS.into()),
            "/images.js" => return out(200, "text/javascript", IMAGES_JS.into()),
            "/properties.js" => return out(200, "text/javascript", PROPERTIES_JS.into()),
            "/draw-render.js" => return out(200, "text/javascript", DRAW_RENDER_JS.into()),
            "/style.css" => return out(200, "text/css", STYLE_CSS.into()),
            "/logo.svg" => return out(200, "image/svg+xml", LOGO_SVG.into()),
            "/vendor/marked.min.js" => return out(200, "text/javascript", MARKED_JS.into()),
            "/vendor/purify.min.js" => return out(200, "text/javascript", PURIFY_JS.into()),
            "/vendor/editor.bundle.js" => return out(200, "text/javascript", EDITOR_JS.into()),
            _ => {}
        }
        if let Some(name) = path.strip_prefix("/vendor/") {
            if let Some((_, ctype, data)) = VENDOR_FILES.iter().find(|(n, _, _)| *n == name) {
                return out(200, ctype, data.to_vec());
            }
        }
    }

    if !path.starts_with("/api/") {
        return text(404, "not found");
    }

    // A per-launch token only the served page knows. Custom header for fetch();
    // query param only for /api/raw (used by <img src>).
    let tok_ok = header("X-Cinder-Token").as_deref() == Some(ctx.token.as_str())
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
        ("POST", "/api/vault") => parse(&body).and_then(|v| api_switch_vault(ctx, &str_field(&v, "path")?, v["create"].as_bool().unwrap_or(false))),
        ("GET", "/api/vaults") => Ok(api_vaults(&vault)),
        ("POST", "/api/vaults/forget") => parse(&body).map(|v| {
            crate::config::forget_vault(v["path"].as_str().unwrap_or(""));
            api_vaults(&vault)
        }),
        ("GET", "/api/dirs") => api_dirs(&q("path").unwrap_or_default()),
        ("POST", "/api/pick-folder") => Ok(match crate::pickfolder::pick(&q("start").unwrap_or_default()) {
            crate::pickfolder::Picked::Path(p) => json_out(200, json!({ "path": p })),
            crate::pickfolder::Picked::Cancelled => out(204, "text/plain", Vec::new()),
            crate::pickfolder::Picked::NoTool => json_out(200, json!({ "path": null, "noPicker": true })), // the page browses instead
        }),
        ("GET", "/api/prop-types") => api_prop_types(&vault, None),
        ("PUT", "/api/prop-types") => parse(&body).and_then(|v| api_prop_types(&vault, Some(v))),
        ("POST", "/api/screenshot") => Ok(match screenshot(ctx, q("mode").as_deref() == Some("screen"), q("hide").as_deref() == Some("1"), q("delay").and_then(|d| d.parse().ok()).unwrap_or(0)) {
            crate::screenshot::Shot::Png(png) => out(200, "image/png", png),
            crate::screenshot::Shot::Cancelled => out(204, "text/plain", Vec::new()),
            crate::screenshot::Shot::NoTool(msg) => json_out(501, json!({ "error": msg })),
        }),
        _ => Err((404, "no such endpoint".into())),
    };
    result.unwrap_or_else(|(code, msg)| json_out(code, json!({ "error": msg })))
}

/// Capture the screen, optionally with the app window out of the way and after a few seconds
/// (to set up a menu or hover state).
fn screenshot(ctx: &Ctx, screen: bool, hide: bool, delay_s: u64) -> crate::screenshot::Shot {
    let hider = if hide { ctx.hide_window.get() } else { None };
    if let Some(h) = hider {
        h(true);
        std::thread::sleep(std::time::Duration::from_millis(350)); // let the compositor catch up
    }
    if delay_s > 0 {
        std::thread::sleep(std::time::Duration::from_secs(delay_s.min(10)));
    }
    let shot = crate::screenshot::capture(screen);
    if let Some(h) = hider {
        h(false);
    }
    shot
}

/// Requests that can take a long time (waiting on the user), which transports should answer
/// off their main thread.
pub fn is_slow(path: &str) -> bool {
    path == "/api/screenshot" || path == "/api/pick-folder"
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
            files.push(json!({ "path": rel, "mtime": mtime_ms(&md), "ctime": ctime_ms(&md), "size": md.len() }));
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
    let tmp = full.with_file_name(format!(".{name}.cinder-tmp"));
    fs::write(&tmp, body).map_err(io_err)?;
    fs::rename(&tmp, &full).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_err(e)
    })?;
    let md = fs::metadata(&full).map_err(io_err)?;
    Ok(json_out(200, json!({ "mtime": mtime_ms(&md) })))
}

/// Obsidian keeps property types (text, number, date…) in .obsidian/types.json. This is the one
/// file under .obsidian Cinder touches: it reads the "types" map, and a PUT merges names into it
/// (a null type removes one), keeping everything else. Only when the vault already has an
/// .obsidian folder; otherwise 404 and the page keeps types in its own settings.
fn api_prop_types(vault: &Path, update: Option<Value>) -> ApiResult {
    let dir = vault.join(".obsidian");
    let file = dir.join("types.json");
    let is_real_dir = fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir());
    if !is_real_dir {
        return match update {
            None => Ok(json_out(200, json!({ "types": {}, "obsidian": false }))),
            Some(_) => Err((404, "no .obsidian folder".into())),
        };
    }
    let mut doc: Value = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}));
    if !doc.is_object() {
        doc = json!({});
    }
    if !doc["types"].is_object() {
        doc["types"] = json!({});
    }
    if let Some(update) = update {
        let Some(changes) = update.as_object() else { return Err((400, "expected an object".into())) };
        let types = doc["types"].as_object_mut().expect("types is an object");
        for (k, v) in changes {
            match v {
                Value::Null => {
                    types.remove(k);
                }
                Value::String(t) if !k.is_empty() && t.len() <= 32 => {
                    types.insert(k.clone(), Value::String(t.clone()));
                }
                _ => return Err((400, format!("bad type for {k}"))),
            }
        }
        let text = serde_json::to_string_pretty(&doc).map_err(|e| (500, e.to_string()))?;
        let tmp = dir.join(".types.json.cinder-tmp");
        fs::write(&tmp, text).map_err(io_err)?;
        fs::rename(&tmp, &file).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            io_err(e)
        })?;
    }
    Ok(json_out(200, json!({ "types": doc["types"], "obsidian": true })))
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

/// Switch to the folder at `path` (made first when `create`; otherwise it has to exist).
fn api_switch_vault(ctx: &Ctx, path: &str, create: bool) -> ApiResult {
    let p = PathBuf::from(path.trim().trim_matches('"'));
    if !p.is_absolute() {
        return Err((400, "use a full path, e.g. C:\\Users\\you\\Documents\\Notes".into()));
    }
    if create {
        if p.exists() && fs::read_dir(&p).map(|mut d| d.next().is_some()).unwrap_or(false) {
            return Err((409, format!("{} already exists and isn't empty", p.display())));
        }
        fs::create_dir_all(&p).map_err(io_err)?;
    } else if !p.is_dir() {
        return Err((404, format!("there's no folder at {}", p.display())));
    }
    let p = canonical(&p).map_err(io_err)?;
    if !p.is_dir() {
        return Err((400, "not a folder".into()));
    }
    *ctx.vault.write().unwrap() = p.clone();
    crate::config::remember_vault(&p);
    Ok(json_out(200, json!({ "vault": p.display().to_string() })))
}

/// The vault in use and the recent ones, for the switcher.
fn api_vaults(current: &Path) -> Out {
    let cur = current.display().to_string();
    let name = |p: &str| Path::new(p).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string());
    let recent: Vec<Value> = crate::config::recent_vaults()
        .iter()
        .map(|p| json!({ "path": p, "name": name(p), "exists": Path::new(p).is_dir(), "current": p == &cur }))
        .collect();
    json_out(200, json!({ "current": cur, "name": name(&cur), "recent": recent, "sep": std::path::MAIN_SEPARATOR.to_string(), "home": home_dir().display().to_string() }))
}

fn home_dir() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// The folders inside `path` (the home folder when empty), for the switcher's own folder browser
/// when the system has no picker. Names only, hidden ones left out.
fn api_dirs(path: &str) -> ApiResult {
    let p = if path.trim().is_empty() { home_dir() } else { PathBuf::from(path.trim()) };
    if !p.is_absolute() {
        return Err((400, "use a full path".into()));
    }
    let rd = fs::read_dir(&p).map_err(|e| (404, format!("can't open {}: {e}", p.display())))?;
    let mut dirs: Vec<String> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() || (t.is_symlink() && e.path().is_dir())))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with('.') && !n.starts_with('$'))
        .take(3000)
        .collect();
    dirs.sort_by_key(|a| a.to_lowercase());
    let roots: Vec<String> = if cfg!(windows) {
        (b'A'..=b'Z').map(|c| format!("{}:\\", c as char)).filter(|d| Path::new(d).is_dir()).collect()
    } else {
        vec!["/".into()]
    };
    let has_notes = fs::read_dir(&p).map(|d| d.flatten().any(|e| e.path().extension().is_some_and(|x| x == "md"))).unwrap_or(false);
    Ok(json_out(200, json!({
        "path": p.display().to_string(),
        "parent": p.parent().map(|x| x.display().to_string()),
        "dirs": dirs, "roots": roots, "home": home_dir().display().to_string(), "hasNotes": has_notes,
        "isVault": p.join(".obsidian").is_dir() || has_notes,
    })))
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

/// Creation time where the filesystem records one, else the modification time.
fn ctime_ms(md: &fs::Metadata) -> u64 {
    md.created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_else(|| mtime_ms(md))
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
        "md" | "txt" | "csv" | "json" | "excalidraw" | "canvas" | "base" => "text/plain; charset=utf-8",
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
        let ctx = Ctx { vault: RwLock::new(std::env::temp_dir()), token: "t".into(), native: true, hide_window: OnceLock::new() };
        let get = |p: &str| dispatch(&ctx, "GET", p, "", &|_| None, Vec::new());
        for (p, ctype) in [("/themes.js", "text/javascript"), ("/templater.js", "text/javascript"), ("/canvas.js", "text/javascript"), ("/bases.js", "text/javascript"), ("/tasks.js", "text/javascript"), ("/images.js", "text/javascript"), ("/properties.js", "text/javascript"), ("/logo.svg", "image/svg+xml"), ("/draw.js", "text/javascript"), ("/draw-render.js", "text/javascript"), ("/vendor/Virgil.woff2", "font/woff2"), ("/vendor/SymbolsNerdFontMono.woff2", "font/woff2"), ("/vendor/JetBrainsMono-BoldItalic.woff2", "font/woff2"), ("/vendor/nerd-icons.txt", "text/plain; charset=utf-8"), ("/vendor/katex/katex.min.js", "text/javascript"), ("/vendor/katex/katex.min.css", "text/css"), ("/vendor/katex/fonts/KaTeX_Main-Regular.woff2", "font/woff2")] {
            let o = get(p);
            assert_eq!((o.status, o.ctype), (200, ctype), "{p}");
            assert!(!o.body.is_empty(), "{p}");
        }
        let page = String::from_utf8(get("/").body).unwrap();
        assert!(page.contains("/draw.js") && page.contains("/draw-render.js") && page.contains("id=\"view-drawing\""));
    }

    #[test]
    fn app_js_includes_every_piece() {
        // Each ui/app/*.js must be in the concat! list (or the app would silently lose it).
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("ui/app");
        let mut n = 0;
        for e in fs::read_dir(&dir).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".js") {
                continue;
            }
            let text = fs::read_to_string(e.path()).unwrap();
            assert!(APP_JS.contains(&text), "ui/app/{name} isn't joined into /app.js (add it to APP_JS in src/api.rs)");
            n += 1;
        }
        assert!(n > 20);
        assert!(APP_JS.trim_start().starts_with("/* Cinder") && APP_JS.contains("'use strict';"));
    }

    #[test]
    fn prop_types_merge_into_obsidian_file() {
        let dir = std::env::temp_dir().join(format!("cinder-types-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(api_prop_types(&dir, None).is_ok(), "no .obsidian: empty types");
        assert_eq!(api_prop_types(&dir, Some(json!({ "a": "text" }))).err().map(|e| e.0), Some(404), "and nothing written");
        assert!(!dir.join(".obsidian").exists());
        fs::create_dir(dir.join(".obsidian")).unwrap();
        fs::write(dir.join(".obsidian/types.json"), r#"{"types":{"due":"date","keep":"number"},"other":1}"#).unwrap();
        api_prop_types(&dir, Some(json!({ "rating": "number", "due": null }))).unwrap();
        let v: Value = serde_json::from_slice(&fs::read(dir.join(".obsidian/types.json")).unwrap()).unwrap();
        assert_eq!(v["types"], json!({ "keep": "number", "rating": "number" }));
        assert_eq!(v["other"], json!(1));
        assert!(api_prop_types(&dir, Some(json!({ "x": 5 }))).is_err());
        let _ = fs::remove_dir_all(&dir);
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
