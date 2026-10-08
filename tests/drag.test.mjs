import test from 'node:test';
import assert from 'node:assert/strict';
import {validate, availableTools} from '../src/tools.mjs';
import {input, forgetPointer, pointerPosition} from '../extension/input.js';
import {strokeSegments} from '../extension/motion.js';

const tabId = 30;
const points = [{x: 40, y: 50}, {x: 240, y: 50}, {x: 240, y: 180}];
function browser(events, intercept = () => {}) {
  return async (id, method, params) => {
    if (method === 'Page.getLayoutMetrics') return {cssVisualViewport: {clientWidth: 800, clientHeight: 600}};
    if (method === 'Input.dispatchMouseEvent') {events.push(params); intercept(params);}
    return {};
  };
}
async function run(t, operation) {
  let finished = false;
  const result = operation.then(value => ({value}), error => ({error})).finally(() => {finished = true;});
  for (let i = 0; i < 20000 && !finished; i++) {
    for (let j = 0; j < 10; j++) await Promise.resolve();
    if (!finished) t.mock.timers.tick(1);
  }
  assert.ok(finished, 'Input must finish within a bounded number of timer ticks');
  const outcome = await result;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}
function timers(t) {
  t.mock.timers.enable({apis: ['setTimeout', 'Date']});
  t.mock.method(performance, 'now', () => Date.now());
}

test('Drag validates all waypoints and is available in both modes', () => {
  for (const mode of ['fast', 'normal']) assert.ok(availableTools(mode).some(tool => tool.name === 'browser_mouse_drag'));
  validate('browser_mouse_drag', {tabId, points});
  validate('browser_mouse_drag', {tabId, points, button: 'middle', durationMs: 0});
  for (const path of [null, 'path', [], [points[0]], Array(101).fill(points[0]), [null, points[0]], [[40, 50], points[0]], [{x: 0}, points[0]], [{x: -1, y: 0}, points[0]], [{x: Infinity, y: 0}, points[0]], [{x: 0, y: NaN}, points[0]], [{x: '0', y: 0}, points[0]], [{x: 0, y: 0, z: 0}, points[0]]]) {
    assert.throws(() => validate('browser_mouse_drag', {tabId, points: path}));
  }
  for (const durationMs of [-1, 10001, 1.5]) assert.throws(() => validate('browser_mouse_drag', {tabId, points, durationMs}));
  assert.throws(() => validate('browser_mouse_drag', {tabId, points, button: 'none'}));
  assert.throws(() => validate('browser_mouse_drag', {tabId}));
});

test('Continuous strokes preserve button masks and exact corners even with human motion enabled', async t => {
  timers(t);
  for (const [button, buttons] of [['left', 1], ['right', 2], ['middle', 4]]) {
    forgetPointer(tabId);
    const events = [];
    const cdp = browser(events);
    const result = await run(t, input(cdp, 'browser_mouse_drag', {tabId, points, button, durationMs: 120}, {humanMotion: true}));
    assert.equal(result.dragged, true);
    assert.deepEqual(result.pointer, points.at(-1));
    const down = events.findIndex(event => event.type === 'mousePressed');
    assert.ok(down > 0);
    assert.deepEqual(events[down], {type: 'mousePressed', ...points[0], button, buttons, clickCount: 1});
    const held = events.slice(down + 1, -1);
    assert.ok(held.length >= 4);
    assert.ok(held.every(event => event.type === 'mouseMoved' && event.button === button && event.buttons === buttons));
    const corner = held.findIndex(event => event.x === 240 && event.y === 50);
    assert.ok(corner >= 0);
    assert.ok(held.slice(0, corner + 1).every(event => event.y === 50 && event.x >= 40 && event.x <= 240));
    assert.ok(held.slice(corner + 1).every(event => event.x === 240 && event.y >= 50 && event.y <= 180));
    assert.deepEqual(events.at(-1), {type: 'mouseReleased', ...points.at(-1), button, buttons: 0, clickCount: 1});
    await run(t, input(cdp, 'browser_mouse_move', {tabId, x: 300, y: 200, durationMs: 0}));
    assert.equal(events.at(-1).buttons, 0);
    assert.equal(events.at(-1).button, 'none');
  }
});

test('Instantaneous and stationary strokes still move while held and release once', async t => {
  timers(t);
  for (const path of [points.slice(0, 2), [points[0], points[0]]]) {
    forgetPointer(tabId);
    const events = [];
    await run(t, input(browser(events), 'browser_mouse_drag', {tabId, points: path, durationMs: 0}));
    assert.ok(events.filter(event => event.type === 'mouseMoved' && event.buttons === 1).length >= 2);
    assert.equal(events.filter(event => event.type === 'mousePressed').length, 1);
    assert.equal(events.filter(event => event.type === 'mouseReleased').length, 1);
    assert.deepEqual(pointerPosition(tabId), path.at(-1));
  }
});

test('The duration budget covers the whole stroke and compensates CDP latency', async t => {
  timers(t);
  forgetPointer(tabId);
  const path = Array.from({length: 100}, (_, i) => ({x: 20 + i, y: 50 + i % 2}));
  let first, released;
  const observed = browser([], event => {
    if (event.type === 'mouseMoved' && event.buttons === 1 && first === undefined) first = Date.now();
    if (event.type === 'mouseReleased') released = Date.now();
  });
  const cdp = async (...args) => {await new Promise(resolve => setTimeout(resolve, 2)); return observed(...args);};
  await run(t, input(cdp, 'browser_mouse_drag', {tabId, points: path, durationMs: 600}));
  assert.ok(released - first >= 590 && released - first <= 650, `Actual movement took ${released - first} ms`);
});

