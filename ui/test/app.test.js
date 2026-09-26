// Checks that the ui/app/*.js pieces, joined in src/api.rs's order into /app.js, still form one
// valid script: they share one scope, so two pieces declaring the same name would break the app.
// Run with plain Node 18+:  node ui/test/app.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const api = fs.readFileSync(path.join(__dirname, '../../src/api.rs'), 'utf8');
const pieces = [...api.matchAll(/include_str!\("\.\.\/ui\/app\/([\w-]+\.js)"\)/g)].map(m => m[1]);
const onDisk = fs.readdirSync(path.join(__dirname, '../app')).filter(f => f.endsWith('.js'));
for (const f of onDisk) if (!pieces.includes(f)) throw new Error(`ui/app/${f} isn't joined into /app.js (add it to APP_JS in src/api.rs)`);
const src = pieces.map(f => fs.readFileSync(path.join(__dirname, '../app', f), 'utf8')).join('\n');
try { new vm.Script(src, { filename: 'app.js' }); }
catch (e) {
  // Say which piece the error is in.
  const line = +((e.stack || '').match(/app\.js:(\d+)/) || [])[1];
  let at = 0, where = '';
  for (const f of pieces) { const n = fs.readFileSync(path.join(__dirname, '../app', f), 'utf8').split('\n').length; if (line && line <= at + n) { where = ` (ui/app/${f}, line ${line - at})`; break; } at += n; }
  throw new Error(e.message + where);
}
console.log(`ok ${pieces.length} pieces`);
