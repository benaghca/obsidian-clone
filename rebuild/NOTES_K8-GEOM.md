# K8-GEOM

`rebuild/k8-review-grok` at `bd62407`. Nothing pushed. No product or test edit.

The integration merge log `~/wave-c-merge/log-wc22.txt` ran `scripts/test-geometry.mjs` twice on K8 merged onto `rebuild/integration` (`ec7a58a`, then reset back to that commit). The first pass printed every Ctrl+O and Ctrl+P line at 16.7–16.9 ms. The full-suite rerun then failed the first one:

`Geometry.md live Ctrl+o: {"visibleFrame":1,"maxFrame":20.699999928474426}`

`visibleFrame` 1 means the prompt was on screen on the first frame. `maxFrame` is the longest `requestAnimationFrame` gap in the 300 ms after the key, not the open frame by itself (`test-geometry.mjs` monitor). The ceiling stays 20 ms.

## What K8 touches on that path

`git diff ec7a58a bd62407` is the list layout only: `bases/list.ts`, `bases-list.css`, and the hooks in `bases/view.ts`, `config.ts`, `menus.ts`, `model.ts`, `write.ts`, plus the list test, `package.json` posttest, and the K8 notes.

`shell/pane.ts` already imports `bases/view.ts`, and that file imports `createList`, so `list.ts` and `bases-list.css` load with the shell. The CSS is scoped to `.bases-list*`. `createList` and `listLayout` run when a list view is shown. This geometry script opens `Geometry.md` and `GeometryFM.md` and never opens a base. Ctrl+O and Ctrl+P still go through `openPrompt` in `shell/prompt.ts`. No command was added, so the palette list is the same. The production bundle is about 6.6 kB larger in JS and 0.9 kB in CSS. That is load-time weight, not work on the keydown frame.

## Runs

`npm run build` on both trees, then `flock /tmp/grove-npm-test.lock node scripts/test-geometry.mjs` from `rebuild/app`, five times on `bd62407` and five times on a detached checkout of `ec7a58a` (`/tmp/k8-geom-int`, removed afterward). Runs alternated. Every run exited 0. Numbers are `maxFrame` in milliseconds.

| Case | k8 1 | k8 2 | k8 3 | k8 4 | k8 5 | int 1 | int 2 | int 3 | int 4 | int 5 |
|---|---|---|---|---|---|---|---|---|---|---|
| Geometry.md live Ctrl+o | 16.8 | 16.9 | 16.9 | 16.9 | 17.0 | 17.0 | 16.8 | 16.9 | 16.8 | 16.9 |
| Geometry.md live Ctrl+p | 16.8 | 16.8 | 16.9 | 16.8 | 16.7 | 16.7 | 16.9 | 16.9 | 16.9 | 17.0 |
| Geometry.md source Ctrl+o | 16.7 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 |
| Geometry.md source Ctrl+p | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.7 | 16.7 | 16.8 |
| Geometry.md reading Ctrl+o | 17.6 | 16.9 | 16.9 | 16.8 | 16.8 | 16.8 | 16.8 | 16.9 | 16.9 | 16.8 |
| Geometry.md reading Ctrl+p | 16.8 | 16.8 | 16.8 | 16.7 | 16.8 | 16.8 | 16.8 | 16.7 | 16.8 | 16.8 |
| GeometryFM.md live Ctrl+o | 16.9 | 16.9 | 16.8 | 16.9 | 16.9 | 16.8 | 17.1 | 17.1 | 16.8 | 17.0 |
| GeometryFM.md live Ctrl+p | 16.8 | 16.9 | 16.8 | 16.9 | 16.7 | 16.8 | 16.8 | 16.8 | 16.8 | 16.9 |
| GeometryFM.md source Ctrl+o | 16.8 | 16.8 | 16.8 | 16.7 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.7 |
| GeometryFM.md source Ctrl+p | 16.9 | 16.8 | 16.8 | 16.7 | 16.8 | 16.8 | 16.7 | 16.8 | 16.8 | 16.8 |
| GeometryFM.md reading Ctrl+o | 16.8 | 16.7 | 16.8 | 16.9 | 16.8 | 16.9 | 16.9 | 16.8 | 16.7 | 16.8 |
| GeometryFM.md reading Ctrl+p | 16.8 | 16.8 | 16.8 | 16.9 | 16.8 | 16.7 | 16.7 | 17.0 | 16.7 | 16.7 |

K8: 60 samples, 16.7–17.6 ms, none over 20. Integration: 60 samples, 16.7–17.1 ms, none over 20. The two trees sit on the same 60 fps frame. Screenshots under `rebuild/round*-shots/` were left clean.

VERDICT: FLAKE
