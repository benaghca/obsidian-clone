# S7: the file explorer builds its tree without a depth sort

Creating or renaming a note asks the file explorer to rebuild its tree. That rebuild used to sort every file by how many folders deep it sits, and the sort split each path on every comparison. The explorer now records each folder, then attaches every file to its parent, then sorts each folder's children the way it did before: folders by name, files in the selected order.

Nothing on screen changes. The same notes sit in the same folders, in the same order. Folds, the keyboard cursor, and the selection are untouched, because the row renderer was left as it is. The explorer still throws away every row when the file list changes. Reusing those elements would have to keep an inline rename, a drag, the open-folder slide, and the keyboard cursor correct while the new tree is a fresh set of nodes. That is a larger change than dropping the sort, and easy to get wrong. Tree virtualisation stays with the later P6 work.

A file listed before its folder still nests under that folder. A file whose parent folder is missing from the list stays at the vault root, including when a higher folder is present (`Zed/Missing/x.md` stays at the root). A vault scan includes parent folders, so a normal tree does not have missing parents. If two root items have names that compare equal and one of them has no parent folder in the list, the listed order is kept. The old depth sort put the shallower path first in that tie.

## Tests

`src/shell/sidebarTree.test.ts` builds the tree with vitest. No window.

I ran that file once with the old depth sort still inside `buildTree`. The shape checks passed (nested folders, root files, A to Z, Z to A, modified time both ways, a file before its folder, a missing folder, equal names). The large-list check failed:

```
expected 28760 to be +0
alphabetical: buildTree split paths 28760 times
```

That list is 2,801 files, shuffled, with children listed before their folders. After the change, the same file passed. The old builder, kept in the test as the shape to match, still splits more paths than there are files. `buildTree` splits none, for all six sort orders, and the tree matches the old builder.

`flock /tmp/grove-npm-test.lock` then `npm test` (including posttest), `npm run build`, and `npm run audit:offline` all passed. Vitest reported 100 files and 1,551 tests, including the 6 in `sidebarTree.test.ts`. The offline audit checked 221 source files. No older assertion was weakened. `treeSelect.test.ts` and `treeDrag.test.ts` still pass.

## Size

No new dependency.

TypeScript, against `2d4c13c`:

| File | Lines now | Change |
| --- | --- | --- |
| `rebuild/app/src/shell/sidebar.ts` | 700 | +2 / −33 |
| `rebuild/app/src/shell/sidebarTree.ts` | 46 | +46, new |
| `rebuild/app/src/shell/sidebarTree.test.ts` | 233 | +233, new |

Net TypeScript: +281 / −33. Markdown: this file.

`sidebar.ts` was 731 lines and is 700 now. `buildTree` moved to `sidebarTree.ts` so a test can build the tree without the sidebar, and so `sidebar.ts` stays under the line guide. Nothing is near 800.
