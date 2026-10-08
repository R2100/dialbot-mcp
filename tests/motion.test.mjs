import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectory, logPause} from '../extension/motion.js';
import {input, forgetPointer} from '../extension/input.js';
test('Gaussian trajectories stay bounded and land exactly after overshoot', () => {
  let state = 123;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 100; i++) {
    const target = {x: random() * 799, y: random() * 599};
    const path = trajectory({x: 1, y: 1}, target, {width: 800, height: 600}, {duration: 600, random});
    assert.equal(path.at(-1).x, target.x);
    assert.equal(path.at(-1).y, target.y);
    assert.ok(path.every(p => p.x >= 0 && p.x < 800 && p.y >= 0 && p.y < 600));
    assert.ok(logPause(200, 50, 500, random) >= 50);
  }
  const path = trajectory({x: 0, y: 100}, {x: 400, y: 100}, {width: 800, height: 600}, {duration: 600, random});
  assert.ok(path.some(point => point.x > 400));
  assert.ok(path.some(point => point.y !== 100));
  const direct = trajectory({x: 0, y: 0}, {x: 20, y: 30}, {width: 100, height: 100}, {human: false, duration: 0});
  assert.equal(direct.length, 1);
});
test('Automatic warm-up runs once per session and resets on navigation', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const moves = [];
  const cdp = async (tabId, method, params) => {
    if (method === 'Page.getLayoutMetrics') return {cssVisualViewport: {clientWidth: 800, clientHeight: 600}};
    if (method === 'Input.dispatchMouseEvent') moves.push(params);
    return {};
  };
  async function run() {
    let finished = false;
    const job = input(cdp, 'browser_mouse_move', {tabId: 20, x: 400, y: 300, durationMs: 0}, {warmup: true, sessionId: 'test'}).finally(() => {finished = true;});
    for (let i = 0; i < 2000 && !finished; i++) {await Promise.resolve(); t.mock.timers.tick(1000);}
    await job;
  }
  await run(); const first = moves.length;
  assert.ok(first > 10);
  await run(); assert.equal(moves.length, first + 1);
  forgetPointer(20);
  await run(); assert.ok(moves.length > first + 10);
  assert.ok(moves.every(event => event.type === 'mouseMoved'));
});
