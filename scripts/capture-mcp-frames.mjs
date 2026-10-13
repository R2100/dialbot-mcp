import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const tabId = Number(process.env.DIALBOT_TAB_ID);
const output = process.env.DIALBOT_FRAME_DIR;
const durationMs = Number(process.env.DIALBOT_CAPTURE_MS ?? 12000);
const fps = Number(process.env.DIALBOT_CAPTURE_FPS ?? 8);
if (!Number.isInteger(tabId) || !output || !Number.isFinite(durationMs) || !Number.isFinite(fps)) throw new Error('Set DIALBOT_TAB_ID, DIALBOT_FRAME_DIR, DIALBOT_CAPTURE_MS and DIALBOT_CAPTURE_FPS.');

mkdirSync(output, {recursive: true});
const child = spawn(process.execPath, ['src/mcp.mjs'], {cwd: new URL('../', import.meta.url), windowsHide: true});
const pending = new Map();
let nextId = 0;
createInterface({input: child.stdout}).on('line', line => {
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve) { pending.delete(message.id); resolve(message); }
});
const call = (method, params) => new Promise(resolve => {
  const id = ++nextId;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await call('initialize', {protocolVersion: '2025-11-25'});
  await call('tools/call', {name: 'browser_behavior', arguments: {tabId, cursor: 'on'}});
  const end = Date.now() + durationMs;
  let frame = 0;
  while (Date.now() < end) {
    const reply = await call('tools/call', {name: 'browser_screenshot', arguments: {tabId}});
    const image = reply.result?.content?.find(item => item.type === 'image');
    if (!image) throw new Error(JSON.stringify(reply));
    writeFileSync(join(output, `frame-${String(frame++).padStart(4, '0')}.png`), Buffer.from(image.data, 'base64'));
    await wait(1000 / fps);
  }
  console.log(`Captured ${frame} frames in ${output}`);
} finally {
  child.kill();
}
