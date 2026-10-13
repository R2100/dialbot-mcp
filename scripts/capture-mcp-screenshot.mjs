import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';

const tabId = Number(process.env.DIALBOT_TAB_ID);
const output = process.env.DIALBOT_SCREENSHOT_OUTPUT;
if (!Number.isInteger(tabId) || !output) throw new Error('Set DIALBOT_TAB_ID and DIALBOT_SCREENSHOT_OUTPUT.');

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

try {
  await call('initialize', {protocolVersion: '2025-11-25'});
  await call('tools/call', {name: 'browser_behavior', arguments: {tabId, cursor: 'on'}});
  const reply = await call('tools/call', {name: 'browser_screenshot', arguments: {tabId}});
  const image = reply.result?.content?.find(item => item.type === 'image');
  if (!image) throw new Error(JSON.stringify(reply));
  writeFileSync(output, Buffer.from(image.data, 'base64'));
} finally {
  child.kill();
}
