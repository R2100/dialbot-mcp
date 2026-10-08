import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {nativeFrame, nativeDecoder} from '../src/framing.mjs';
import {validate, tools, availableTools} from '../src/tools.mjs';
import {parseKeys} from '../extension/input.js';
test('Native framing supports split headers, unicode and consecutive messages', () => {
  const messages = [];
  const decode = nativeDecoder(message => messages.push(message));
  const buffer = Buffer.concat([nativeFrame({text: 'España 🌍'}), nativeFrame({id: 2})]);
  for (const byte of buffer) decode(Buffer.from([byte]));
  assert.deepEqual(messages, [{text: 'España 🌍'}, {id: 2}]);
  assert.throws(() => decode(Buffer.from([255, 255, 255, 255])), /too large/);
});
test('Tool validation rejects unknown operations and malformed arguments', () => {
  assert.equal(tools.length, 27);
  assert.equal(availableTools().length, 27);
  assert.equal(availableTools('normal').length, 21);
  assert.ok(!availableTools('normal').some(tool => tool.name === 'browser_read'));
  assert.equal(availableTools('dom').length, 27);
  assert.throws(() => validate('browser_mode', {mode: 'stealth'}));
  assert.throws(() => validate('browser_batch', {steps: [{name: 'browser_batch', arguments: {steps: [{name: 'browser_click', arguments: {tabId: 1, selector: '#x'}}]}}]}), /Step not allowed/);
  assert.throws(() => validate('browser_batch', {steps: [{name: 'browser_screenshot', arguments: {tabId: 1}}]}), /Step not allowed/);
  assert.throws(() => validate('browser_batch', {steps: [{name: 'browser_fill', arguments: {tabId: 1}}]}), /Missing selector|Missing text/);
  assert.throws(() => validate('browser_batch', {steps: [{name: 'unknown_tool'}]}), /Step not allowed/);
  assert.throws(() => validate('browser_batch', {steps: Array.from({length: 21}, () => ({name: 'browser_tabs'}))}));
  validate('browser_batch', {steps: [{name: 'browser_fill', arguments: {tabId: 1, selector: 'input', text: 'x'}, pauseMs: 300}, {name: 'browser_click', arguments: {tabId: 1, selector: '#send'}}], stopOnError: false});
  assert.throws(() => validate('browser_mouse_click', {tabId: 1, x: NaN, y: 0}));
  assert.throws(() => validate('browser_mouse_click', {tabId: 1, x: 0, y: 0, button: 'bad'}));
  assert.throws(() => validate('browser_type', {tabId: 1, text: 'a'.repeat(201)}));
  assert.throws(() => parseKeys('Bogus+X'));
  assert.throws(() => parseKeys('Control+Control+A'));
  assert.equal(parseKeys('Control+A').key.code, 'KeyA');
  assert.throws(() => validate('unknown', {}));
  assert.throws(() => validate('browser_close', {tabId: -1}));
  assert.throws(() => validate('browser_fill', {tabId: 1, selector: 'input'}));
  assert.throws(() => validate('browser_tabs', {extra: true}));
  validate('browser_fill', {tabId: 1, selector: 'input', text: ''});
});
test('MCP initializes, lists tools, handles malformed JSON and validates calls', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))], {windowsHide: true, env: {...process.env, BROWSER_MODE: 'visual'}});
  const responses = [];
  const lines = readline.createInterface({input: child.stdout});
  lines.on('line', line => responses.push(JSON.parse(line)));
  child.stdin.end([
    '{',
    JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25'}}),
    JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}),
    JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'}),
    JSON.stringify({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'browser_close', arguments: {tabId: 'wrong'}}}),
    JSON.stringify({jsonrpc: '2.0', id: 4, method: 'missing'}),
    JSON.stringify({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'browser_read', arguments: {tabId: 1}}}),
    JSON.stringify({jsonrpc: '2.0', id: 6, method: 'tools/call', params: {name: 'browser_batch', arguments: {steps: [{name: 'browser_screenshot', arguments: {tabId: 1}}]}}}),
    JSON.stringify({jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name: 'browser_batch_status', arguments: {}}}),
    JSON.stringify({jsonrpc: '2.0', id: 8, method: 'tools/call', params: {name: 'browser_batch_cancel', arguments: {}}})
  ].join('\n') + '\n');
  await new Promise((resolve, reject) => {child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`))); child.on('error', reject);});
  assert.equal(responses.length, 9);
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[1].result.protocolVersion, '2025-11-25');
  assert.equal(responses[2].result.tools.length, 27);
  assert.equal(responses[3].error.code, -32602);
  assert.equal(responses[4].error.code, -32601);
  assert.equal(responses[5].result.isError, true);
  assert.equal(responses[6].error.code, -32602);
  assert.match(responses[6].error.message, /Step not allowed/);
  assert.deepEqual(JSON.parse(responses[7].result.content[0].text), {running: false, totalSteps: 0, stepIndex: 0, cancelled: false, results: []});
  assert.ok(JSON.parse(responses[8].result.content[0].text).running === false);
});
test('Modes switch in one session, preserve the catalog and isolate other clients', {timeout: 10000}, async t => {
  function client() {
    const env = {...process.env}; delete env.BROWSER_MODE;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))], {windowsHide: true, env});
    t.after(() => child.kill());
    let id = 0;
    const pending = new Map();
    readline.createInterface({input: child.stdout}).on('line', line => {
      const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id);
    });
    return (method, params) => new Promise(resolve => {
      const requestId = ++id; pending.set(requestId, resolve);
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: requestId, method, params}) + '\n');
    });
  }
  const first = client(), second = client();
  for (const rpc of [first, second]) {
    const initialized = await rpc('initialize', {protocolVersion: '2025-11-25'});
    assert.match(initialized.result.instructions, /Initial mode: fast/);
  }
  const change = (rpc, args = {}) => rpc('tools/call', {name: 'browser_mode', arguments: args});
  const value = response => JSON.parse(response.result.content[0].text);
  const catalog = await first('tools/list');
  const settings = (rpc, args = {}) => rpc('tools/call', {name: 'browser_behavior', arguments: args});
  assert.equal(value(await settings(first)).effective.cursor, true);
  assert.equal(value(await settings(first)).effective.humanMotion, false);
  assert.equal(value(await change(first)).mode, 'fast');
  assert.equal(value(await change(first, {mode: 'normal'})).changed, true);
  assert.equal(value(await settings(first)).effective.cursor, false);
  assert.equal(value(await settings(first)).effective.humanMotion, true);
  await settings(first, {cursor: 'on', motion: 'direct', warmup: true});
  assert.equal(value(await settings(first)).effective.cursor, true);
  assert.equal(value(await settings(second)).preferences.cursor, 'auto');
  assert.equal(value(await settings(second)).effective.warmup, false);
  const blocked = await first('tools/call', {name: 'browser_fill', arguments: {tabId: 1, selector: 'input', text: 'x'}});
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /blocked in normal mode/);
  assert.deepEqual((await first('tools/list')).result, catalog.result);
  assert.equal(value(await change(second)).mode, 'fast');
  assert.equal((await change(first, {mode: 'invalid'})).error.code, -32602);
  assert.equal(value(await change(first)).mode, 'normal');
  const fast = value(await change(first, {mode: 'fast'}));
  assert.equal(fast.mode, 'fast');
  assert.ok(fast.allowedTools.includes('browser_fill'));
  assert.equal(value(await settings(first)).preferences.cursor, 'on');
  await settings(first, {cursor: 'auto', motion: 'auto', warmup: false});
  assert.equal(value(await settings(first)).effective.cursor, true);
});
test('Batch runs steps with pauses, supports status and cancel over a fake pipe host', {timeout: 60000}, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'dialbot-batch-'));
  const oldConfig = process.env.DIALBOT_CONFIG;
  process.env.DIALBOT_CONFIG = join(profile, 'bridge.json');
  const pipeName = `\\\\.\\pipe\\dialbot-test-${randomUUID()}`;
  await writeFile(process.env.DIALBOT_CONFIG, JSON.stringify({pipe: pipeName, token: 'batch-token'}));
  t.after(async () => {
    if (oldConfig === undefined) delete process.env.DIALBOT_CONFIG; else process.env.DIALBOT_CONFIG = oldConfig;
    await rm(profile, {recursive: true, force: true});
  });
  const seen = [];
  let refuse = false;
  const fakeHost = net.createServer(socket => {
    let pendingLine = '';
    socket.on('data', chunk => {
      pendingLine += chunk;
      let index;
      while ((index = pendingLine.indexOf('\n')) >= 0) {
        const line = pendingLine.slice(0, index);
        pendingLine = pendingLine.slice(index + 1);
        let request;
        try {request = JSON.parse(line);} catch {socket.end(); return;}
        if (request.token !== 'batch-token') {socket.end(); return;}
        seen.push(request);
        if (refuse) {socket.end(JSON.stringify({id: request.id, error: 'Bridge unavailable (ECONNREFUSED). Load the extension and press Conectar (Connect).'}) + '\n'); return;}
        const result = request.name === 'browser_read' ? {text: 'paso-' + request.arguments.maxChars} : {done: request.name};
        setTimeout(() => socket.end(JSON.stringify({id: request.id, result}) + '\n'), 20);
      }
    });
  });
  await new Promise(resolve => fakeHost.listen(pipeName, resolve));
  t.after(async () => {await new Promise(resolve => fakeHost.close(resolve));});
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))], {windowsHide: true, env: {...process.env, DIALBOT_CONFIG: process.env.DIALBOT_CONFIG}});
  t.after(() => child.kill());
  const pendingMap = new Map();
  let nextId = 100;
  readline.createInterface({input: child.stdout}).on('line', line => {
    const message = JSON.parse(line);
    pendingMap.get(message.id)?.(message);
    pendingMap.delete(message.id);
  });
  function rpc(method, params) {
    const id = ++nextId;
    return new Promise(resolve => {pendingMap.set(id, resolve); child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');});
  }
  await rpc('initialize', {protocolVersion: '2025-11-25'});
  const value = response => JSON.parse(response.result.content[0].text);

  // Happy path: three steps, a 300 ms pause after the second, results preserved.
  seen.length = 0;
  const happy = value(await rpc('tools/call', {name: 'browser_batch', arguments: {steps: [
    {name: 'browser_tabs'},
    {name: 'browser_read', arguments: {tabId: 7, maxChars: 42}, pauseMs: 300},
    {name: 'browser_activate', arguments: {tabId: 7}}
  ]}}));
  assert.equal(seen.length, 3);
  assert.ok(happy.results.every(entry => entry.ok));
  assert.equal(happy.results[1].result.text, 'paso-42');
  assert.equal(happy.cancelled, false);
  assert.equal(happy.stoppedOn, null);
  assert.ok(happy.elapsedMs >= 290, 'The pause between steps must be honored');

  // Bridge failure: the lot stops on the first failed step.
  refuse = true;
  const down = value(await rpc('tools/call', {name: 'browser_batch', arguments: {steps: [
    {name: 'browser_tabs'},
    {name: 'browser_read', arguments: {tabId: 7, maxChars: 7}}
  ]}}));
  assert.equal(down.results.length, 1);
  assert.equal(down.results[0].ok, false);
  assert.match(down.results[0].error, /Bridge unavailable/);
  assert.equal(down.stoppedOn, 0);
  refuse = false;

  // Status preserves the last lot after completion.
  const status = value(await rpc('tools/call', {name: 'browser_batch_status'}));
  assert.equal(status.running, false);
  assert.equal(status.totalSteps, 2);
  assert.equal(status.stepIndex, 0);
  assert.equal(status.results.length, 1);

  // Cancel during a long pause skips the remaining step.
  const longBatch = rpc('tools/call', {name: 'browser_batch', arguments: {steps: [
    {name: 'browser_tabs'},
    {name: 'browser_read', arguments: {tabId: 7, maxChars: 9}, pauseMs: 5000}
  ]}});
  await new Promise(resolve => setTimeout(resolve, 300));
  const live = value(await rpc('tools/call', {name: 'browser_batch_status'}));
  assert.equal(live.running, true, 'Status must report the lot in flight');
  assert.equal(live.stepIndex, 1, 'The pause belongs to the step that precedes it');
  const cancelReply = value(await rpc('tools/call', {name: 'browser_batch_cancel'}));
  assert.equal(cancelReply.running, true, 'The cancel reply arrives while the lot is still winding down');
  const cancelled = value(await longBatch);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.results.length, 2, 'Cancellation during a pause must not add results beyond the executed steps');
  assert.ok(cancelled.results.every(entry => entry.ok));
  assert.equal(cancelled.stoppedOn, null);

  // Rejected lots never reach the pipe.
  seen.length = 0;
  const rejected = await rpc('tools/call', {name: 'browser_batch', arguments: {steps: [{name: 'browser_screenshot', arguments: {tabId: 7}}]}});
  assert.equal(rejected.error.code, -32602);
  assert.equal(seen.length, 0, 'Rejected lots must not reach the browser');
});