import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {cursor} from '../extension/cursor.js';
import {input, forgetPointer} from '../extension/input.js';

function page(t) {
  const window = new EventTarget();
  const element = () => ({
    style: {}, isConnected: false,
    setAttribute() {},
    attachShadow() {this.shadowRoot = {children: [], append(...children) {this.children.push(...children);}}; return this.shadowRoot;},
    remove() {this.isConnected = false;}
  });
  const sandbox = {
    document: {createElement: element, getElementById() {}, documentElement: {append(host) {host.isConnected = true;}}},
    innerWidth: 800, innerHeight: 600,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window)
  };
  vm.createContext(sandbox);
  const previous = globalThis.chrome;
  globalThis.chrome = {scripting: {async executeScript({func, args}) {sandbox.args = args; vm.runInContext(`(${func.toString()})(...args)`, sandbox); return [];}}};
  t.after(() => {if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;});
  const position = () => {
    const [horizontal, vertical] = sandbox.__dialbotCrosshair.host.shadowRoot.children;
    return {x: vertical.style.left, y: horizontal.style.top};
  };
  const move = (x, y) => {const event = new Event('mousemove'); Object.assign(event, {clientX: x, clientY: y}); window.dispatchEvent(event);};
  return {sandbox, element, position, move};
}

test('The crosshair follows explicit agent updates and ignores ordinary mousemove events', async t => {
  const view = page(t);
  await cursor(90, true, {x: 100, y: 120});
  assert.deepEqual(view.position(), {x: '100px', y: '120px'});
  view.move(600, 400);
  assert.deepEqual(view.position(), {x: '100px', y: '120px'});
  await cursor(90, true, {x: 240, y: 200});
  assert.deepEqual(view.position(), {x: '240px', y: '200px'});
  view.move(20, 30);
  assert.deepEqual(view.position(), {x: '240px', y: '200px'});
  const host = view.sandbox.__dialbotCrosshair.host;
  await cursor(90, false);
  assert.equal(host.isConnected, false);
  assert.equal(view.sandbox.__dialbotCrosshair, undefined);
});

test('Updating a page removes the manual mouse listener left by older extension versions', async t => {
  const view = page(t);
  const host = view.element();
  host.isConnected = true;
  host.attachShadow().append(view.element(), view.element());
  const [horizontal, vertical] = host.shadowRoot.children;
  const move = event => {horizontal.style.top = `${event.clientY}px`; vertical.style.left = `${event.clientX}px`;};
  view.sandbox.__dialbotCrosshair = {host, move};
  view.sandbox.addEventListener('mousemove', move, true);
  view.move(400, 300);
  assert.deepEqual(view.position(), {x: '400px', y: '300px'});
  await cursor(91, true, {x: 150, y: 160});
  view.move(700, 500);
  assert.deepEqual(view.position(), {x: '150px', y: '160px'});
});

test('Every agent movement in a stroke updates the crosshair through the explicit callback', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  forgetPointer(92);
  const moves = [], updates = [];
  const cdp = async (tabId, method, params) => {
    if (method === 'Page.getLayoutMetrics') return {cssVisualViewport: {clientWidth: 800, clientHeight: 600}};
    if (params.type === 'mouseMoved') moves.push({x: params.x, y: params.y});
    return {};
  };
  let finished = false;
  const job = input(cdp, 'browser_mouse_drag', {tabId: 92, points: [{x: 50, y: 60}, {x: 300, y: 60}], durationMs: 0}, {onPointer: point => {updates.push(point);}}).finally(() => {finished = true;});
  for (let i = 0; i < 2000 && !finished; i++) {await Promise.resolve(); t.mock.timers.tick(1000);}
  await job;
  assert.ok(updates.length > 2);
  assert.deepEqual(updates, moves);
  assert.deepEqual(updates.at(-1), {x: 300, y: 60});
});

test('Reloading the extension replaces an orphaned overlay instead of creating two crosshairs', async t => {
  const view = page(t);
  const orphan = view.element();
  orphan.isConnected = true;
  view.sandbox.document.getElementById = () => orphan;
  await cursor(93, true, {x: 120, y: 130});
  assert.equal(orphan.isConnected, false);
  assert.deepEqual(view.position(), {x: '120px', y: '130px'});
});
