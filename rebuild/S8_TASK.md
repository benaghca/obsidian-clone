# S8: Real-app test coverage and a CI job for Grove

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is **finding 16**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s8-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

## In plain words

Grove's automated feel tests run in headless Chromium against a mock backend. Nothing automated covers the real Rust backend with the real WebKitGTK webview, and GitHub Actions only runs the older Cinder checks at the repo root. Add a CI job that builds and tests Grove itself, and — if you can do it without new packages and without opening a visible window — a headless real-app smoke that exercises the actual backend (save, close/flush, or rename). The running app on a person's machine should not look or behave differently.

## Problem

Fable finding 16:

- No automated end-to-end run covers IPC, main-thread blocking, close-and-flush, or the watcher reaching the page. Those are where findings 2–5 live.
- CI covers only Cinder. `.github/workflows/ci.yml` runs the root `cargo test` and `ui/` checks. Nothing runs Grove's `npm test`, type check, or `rebuild/app/src-tauri` tests.
- Suggested fix: a WebKitGTK smoke for save, close, and rename, plus a CI job for `rebuild/app`.

## Goal

**No visible behavior change.** This piece is tests, scripts, and CI only. Do not change app behavior, layout, shortcuts, look, or theme to make tests easier.

Do both of the following if you can; if a true WebKitGTK / Tauri window smoke cannot be done without new packages or a visible window, still land (1) and write in the notes what blocked (2).

1. **CI job for Grove.** Extend `.github/workflows/ci.yml` (preferred: add a separate job so Cinder and Grove can fail independently) so a push or pull request also, in `rebuild/app`:
   - installs the same kind of system libraries Grove already needs (the existing Cinder job already installs WebKitGTK 4.1 and related dev packages — reuse that pattern),
   - sets up Node and Rust,
   - runs Grove's type check if there is an existing script, otherwise `npx tsc --noEmit` / the project's current checker,
   - runs `npm test` (including `posttest`) and `cargo test --offline` in `src-tauri`,
   - does not require new npm packages or crates.
   Keep the existing Cinder job working. Cache Rust/node where the current workflow already does, if easy.

2. **Headless real-app smoke, if feasible with tools already on the machine or in CI.** Prefer driving the Rust backend and IPC without opening a GUI window (a Rust integration test, or a Tauri/WebKit path that is truly headless). If a display is required, use only a virtual/headless display that does **not** open visible windows on Cloud (no Hyprland clients, no `grove` / `npx tauri dev` window the user would see). Chromium is already installed on Cloud; `xvfb-run` may not be. Do not add Playwright, WebdriverIO, or other new packages. A first smoke can be narrow: write a note through the real backend, or close/flush, or rename, in a temp vault under `/tmp`.

You may add a small script under `rebuild/app/scripts/` and, if useful, a dedicated `package.json` script. Prefer **not** appending a long or flaky smoke onto the existing `npm test` `&&` chain (Fable noted that chain already hides later failures). CI can call the script directly.

## File ownership (do not fight the other builders)

- You own `.github/workflows/ci.yml`, new scripts under `rebuild/app/scripts/` (and maybe `rebuild/app/src-tauri/tests/` or a new Rust test file), and a narrow `package.json` script addition if needed.
- Do **not** change application source to land this, except a tiny test-only hook if a smoke is otherwise impossible — and explain it in the notes. Prefer zero production-code edits.
- Do **not** edit `src/shell/sidebar.ts` (S7), `src/vault.ts` (S9), or S1's save-loop files.
- Do **not** edit `src/links/internal.ts`, `src/editor/livePreview.ts`, `src/shell/searchRead.ts`, `src/shell/searchView.ts`, or the Rust link resolver in `index.rs` (L1). The earlier S6 brief was withdrawn for that reason.
- Do **not** rewrite S3/S4/S5 Rust command or vault/index behavior. A new Rust test file that only *uses* the existing API is fine.

## Tests

- The new CI job definition is valid YAML and the commands it runs succeed locally (from `rebuild/app`, with `flock /tmp/grove-npm-test.lock` around `npm test`).
- If you add a real-app smoke, it fails when the thing it checks is broken (show this, even if by temporarily breaking a hook) and passes after, and it creates no windows and no files outside `/tmp` (plus the repo's usual `target/` / test output).
- Do not weaken any existing assertion. Restore any screenshots the suite rewrites before committing.

## Hard rules

- Do not edit Cinder application code at the repo root (`ui/`, `src/`). The existing Cinder CI job stays. You may edit `.github/workflows/ci.yml`.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network during local test runs except what `npm ci` in a *documented CI-only* step would need on GitHub. Locally, `npm run audit:offline` must stay green if you touch anything it covers. Do not `npm install` new packages.
- **No GUI windows on Cloud.** Do not start Grove, Tauri, or a visible browser. Do not run `npx tauri dev` or `grove` in a way that opens a window. A virtual framebuffer is allowed only if it stays invisible.
- Test vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`) and `cargo test --offline` in `src-tauri` must still pass. Run `npm run build` and `npm run audit:offline` if you change app sources or CI scripts that assume them.
- Commit locally on `rebuild/s8-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest CI job and, if feasible, the smallest headless smoke. Do not rewrite the 95-script `npm test` chain in this piece (Fable mentioned a better runner; that can be a follow-up).
- Keep new scripts modest. No new dependency.

## Scope limits

**In scope:** Grove CI job, optional headless real-backend smoke, notes.

**Out of scope:** changing save/close/index/sidebar/link behavior; a visible test window; new packages; the unmerged T1 tabs work; rewriting the npm test runner; opening the real app on the desktop.

## Done when

- CI would run Grove's tests/build as well as Cinder's.
- Either a headless real-app/backend smoke exists and passes, or the notes explain clearly why it was not feasible without new packages or a window, and CI still landed.
- Existing suites pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S8-grok.md` before you finish, and commit it with the code. Include:

- In plain words: what CI now runs, what (if any) real-app smoke exists, and confirmation that nothing visible in the app changed.
- How you ran the new job's commands locally, and how you proved a smoke fails before / passes after if you added one.
- Net line change by language and by file; any new dependency (should be none); anything that still is not covered.
