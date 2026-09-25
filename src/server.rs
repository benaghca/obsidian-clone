//! --browser mode: serve the UI on 127.0.0.1 for a normal browser tab.

use crate::api::{self, Ctx};
use std::io::Read;
use std::sync::Arc;
use tiny_http::{Header, Request, Response, Server};

pub fn run(ctx: Ctx, port: u16, open: bool, app_window: bool) -> ! {
    let addr = format!("127.0.0.1:{port}");
    let server = Server::http(&addr)
        .unwrap_or_else(|e| crate::die(&format!("can't listen on {addr}: {e} (another copy running? try --port)")));
    let url = format!("http://127.0.0.1:{port}/");
    let allowed_hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];

    println!("Cinder (browser mode)");
    println!("  vault: {}", ctx.vault().display());
    println!("  open:  {url}");
    println!("  (Ctrl+C to quit)");
    if open {
        open_browser(&url, app_window);
    }
    let ctx = Arc::new(ctx);
    for req in server.incoming_requests() {
        // DNS-rebinding guard: only answer requests addressed to our loopback host.
        let host = header(&req, "Host").unwrap_or_default();
        if !allowed_hosts.iter().any(|h| h == &host) {
            respond(req, api::text(403, "forbidden host"));
        } else if api::is_slow(req.url().split('?').next().unwrap_or("")) {
            // A screenshot waits on the user; keep serving everything else meanwhile.
            let ctx = ctx.clone();
            std::thread::spawn(move || serve(&ctx, req));
        } else {
            serve(&ctx, req);
        }
    }
    std::process::exit(0)
}

fn serve(ctx: &Ctx, mut req: Request) {
    let mut body = Vec::new();
    let _ = req.as_reader().take(api::MAX_BODY + 1).read_to_end(&mut body);
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let method = req.method().as_str().to_ascii_uppercase();
    let lookup = |k: &str| header(&req, k);
    let o = api::dispatch(ctx, &method, path, query, &lookup, body);
    respond(req, o);
}

fn respond(req: Request, o: api::Out) {
    let mut resp = Response::from_data(o.body)
        .with_status_code(o.status)
        .with_header(hdr("Content-Type", o.ctype))
        .with_header(hdr("X-Content-Type-Options", "nosniff"))
        .with_header(hdr("Referrer-Policy", "no-referrer"))
        .with_header(hdr("Cache-Control", "no-store"));
    if o.csp {
        resp = resp.with_header(hdr("Content-Security-Policy", api::CSP));
    }
    let _ = req.respond(resp);
}

fn hdr(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn open_browser(url: &str, app: bool) {
    use std::process::Command;
    let r = if cfg!(target_os = "windows") {
        if app {
            Command::new("cmd").args(["/C", "start", "", "msedge", &format!("--app={url}")]).spawn()
        } else {
            Command::new("cmd").args(["/C", "start", "", url]).spawn()
        }
    } else if cfg!(target_os = "macos") {
        if app {
            Command::new("open").args(["-na", "Google Chrome", "--args", &format!("--app={url}")]).spawn()
        } else {
            Command::new("open").arg(url).spawn()
        }
    } else if app {
        Command::new("chromium")
            .arg(format!("--app={url}"))
            .spawn()
            .or_else(|_| Command::new("google-chrome").arg(format!("--app={url}")).spawn())
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };
    if r.is_err() {
        println!("  (couldn't open a browser — open the URL above yourself)");
    }
}
