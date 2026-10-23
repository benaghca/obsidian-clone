// Browser discovery needs no browser process, registry, shell or dependency.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findBrowser } from './browser.mjs';
const scratch = mkdtempSync(fileURLToPath(new URL('../node_modules/.browser-discovery-', import.meta.url)));
after(() => rmSync(scratch, { recursive: true, force: true }));
const executable = (...parts) => {
  const path = join(scratch, ...parts); mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'fixture'); chmodSync(path, 0o755); return path;
};
test('GROVE_BROWSER wins, then PATH commands in the requested order', () => {
  const override = executable('custom path', 'chosen-browser');
  const paths = ['chromium', 'chromium-browser', 'google-chrome'].map(name => executable('bin', name));
  const env = { GROVE_BROWSER: override, PATH: join(scratch, 'bin') };
  assert.equal(findBrowser(env, 'linux'), override);
  delete env.GROVE_BROWSER;
  for (const path of paths) { assert.equal(findBrowser(env, 'linux'), path); rmSync(path); }
  assert.equal(findBrowser(env, 'linux'), null);
});
test('missing overrides and non-executable files/directories do not mask a usable browser', { skip: process.platform === 'win32' }, () => {
  const directory = join(scratch, 'unusable', 'chromium'); mkdirSync(directory, { recursive: true });
  const denied = executable('unusable', 'chromium-browser'); chmodSync(denied, 0o644);
  const chrome = executable('unusable', 'google-chrome');
  assert.equal(findBrowser({ GROVE_BROWSER: join(scratch, 'missing'), PATH: join(scratch, 'unusable') }, 'linux'), chrome);
});
test('Windows checks PATH .exe names before Chrome and Edge install locations', () => {
  const env = { PATH: join(scratch, 'win-bin'), PROGRAMFILES: join(scratch, 'program files'), 'PROGRAMFILES(X86)': join(scratch, 'x86'), LOCALAPPDATA: join(scratch, 'local') };
  const path = executable('win-bin', 'google-chrome.exe');
  const chrome = executable('x86', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const local = executable('local', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const edge = executable('program files', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(findBrowser(env, 'win32'), path); rmSync(path);
  assert.equal(findBrowser(env, 'win32'), chrome); rmSync(chrome);
  assert.equal(findBrowser(env, 'win32'), local); rmSync(local);
  assert.equal(findBrowser(env, 'win32'), edge);
});
test('no browser exits nonzero with one actionable line before starting any server', () => {
  const missing = join(scratch, 'none');
  const env = { ...process.env, PATH: '', GROVE_BROWSER: missing, PROGRAMFILES: missing, 'PROGRAMFILES(X86)': missing, LOCALAPPDATA: missing };
  const code = `import { withBrowser } from ${JSON.stringify(new URL('./browser.mjs', import.meta.url).href)}; await withBrowser(() => { throw Error('must not run'); });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'No browser found. Set GROVE_BROWSER to the full path to Chrome, Edge or Chromium.\n');
});
