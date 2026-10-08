import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localFiles} from '../src/upload.mjs';
import {validate} from '../src/tools.mjs';

test('Upload validates array and local regular files before browser actions', t => {
  const directory = mkdtempSync(join(tmpdir(), 'dialbot-files-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const file = join(directory, 'prueba ñ.txt');
  writeFileSync(file, 'test');
  assert.equal(localFiles([file]).length, 1);
  for (const path of ['relative.txt', directory, join(directory, 'missing'), '\\\\server\\share\\image.png', '//server/share/image.png']) assert.throws(() => localFiles([path]));
  for (const files of [[], 'file', [5], [''], Array(11).fill(file), ['x'.repeat(4097)]]) {
    assert.throws(() => validate('browser_upload', {tabId: 1, selector: 'input', files}));
  }
  validate('browser_upload_click', {tabId: 1, x: 10, y: 10, files: [file]});
});
