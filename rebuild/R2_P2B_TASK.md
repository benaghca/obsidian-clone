# R2 P2b: link-index deltas (invisible)

Goal: when a note is saved or synced, update the link/backlink index with a delta for that note instead of re-reading the whole vault. Builds on merged P2a (incremental name maps). Re-measure first on a big test vault under /tmp, and report before/after numbers.

Hard limits: no visible change (layout, shortcuts, look, behavior identical); no lost or stale links ever (results must equal a full rebuild; add a test that compares delta vs full rebuild after rename, move, delete, alias and embed edits); no new crates or packages; don't touch real vaults, test under /tmp only; don't push, don't touch P3 (faster open) or the file tree. Design the rest yourself. Commit on this branch, run cargo tests and npm build/tests, then report.
