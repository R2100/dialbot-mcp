import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import net from 'node:net';
import readline from 'node:readline';
import {config} from '../src/config.mjs';
import {identity} from './identity.mjs';
const enabled = Boolean(process.env.PLAYWRIGHT_MODULE && process.env.BROWSER_EXECUTABLE);
test('Real browser: MCP -> native host -> extension -> local page', {skip: !enabled, timeout: 180000}, async t => {
  const require = createRequire(import.meta.url);
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
  const profile = await mkdtemp(join(tmpdir(), 'local-browser-test-'));
  const oldConfig = process.env.DIALBOT_CONFIG;
  process.env.DIALBOT_CONFIG = join(profile, 'bridge.json');
  await writeFile(process.env.DIALBOT_CONFIG, JSON.stringify({pipe: `\\\\.\\pipe\\dialbot-test-${randomUUID()}`, token: randomUUID()}));
  t.after(() => {if (oldConfig === undefined) delete process.env.DIALBOT_CONFIG; else process.env.DIALBOT_CONFIG = oldConfig;});
  const root = fileURLToPath(new URL('../', import.meta.url));
  let navigationHeaders;
  const receivedUploads = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/upload' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {receivedUploads.push(Buffer.concat(chunks).toString('utf8')); res.end('received');});
      return;
    }
    if (req.url === '/') navigationHeaders = req.headers;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>Prueba local</title>
      <style>body{height:2200px}#name{position:absolute;left:20px;top:100px;width:200px;height:30px}#send{position:absolute;left:250px;top:100px;width:100px;height:35px}</style>
      <input id="upload" type="file" multiple style="display:none" onchange="window.uploaded=[...this.files].map(f=>({name:f.name,size:f.size}));window.uploadTrusted=event.isTrusted;if(this.files[0])fetch('/upload',{method:'POST',body:this.files[0]}).then(()=>window.uploadsDone=(window.uploadsDone||0)+1)">
      <button id="choose" style="position:absolute;top:200px;left:20px;width:160px;height:35px" onclick="document.querySelector('#upload').click()">Elegir archivo</button>
      <input id="single" type="file" style="display:none"><input id="disabled-file" type="file" disabled style="display:none">
      <h1>Formulario local</h1><input id="name"><button id="send" onclick="document.querySelector('#result').textContent='Hola '+document.querySelector('#name').value">Saludar</button><p id="result"></p>
      <div id="nested" style="position:absolute;left:550px;top:150px;width:200px;height:120px;overflow:auto"><div style="height:900px">Scroll interior</div></div>
      <canvas id="drawing" width="300" height="140" style="position:absolute;left:20px;top:260px;touch-action:none"></canvas>
      <input id="slider" type="range" min="0" max="100" value="0" style="position:absolute;left:20px;top:430px;width:300px;height:25px;margin:0">
      <textarea id="block" style="position:absolute;left:20px;top:500px;width:470px;height:90px"></textarea>
      <div id="editor" contenteditable="true" style="position:absolute;left:550px;top:300px;width:220px;height:140px;outline:1px solid">Editor</div>
      <nav aria-label="Principal" style="position:absolute;top:800px"><a id="home-link" href="/home">Inicio</a><button id="menu" aria-expanded="false" aria-haspopup="menu">Opciones</button><a hidden href="/hidden">Oculto</a></nav>
      <script>
        window.events=[]; for(const type of ['mousemove','mousedown','mouseup','click','dblclick','pointerdown','pointermove','pointerup','keydown','keyup','input','wheel']) document.addEventListener(type,e=>window.events.push({type:e.type,key:e.key,buttons:e.buttons,trusted:e.isTrusted}));
        const canvas=document.querySelector('#drawing'), ctx=canvas.getContext('2d'); ctx.lineWidth=3;
        canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(e.offsetX,e.offsetY)});
        canvas.addEventListener('pointermove',e=>{if(e.buttons&1){ctx.lineTo(e.offsetX,e.offsetY);ctx.stroke()}});
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: [`--disable-extensions-except=${join(root, 'extension')}`, `--load-extension=${join(root, 'extension')}`]
  });
  t.after(async () => {await context.close(); await rm(profile, {recursive: true, force: true});});
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const child = spawn(process.execPath, [join(root, 'src/mcp.mjs')], {windowsHide: true, env: {...process.env, BROWSER_MODE: 'dom'}});
  t.after(() => child.kill());
  const pending = new Map(); let nextId = 0;
  readline.createInterface({input: child.stdout}).on('line', line => {
    const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id);
  });
  function rpc(method, params) {
    const id = ++nextId;
    return new Promise(resolve => {pending.set(id, resolve); child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');});
  }
  async function tool(name, args = {}, allowError = false) {
    console.log('Testing:', name);
    const reply = await rpc('tools/call', {name, arguments: args});
    assert.ok(!reply.error, JSON.stringify(reply));
    if (!allowError) assert.ok(!reply.result.isError, JSON.stringify(reply));
    return reply.result;
  }
  await rpc('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'local-test', version: '1'}});
  assert.equal((await rpc('tools/list')).result.tools.length, 27);
  let connected = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await tool('browser_tabs', {}, true);
    if (attempt === 0 && result.isError) console.log('Bridge startup:', result.content[0].text);
    if (!result.isError) {connected = true; break;}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!connected) {
    const popup = await context.newPage();
    await popup.goto(new URL('popup.html', worker.url()).href);
    console.log('Extension status:', await popup.locator('#status').textContent());
  }
  assert.ok(connected, 'Native host did not connect');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const opened = JSON.parse((await tool('browser_open', {url})).content[0].text);
  const tabId = opened.tabId;
  for (let attempt = 0; attempt < 20; attempt++) {
    const read = await tool('browser_read', {tabId}, true);
    if (!read.isError && read.content[0].text.includes('Formulario local')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const page = context.pages().find(page => page.url() === url);
  assert.ok(page);
  const file = join(profile, 'prueba ñ.txt');
  await writeFile(file, 'contenido local de prueba');
  const files = [file];
  const inputs = JSON.parse((await tool('browser_file_inputs', {tabId})).content[0].text).inputs;
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].visible, false);
  await tool('browser_upload', {tabId, selector: inputs[0].selector, files});
  assert.deepEqual(await page.evaluate(() => window.uploaded), [{name: 'prueba ñ.txt', size: 25}]);
  assert.equal(await page.evaluate(() => window.uploadTrusted), true);
  assert.equal(await page.evaluate(() => document.querySelector('#upload').files[0].text()), 'contenido local de prueba');
  await page.waitForFunction(() => window.uploadsDone === 1);
  assert.deepEqual(receivedUploads, ['contenido local de prueba']);
  for (const selector of ['#name', '#missing', '#disabled-file', 'input', '#single']) {
    assert.equal((await tool('browser_upload', {tabId, selector, files: [file, file]}, true)).isError, true);
  }
  assert.equal((await tool('browser_upload', {tabId, selector: '#upload', files: [profile]}, true)).isError, true);
  assert.equal((await tool('browser_upload', {tabId, selector: '#upload', files: [join(profile, 'missing')]}, true)).isError, true);
  await tool('browser_mode', {mode: 'normal'});
  assert.equal((await tool('browser_upload', {tabId, selector: '#upload', files}, true)).isError, true);
  await page.evaluate(() => {document.querySelector('#upload').value = ''; window.uploaded = [];});
  await tool('browser_upload_click', {tabId, x: 80, y: 215, files});
  await page.waitForFunction(() => window.uploadsDone === 2);
  assert.deepEqual(receivedUploads, ['contenido local de prueba', 'contenido local de prueba']);
  assert.deepEqual(await page.evaluate(() => window.uploaded), [{name: 'prueba ñ.txt', size: 25}]);
  assert.equal(await page.evaluate(() => window.uploadTrusted), true);
  assert.equal((await tool('browser_upload_click', {tabId, x: 450, y: 70, files}, true)).isError, true);
  // A failed chooser must leave interception disabled.
  const nativeChooser = page.waitForEvent('filechooser');
  await tool('browser_mouse_click', {tabId, x: 80, y: 215});
  await (await nativeChooser).setFiles([]);
  await tool('browser_mode', {mode: 'fast'});
  const baselineIdentity = await page.evaluate(identity);
  const listed = JSON.parse((await tool('browser_outline', {tabId})).content[0].text);
  assert.ok(listed.items.some(item => item.name === 'Inicio' && item.href === url + 'home' && item.selector === '#home-link'));
  assert.ok(listed.items.some(item => item.name === 'Opciones' && item.expanded === false));
  assert.ok(!listed.items.some(item => item.name === 'Oculto'));
  const paged = JSON.parse((await tool('browser_outline', {tabId, limit: 1, offset: 1})).content[0].text);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.items[0].number, 2);
  assert.equal(await page.locator('#dialbot-cursor-overlay').count(), 1);
  await tool('browser_activate', {tabId});
  assert.equal(JSON.parse((await tool('browser_tabs')).content[0].text).find(tab => tab.tabId === tabId).active, true);
  assert.equal(navigationHeaders['user-agent'], baselineIdentity.userAgent);
  assert.equal(baselineIdentity.syntheticEventTrusted, false);
  await tool('browser_fill', {tabId, selector: '#name', text: 'Mundo'});
  await tool('browser_click', {tabId, selector: '#send'});
  assert.match((await tool('browser_read', {tabId})).content[0].text, /Hola Mundo/);
  // Batch: verified selectors only, pauses between steps, first failure stops.
  const batchHappy = JSON.parse((await tool('browser_batch', {steps: [
    {name: 'browser_fill', arguments: {tabId, selector: '#name', text: 'Lote'}},
    {name: 'browser_click', arguments: {tabId, selector: '#send'}, pauseMs: 300},
    {name: 'browser_read', arguments: {tabId, maxChars: 2000}}
  ]})).content[0].text);
  assert.equal(batchHappy.results.length, 3);
  assert.ok(batchHappy.results.every(entry => entry.ok));
  assert.equal(batchHappy.cancelled, false);
  assert.equal(batchHappy.stoppedOn, null);
  assert.match(batchHappy.results[2].result.text, /Hola Lote/);
  const batchFailing = JSON.parse((await tool('browser_batch', {steps: [
    {name: 'browser_fill', arguments: {tabId, selector: '#missing', text: 'x'}},
    {name: 'browser_click', arguments: {tabId, selector: '#send'}}
  ]}, true)).content[0].text);
  assert.equal(batchFailing.results.length, 1);
  assert.equal(batchFailing.results[0].ok, false);
  assert.match(batchFailing.results[0].error, /selector/);
  assert.equal(batchFailing.stoppedOn, 0);
  const statusIdle = JSON.parse((await tool('browser_batch_status')).content[0].text);
  assert.equal(statusIdle.running, false);
  assert.equal(statusIdle.totalSteps, 2);
  assert.equal(statusIdle.stepIndex, 0, 'Preserved status must show the step where the lot stopped');
  assert.equal((await tool('browser_click', {tabId, selector: '#missing'}, true)).isError, true);
  assert.equal(JSON.parse((await tool('browser_mode', {mode: 'normal'})).content[0].text).mode, 'normal');
  assert.equal(await page.locator('#dialbot-cursor-overlay').count(), 0);
  assert.equal((await tool('browser_outline', {tabId}, true)).isError, true);
  assert.equal((await tool('browser_fill', {tabId, selector: '#name', text: 'blocked'}, true)).isError, true);
  const screenshot = await tool('browser_screenshot', {tabId});
  assert.equal(screenshot.content[0].type, 'image');
  assert.equal(Buffer.from(screenshot.content[0].data, 'base64').subarray(1, 4).toString(), 'PNG');
  const metadata = JSON.parse(screenshot.content[1].text);
  assert.equal(metadata.imagePixelsPerCssPixel.x, metadata.image.width / metadata.viewport.width);
  assert.ok(metadata.viewport.width > 500);
  // A single stroke must draw both legs, not a diagonal between the endpoints.
  await page.evaluate(() => {window.events = [];});
  await tool('browser_mouse_drag', {tabId, points: [{x: 40, y: 280}, {x: 200, y: 280}, {x: 200, y: 360}], durationMs: 200});
  assert.deepEqual(await page.evaluate(() => {
    const ctx = document.querySelector('#drawing').getContext('2d');
    return [ctx.getImageData(100, 20, 1, 1).data[3] > 0, ctx.getImageData(180, 80, 1, 1).data[3] > 0, ctx.getImageData(100, 60, 1, 1).data[3] === 0];
  }), [true, true, true]);
  const strokeEvents = await page.evaluate(() => window.events);
  const pressed = strokeEvents.findIndex(event => event.type === 'pointerdown');
  const released = strokeEvents.findIndex(event => event.type === 'pointerup');
  assert.ok(pressed >= 0 && released > pressed);
  const heldMoves = strokeEvents.slice(pressed + 1, released).filter(event => event.type === 'pointermove');
  assert.ok(heldMoves.length > 0 && heldMoves.every(event => event.buttons === 1));
  assert.ok(strokeEvents.every(event => event.trusted));
  await tool('browser_mouse_drag', {tabId, points: [{x: 28, y: 442}, {x: 312, y: 442}], durationMs: 200});
  assert.ok(Number(await page.locator('#slider').inputValue()) > 90, 'Dragging must move the native slider thumb');
  // Cancel a long pause between steps and confirm the remaining steps never ran.
  const longBatch = tool('browser_batch', {steps: [
    {name: 'browser_read', arguments: {tabId, maxChars: 100}},
    {name: 'browser_click', arguments: {tabId, selector: '#send'}, pauseMs: 9000},
    {name: 'browser_fill', arguments: {tabId, selector: '#name', text: 'nunca'}}
  ]}, true);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(JSON.parse((await tool('browser_batch_status')).content[0].text).running, true);
  await tool('browser_batch_cancel');
  const cancelled = JSON.parse((await longBatch).content[0].text);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.results.length, 2, 'Cancellation during a pause must not add results beyond the executed steps');
  assert.ok(cancelled.results.every(entry => entry.ok));
  assert.equal(await page.locator('#name').inputValue(), 'Lote', 'Steps after cancellation must not run');
  const code = 'function saludo() {\n\treturn "España 🌍";\n}\n'.repeat(500);
  await tool('browser_mouse_click', {tabId, x: 40, y: 520});
  await page.evaluate(() => {window.events = [];});
  await tool('browser_paste', {tabId, text: code});
  assert.equal(await page.locator('#block').inputValue(), code);
  const pasteEvents = await page.evaluate(() => window.events);
  assert.ok(pasteEvents.some(event => event.type === 'input' && event.trusted));
  assert.ok(pasteEvents.filter(event => event.type === 'keydown').length <= 2, 'Only the paste chord should generate key events');
  await tool('browser_sendkeys', {tabId, keys: 'Control+A'});
  await tool('browser_paste', {tabId, text: 'Código reemplazado\n  🌍'});
  assert.equal(await page.locator('#block').inputValue(), 'Código reemplazado\n  🌍');
  await page.evaluate(() => document.querySelector('#block').addEventListener('beforeinput', event => event.preventDefault(), {once: true}));
  await tool('browser_paste', {tabId, text: 'cancelado'});
  assert.equal(await page.locator('#block').inputValue(), 'Código reemplazado\n  🌍', 'Canceled beforeinput must prevent insertion');
  await tool('browser_mouse_click', {tabId, x: 570, y: 320});
  await tool('browser_sendkeys', {tabId, keys: 'Control+A'});
  await tool('browser_paste', {tabId, text: 'Editor 🌍\nSegunda línea'});
  assert.equal(await page.locator('#editor').innerText(), 'Editor 🌍\nSegunda línea');
  // Test-only observation; MCP input operations never inspect the page DOM.
  await page.evaluate(() => {window.events = [];});
  await tool('browser_mouse_move', {tabId, x: 40, y: 115});
  await tool('browser_mouse_click', {tabId, x: 40, y: 115});
  await tool('browser_sendkeys', {tabId, keys: 'Control+A'});
  await tool('browser_type', {tabId, text: 'España 🌍', delayMs: 5});
  assert.equal(await page.locator('#name').inputValue(), 'España 🌍');
  await tool('browser_sendkeys', {tabId, keys: 'End'});
  await tool('browser_sendkeys', {tabId, keys: 'Backspace'});
  assert.equal(await page.locator('#name').inputValue(), 'España ');
  await tool('browser_sendkeys', {tabId, keys: 'Tab'});
  await tool('browser_sendkeys', {tabId, keys: 'Enter'});
  assert.equal(await page.locator('#result').textContent(), 'Hola España ');
  await tool('browser_mouse_click', {tabId, x: 280, y: 115, clickCount: 2});
  const events = await page.evaluate(() => window.events);
  for (const type of ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'input']) {
    assert.ok(events.some(event => event.type === type), `Missing ${type}`);
  }
  assert.ok(events.every(event => event.trusted), JSON.stringify(events));
  await tool('browser_mouse_click', {tabId, x: 40, y: 115});
  const beforeCanceledKey = await page.locator('#name').inputValue();
  await page.evaluate(() => document.querySelector('#name').addEventListener('keydown', event => event.preventDefault(), {once: true}));
  await tool('browser_sendkeys', {tabId, keys: 'z'});
  assert.equal(await page.locator('#name').inputValue(), beforeCanceledKey, 'Canceled key must not insert text');
  await page.evaluate(() => {
    window.events = [];
    document.addEventListener('wheel', event => event.preventDefault(), {once: true, passive: false});
  });
  await tool('browser_scroll', {tabId, x: 500, y: 400, deltaY: 120});
  await page.waitForFunction(() => window.events.some(event => event.type === 'wheel'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => scrollY), 0, 'Canceled wheel must not scroll');
  await tool('browser_scroll', {tabId, x: 600, y: 180, deltaY: 100});
  await page.waitForFunction(() => document.querySelector('#nested').scrollTop > 0);
  assert.equal(await page.evaluate(() => scrollY), 0, 'Inner scroll must not move the page');
  assert.equal((await tool('browser_mouse_click', {tabId, x: 99999, y: 10}, true)).isError, true);
  assert.equal((await tool('browser_sendkeys', {tabId, keys: 'Control+NoSuchKey'}, true)).isError, true);
  await tool('browser_scroll', {tabId, x: 500, y: 400, deltaY: 500});
  await page.waitForFunction(() => scrollY > 0 && window.events.some(e => e.type === 'wheel' && e.trusted));
  const typing = tool('browser_type', {tabId, text: 'abc', delayMs: 100});
  const busyMode = await tool('browser_mode', {mode: 'fast'}, true);
  assert.equal(busyMode.isError, true, 'Mode changes must wait for pending input');
  assert.equal(JSON.parse((await tool('browser_mode')).content[0].text).mode, 'normal');
  await typing;
  await tool('browser_detach', {tabId});
  assert.deepEqual(await page.evaluate(identity), baselineIdentity, 'Input and debugger must preserve the measured browser identity');
  await tool('browser_mode', {mode: 'fast'});
  await tool('browser_fill', {tabId, selector: '#name', text: 'Fast de nuevo'});
  assert.equal(await page.locator('#name').inputValue(), 'Fast de nuevo');
  await tool('browser_behavior', {tabId, cursor: 'on', motion: 'human', warmup: true});
  await page.evaluate(() => {window.events = [];});
  await tool('browser_mouse_move', {tabId, x: 100, y: 100});
  const idleEvents = await page.evaluate(() => window.events);
  assert.ok(idleEvents.filter(event => event.type === 'mousemove').length > 10);
  assert.ok(!idleEvents.some(event => event.type === 'click' || event.type === 'keydown'));
  const cross = await page.evaluate(() => {
    const root = document.querySelector('#dialbot-cursor-overlay');
    const [h, v] = root.shadowRoot.children;
    return {top: h.style.top, left: v.style.left, color: getComputedStyle(h).backgroundColor, opacity: getComputedStyle(root).opacity, pointerEvents: getComputedStyle(root).pointerEvents};
  });
  assert.deepEqual(cross, {top: '100px', left: '100px', color: 'rgb(0, 255, 0)', opacity: '1', pointerEvents: 'none'});
  await page.screenshot({path: join(root, '.local/cursor-preview.png')});
  await tool('browser_behavior', {cursor: 'off', warmup: false});
  assert.equal(await page.locator('#dialbot-cursor-overlay').count(), 0);
  await tool('browser_warmup', {tabId});
  await tool('browser_navigate', {tabId, url: url + '?next'});
  const results = await Promise.all([tool('browser_tabs'), tool('browser_tabs')]);
  assert.equal(results.length, 2);
  // An unauthenticated pipe client must never reach the browser.
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(config().pipe);
    socket.on('connect', () => socket.write(JSON.stringify({token: 'invalid', name: 'browser_close', arguments: {tabId}}) + '\n'));
    socket.on('close', resolve); socket.on('error', reject);
  });
  assert.ok(JSON.parse((await tool('browser_tabs')).content[0].text).some(tab => tab.tabId === tabId));
  await tool('browser_close', {tabId});
  assert.ok(!JSON.parse((await tool('browser_tabs')).content[0].text).some(tab => tab.tabId === tabId));
  console.log('Verified extension worker:', new URL(worker.url()).host);
});
