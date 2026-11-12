# 9R fix 2: search request ids survive a reload

A vault switch reloads the page. The search reader started its request counter at 0 again, while Rust kept the per-window maximum from the previous document. The first searches after the reload were rejected as `cancelled`, and the view showed no rows or "Could not read search results."

The page now keeps one counter for that window in `sessionStorage` (`grove.searchRequest`). Each query and each cancel takes the next id and stores it before the call is sent. A reloaded document reads that stored value and continues from it. Rust still stores an id only when it is strictly newer, and a reload or vault install leaves the window's maximum in place, so a request already in flight from the previous document cannot take the slot from the new page.

The search view, the result order, and the unlinked-mentions `search` command are unchanged. No new IPC name and no new dependency.

## Tests

`a_reloaded_page_search_returns_every_row_while_an_old_request_is_delayed` keeps the process search state. The previous document's last search is paused before it claims. A restarted id of 1 returns `cancelled`. The next id returns all four matching notes, the same rows as a direct walk. Releasing the paused request returns `cancelled` and leaves the stored id at the newer one.

The page test recreates the search reader the way a reload does, with the previous scan still pending. The new reader's first `searchNotes` uses a higher id, and its rows are shown. The old promise's `cancelled` rejection does not fail the new query.

`cargo test --offline` in `rebuild/app/src-tauri`: 202 passed, 0 failed, 5 ignored. Binary and doc tests had nothing to execute. The same two pre-existing `file_map` warnings remain (`ValueWalk` never constructed; `Files::len` and `Files::values` unused).

`npx vitest run src/readOrdering.test.ts` in `rebuild/app`: 19 passed. The desktop app was not opened.