test('Two-point strokes split into three random durations with an exact total', () => {
  const draws = [0, 0.25, 0.75];
  let index = 0;
  const path = [{x: 0, y: 0}, {x: 300, y: 0}];
  const segments = strokeSegments(path, 600, () => draws[index++]);
  assert.deepEqual(segments.map(segment => segment.point), [{x: 100, y: 0}, {x: 200, y: 0}, {x: 300, y: 0}]);
  assert.deepEqual(segments.map(segment => segment.duration), [120, 180, 300]);
  assert.equal(segments.reduce((sum, segment) => sum + segment.duration, 0), 600);
  assert.equal(index, 3, 'Choose the three phase weights once per stroke');
});

test('Random timing preserves corners, repeated points and stationary strokes', () => {
  let state = 10;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const paths = [points, [points[0], points[1], points[1], points[2]], [points[0], points[0]]];
  for (const path of paths) {
    for (const duration of [0, 1, 600, 10000]) {
      const segments = strokeSegments(path, duration, random);
      assert.ok(segments.every(segment => Number.isFinite(segment.duration) && segment.duration >= 0 && Number.isFinite(segment.point.x) && Number.isFinite(segment.point.y)));
      assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.duration, 0) - duration) < 0.000001);
      assert.deepEqual(segments.at(-1).point, path.at(-1));
      let next = 1;
      for (const segment of segments) if (next < path.length && segment.point.x === path[next].x && segment.point.y === path[next].y) next++;
      assert.equal(next, path.length, 'Every original waypoint must be visited in order');
    }
  }
});

test('Dispatched movements use three unequal phase budgets for default and explicit durations', async t => {
  timers(t);
  let state = 42;
  t.mock.method(Math, 'random', () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296));
  for (const durationMs of [undefined, 1200]) {
    forgetPointer(tabId);
    let first, boundary1, boundary2, released;
    const cdp = browser([], event => {
      if (event.type === 'mouseMoved' && event.buttons === 1) {
        first ??= Date.now();
        if (event.x === 140) boundary1 = Date.now();
        if (event.x === 240) boundary2 = Date.now();
      }
      if (event.type === 'mouseReleased') released = Date.now();
    });
    const args = {tabId, points: [{x: 40, y: 50}, {x: 340, y: 50}]};
    if (durationMs !== undefined) args.durationMs = durationMs;
    await run(t, input(cdp, 'browser_mouse_drag', args));
    const budgets = [boundary1 - first, boundary2 - boundary1, released - boundary2];
    assert.ok(budgets.every(ms => ms > 0));
    assert.ok(Math.abs(budgets.reduce((sum, ms) => sum + ms, 0) - (durationMs ?? 600)) <= 20);
    assert.ok(Math.max(...budgets) - Math.min(...budgets) > 1, 'The three portions must not all have the same duration');
  }
});

test('An offscreen intermediate or final point is rejected before warm-up or pressing', async () => {
  for (const index of [1, 2]) {
    forgetPointer(tabId);
    const events = [];
    const path = points.map((point, i) => i === index ? {x: 800, y: point.y} : point);
    await assert.rejects(input(browser(events), 'browser_mouse_drag', {tabId, points: path}, {warmup: true}), /Coordenadas/);
    assert.deepEqual(events, []);
  }
});

test('Failed press or movement attempts release at the last known position and preserve the error', async t => {
  timers(t);
  for (const failure of ['press', 'move']) {
    forgetPointer(tabId);
    const events = [];
    let moves = 0;
    const cdp = browser(events, event => {
      if ((failure === 'press' && event.type === 'mousePressed') || (failure === 'move' && event.type === 'mouseMoved' && event.buttons === 1 && ++moves === 2)) throw new Error('CDP failure');
    });
    await assert.rejects(run(t, input(cdp, 'browser_mouse_drag', {tabId, points, durationMs: 120})), /CDP failure/);
    const released = events.at(-1);
    assert.equal(released.type, 'mouseReleased');
    assert.equal(released.buttons, 0);
    assert.deepEqual({x: released.x, y: released.y}, pointerPosition(tabId));
    assert.equal(events.filter(event => event.type === 'mouseReleased').length, 1);
    assert.ok(!events.some(event => event.type === 'mouseMoved' && event.x === points.at(-1).x && event.y === points.at(-1).y));
  }
});

test('A failed release is reported rather than returning a successful stroke', async t => {
  timers(t);
  forgetPointer(tabId);
  const cdp = browser([], event => {if (event.type === 'mouseReleased') throw new Error('Release failure');});
  await assert.rejects(run(t, input(cdp, 'browser_mouse_drag', {tabId, points, durationMs: 0})), /Release failure/);
});

test('Automatic warm-up finishes before the stroke starts', async t => {
  timers(t);
  forgetPointer(tabId);
  const events = [];
  await run(t, input(browser(events), 'browser_mouse_drag', {tabId, points, durationMs: 0}, {warmup: true, sessionId: 'drag-test'}));
  const down = events.findIndex(event => event.type === 'mousePressed');
  assert.ok(down > 10);
  assert.ok(events.slice(0, down).every(event => event.type === 'mouseMoved' && event.buttons === 0));
  assert.ok(events.slice(down + 1, -1).every(event => event.buttons === 1));
});
