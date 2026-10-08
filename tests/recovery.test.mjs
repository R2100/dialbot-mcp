import test from 'node:test';
import assert from 'node:assert/strict';

test('A stalled CDP movement releases the button and frees the tab for subsequent operations', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const previous = globalThis.chrome;
  t.after(() => {if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;});
  const events = [];
  let stalled = false, resume;
  const event = {addListener() {}};
  globalThis.chrome = {
    debugger: {
      onDetach: event,
      async attach() {},
      async sendCommand(target, method, params) {
        if (method === 'Page.getLayoutMetrics') return {cssVisualViewport: {clientWidth: 800, clientHeight: 600}};
        events.push(params);
        if (params.type === 'mouseMoved' && params.buttons === 1 && !stalled) {
          stalled = true;
          return new Promise(resolve => {resume = resolve;});
        }
        if (params.type === 'mouseReleased') resume?.({});
        return {};
      }
    },
    tabs: {onRemoved: event, onUpdated: event}
  };
  const {execute} = await import('../extension/browser.js');
  let outcome;
  const job = execute('browser_mouse_drag', {tabId: 70, points: [{x: 20, y: 20}, {x: 200, y: 20}], durationMs: 0}).then(value => {outcome = {value};}, error => {outcome = {error};});
  for (let i = 0; i < 500 && !outcome; i++) {
    for (let j = 0; j < 10; j++) await Promise.resolve();
    t.mock.timers.tick(50);
  }
  await job;
  assert.match(outcome.error.message, /Chrome no respondió a Input.dispatchMouseEvent/);
  assert.ok(events.some(params => params.type === 'mouseReleased' && params.buttons === 0));
  assert.deepEqual(await execute('browser_mouse_move', {tabId: 70, x: 300, y: 40, durationMs: 0}), {moved: true});
});
