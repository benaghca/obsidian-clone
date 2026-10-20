# Rebuild front end

Vite + TypeScript + CodeMirror 6, no UI framework. See `../CONTRACT.md` and `../OBSIDIAN_FEEL_SPEC.md`.

```sh
npm install
npm run dev     # http://localhost:1420, runs against the in-memory mock vault
npm test        # unit tests (parser, counts, fuzzy matching)
npm run build   # type-check + production bundle in dist/
```

Outside Tauri, `src/api.ts` loads `src/mock/backend.ts` instead of calling `invoke`. The mock vault resets on reload and includes a generated 5,000-line note ("Big note"). In dev builds the workspace is exposed as `window.ws` for poking at from devtools.

## Layout

- `src/api.ts`: the only module that talks to the backend (contract commands and the `vault-changed` event).
- `src/workspace.ts`: tabs, back/forward history, one `EditorState` per open note, debounced saves.
- `src/editor/`: CodeMirror setup, Live Preview decorations, wikilink/tag parsing, `[[` suggester, word counts.
- `src/shell/`: ribbon, sidebar, pane (tab strip, sub-header, inline title), quick switcher, menus.
- `src/styles/`: theme tokens, chrome, editor styles.

## Notes for `src-tauri/` (owned by the backend)

- Dev server: `devUrl` `http://localhost:1420`, `beforeDevCommand` `npm run dev`, `frontendDist` `../dist`, `beforeBuildCommand` `npm run build`.
- The window is meant to be frameless (`decorations: false`). The tab strip carries `data-tauri-drag-region`, and inside Tauri the front end draws minimize/maximize/close buttons. That needs the `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close` permissions.
- External links open with `window.open`; Tauri may need the opener plugin for that.
