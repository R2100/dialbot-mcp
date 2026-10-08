import test from 'node:test';
import assert from 'node:assert/strict';
import {validate, availableTools} from '../src/tools.mjs';
import {input} from '../extension/input.js';

test('Large Unicode blocks are accepted in both modes while malformed or oversized text is rejected', () => {
  for (const mode of ['fast', 'normal']) assert.ok(availableTools(mode).some(tool => tool.name === 'browser_paste'));
  for (const text of ['', 'a'.repeat(100000), '🌍'.repeat(100000)]) validate('browser_paste', {tabId: 1, text});
  for (const text of [null, 42, 'a'.repeat(100001), '🌍'.repeat(100001)]) assert.throws(() => validate('browser_paste', {tabId: 1, text}));
  assert.throws(() => validate('browser_paste', {tabId: 1}));
  assert.throws(() => validate('browser_paste', {tabId: 1, text: 'code', selector: 'textarea'}));
  assert.throws(() => validate('browser_type', {tabId: 1, text: 'a'.repeat(201)}));
});

test('A large multiline block is pasted with a single Control+V chord rather than per-character keys', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const text = 'function saludo() {\n\treturn "España 🌍";\n}\n'.repeat(1000);
  const commands = [];
  let result;
  const job = input(async (...args) => {commands.push(args); return {};}, 'browser_paste', {tabId: 80, text}, {humanMotion: true}).then(value => {result = value;});
  for (let i = 0; i < 100 && !result; i++) {await Promise.resolve(); t.mock.timers.tick(1000);}
  await job;
  assert.equal(commands.length, 4);
  assert.ok(commands.every(command => command[1] === 'Input.dispatchKeyEvent'));
  assert.deepEqual(commands.map(command => [command[2].key, command[2].type, command[2].modifiers]), [['Control', 'rawKeyDown', 2], ['V', 'rawKeyDown', 2], ['V', 'keyUp', 2], ['Control', 'keyUp', 0]]);
  assert.deepEqual(result, {inserted: [...text].length});
});

test('An empty block is a no-op that preserves the current selection and clipboard', async () => {
  const result = await input(async () => {throw new Error('Unexpected input');}, 'browser_paste', {tabId: 80, text: ''});
  assert.deepEqual(result, {inserted: 0});
});

test('An insertion failure is returned instead of claiming successful paste', async () => {
  await assert.rejects(input(async () => {throw new Error('Chrome unavailable');}, 'browser_paste', {tabId: 80, text: 'code'}), /Chrome unavailable/);
});
