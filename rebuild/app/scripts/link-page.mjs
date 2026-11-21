#!/usr/bin/env node
// The page's link reader (src/links/linkDelta.ts), driven over stdin/stdout by
// the Rust test `link_page_tests` (R2 P2b review 1). Not part of npm test; the
// cargo suite runs it. One JSON object per line:
//
//   in:  {"read":true}            → out: {"ask":[id,version]}  (the page's request)
//   in:  <link_changes reply>     → out: {"fields":{outgoing,markdown,unresolved}, "touched":[...]|null}
//   in:  {"done":true}            → exit
//
// `fields` holds each map as JSON text, so the test compares key order too.
// `touched` is what the page tells link consumers changed (`linkChanges`).
import { createInterface } from 'node:readline';
import { linkChanges, linkReader } from '../src/links/linkDelta.ts';

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const next = async () => {
  const { value, done } = await lines.next();
  if (done) process.exit(0);
  return JSON.parse(value);
};
const say = value => process.stdout.write(`${JSON.stringify(value)}\n`);

const read = linkReader(async (id, version) => {
  say({ ask: [id, version] });
  return next();
});
let held = null;
for (;;) {
  const msg = await next();
  if (msg.done) break;
  const links = await read();
  const touched = held ? linkChanges(held, links) : null;
  held = links;
  say({
    fields: { outgoing: JSON.stringify(links.outgoing), markdown: JSON.stringify(links.markdown), unresolved: JSON.stringify(links.unresolved) },
    touched: touched && [...touched].sort(),
  });
}
process.exit(0);
