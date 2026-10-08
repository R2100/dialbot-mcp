import test from 'node:test';
import assert from 'node:assert/strict';

test('beforeunload cancels navigation without leaving the tab busy', async t => {
  const previous = globalThis.chrome;
  t.after(() => {if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous;});
  const debuggerListeners = new Set();
  const event = {addListener() {}};
  const commands = [];
  globalThis.chrome = {
    debugger: {
      onDetach: event,
      onEvent: {
        addListener(listener) {debuggerListeners.add(listener);},
        removeListener(listener) {debuggerListeners.delete(listener);}
      },
      async attach() {},
      async sendCommand(target, method, params = {}) {
        commands.push({target, method, params});
        return {};
      }
    },
    scripting: {
      async executeScript() {return [{result: {title: 'Draft', url: 'https://example.test/draft', text: 'still usable'}}];}
    },
    tabs: {
      onRemoved: event,
      onUpdated: event,
      async update(tabId) {
        setTimeout(() => {
          for (const listener of debuggerListeners) listener({tabId}, 'Page.javascriptDialogOpening', {type: 'beforeunload'});
        }, 0);
        return {id: tabId, title: 'Draft', url: 'https://example.test/draft', active: true, windowId: 1};
      }
    }
  };
  const {execute} = await import('../extension/browser.js');
  await assert.rejects(
    execute('browser_navigate', {tabId: 80, url: 'https://example.test/next'}),
    /Navegación cancelada: la página tiene cambios sin guardar/
  );
  assert.ok(commands.some(({method, params}) => method === 'Page.handleJavaScriptDialog' && params.accept === false));
  assert.deepEqual(await execute('browser_read', {tabId: 80, maxChars: 100}), {title: 'Draft', url: 'https://example.test/draft', text: 'still usable'});
});
