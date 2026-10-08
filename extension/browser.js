import {input, forgetPointer, pointerPosition, warmup} from './input.js';
import {cursor, forgetCursor} from './cursor.js';
import {outline} from './outline.js';
import {fileInputs, upload} from './upload.js';
const attached = new Set();
const busy = new Set();
chrome.debugger.onDetach.addListener(({tabId}) => attached.delete(tabId));
chrome.tabs.onRemoved.addListener(tabId => {attached.delete(tabId); forgetPointer(tabId); forgetCursor(tabId);});
chrome.tabs.onUpdated.addListener((tabId, change) => {if (change.status === 'loading') {forgetPointer(tabId); forgetCursor(tabId);}});
async function cdp(tabId, method, params = {}) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({tabId}, '1.3');
    attached.add(tabId);
  }
  let timer;
  try {
    return await Promise.race([
      chrome.debugger.sendCommand({tabId}, method, params),
      new Promise((resolve, reject) => {timer = setTimeout(() => reject(new Error(`Chrome no respondió a ${method}; comprueba el navegador antes de repetir.`)), 5000);})
    ]);
  } finally {clearTimeout(timer);}
}
const tabInfo = tab => ({tabId: tab.id, title: tab.title, url: tab.url, active: tab.active, windowId: tab.windowId});
function navigationUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) && value !== 'about:blank') throw new Error('Solo navegación web o about:blank');
  return value;
}
async function navigate(tabId, url) {
  let listener;
  let timer;
  let resolveDialog;
  const dialog = new Promise(resolve => {resolveDialog = resolve;});
  listener = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId || method !== 'Page.javascriptDialogOpening' || params.type !== 'beforeunload') return;
    cdp(tabId, 'Page.handleJavaScriptDialog', {accept: false})
      .then(() => resolveDialog({dismissed: true}), error => resolveDialog({error}));
  };
  chrome.debugger.onEvent.addListener(listener);
  try {
    await cdp(tabId, 'Page.enable');
    const updated = await Promise.race([
      chrome.tabs.update(tabId, {url}),
      dialog.then(result => {
        if (result.error) throw result.error;
        throw new Error('Navegación cancelada: la página tiene cambios sin guardar. Limpia o descarta el borrador antes de navegar.');
      })
    ]);
    const result = await Promise.race([
      dialog,
      new Promise(resolve => {timer = setTimeout(() => resolve(null), 500);})
    ]);
    if (result?.error) throw result.error;
    if (result?.dismissed) throw new Error('Navegación cancelada: la página tiene cambios sin guardar. Limpia o descarta el borrador antes de navegar.');
    return tabInfo(updated);
  } finally {
    clearTimeout(timer);
    chrome.debugger.onEvent.removeListener(listener);
  }
}
async function dom(tabId, operation, args, showCursor = false) {
  const results = await chrome.scripting.executeScript({
    target: {tabId},
    func: (operation, args, showCursor) => {
      try {
      if (operation === 'read') return {title: document.title, url: location.href, text: document.body.innerText.slice(0, args.maxChars ?? 20000)};
      const nodes = document.querySelectorAll(args.selector);
      if (nodes.length !== 1) throw new Error(`El selector debe identificar un elemento; encontrados: ${nodes.length}`);
      const element = nodes[0];
      if (element.disabled || !element.getClientRects().length) throw new Error('Elemento oculto o deshabilitado');
      element.scrollIntoView({block: 'center'});
      if (showCursor) {
        const rect = element.getBoundingClientRect();
        globalThis.__dialbotCrosshair?.move({clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2});
      }
      if (operation === 'click') { element.click(); return {clicked: true}; }
      if (operation === 'fill') {
        if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || element.readOnly || ['file', 'checkbox', 'radio', 'button', 'submit'].includes(element.type)) throw new Error('Se requiere un campo de texto editable');
        const prototype = element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, args.text);
        element.dispatchEvent(new Event('input', {bubbles: true}));
        element.dispatchEvent(new Event('change', {bubbles: true}));
        return {filled: true};
      }
      } catch (error) { return {operationError: error.message}; }
    },
    args: [operation, args, showCursor]
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  if (results[0]?.result?.operationError) throw new Error(results[0].result.operationError);
  if (results[0]?.result === undefined) throw new Error('La operación DOM no devolvió resultado');
  return results[0].result;
}
export async function execute(name, args, context = {}) {
  if (args.tabId !== undefined && busy.has(args.tabId)) throw new Error('Pestaña ocupada; espera a que termine la operación anterior');
  if (args.tabId !== undefined) busy.add(args.tabId);
  try {
    let cursorWarning;
    if (args.tabId !== undefined && name !== 'browser_close') {
      try {await cursor(args.tabId, context.cursor === true, pointerPosition(args.tabId));} catch (error) {cursorWarning = error.message;}
    }
    const onPointer = context.cursor === true && args.tabId !== undefined ? point => cursor(args.tabId, true, point).catch(error => {cursorWarning = error.message;}) : undefined;
    const result = await executeAction(name, args, {...context, onPointer});
    if (cursorWarning && result && !Array.isArray(result)) result.cursorWarning = cursorWarning;
    return result;
  } finally {busy.delete(args.tabId);}
}
async function executeAction(name, args, context) {
  switch (name) {
    case 'browser_file_inputs': {
      const results = await chrome.scripting.executeScript({target: {tabId: args.tabId}, func: fileInputs});
      if (!results[0]?.result) throw new Error('No se pudieron listar los campos');
      return {inputs: results[0].result};
    }
    case 'browser_upload':
    case 'browser_upload_click': return upload(cdp, name, args, context);
    case 'browser_behavior': return {cursor: context.cursor === true};
    case 'browser_activate': {
      const tab = await chrome.tabs.update(args.tabId, {active: true});
      await chrome.windows.update(tab.windowId, {focused: true});
      return tabInfo(tab);
    }
    case 'browser_outline': {
      const results = await chrome.scripting.executeScript({target: {tabId: args.tabId}, func: outline, args: [args]});
      if (!results[0]?.result) throw new Error('No se pudo obtener el listado');
      return results[0].result;
    }
    case 'browser_warmup':
    case 'browser_mouse_move':
    case 'browser_mouse_click':
    case 'browser_mouse_drag':
    case 'browser_scroll':
    case 'browser_sendkeys':
    case 'browser_paste':
    case 'browser_type': return input(cdp, name, args, context);
    case 'browser_tabs': return (await chrome.tabs.query({})).map(tabInfo);
    case 'browser_open': return tabInfo(await chrome.tabs.create({url: navigationUrl(args.url), active: args.active ?? true}));
    case 'browser_navigate': return navigate(args.tabId, navigationUrl(args.url));
    case 'browser_close': await chrome.tabs.remove(args.tabId); return {closed: true};
    case 'browser_read': return dom(args.tabId, 'read', args);
    case 'browser_click':
    case 'browser_fill': await warmup(cdp, args.tabId, context); return dom(args.tabId, name === 'browser_click' ? 'click' : 'fill', args, context.cursor);
    case 'browser_screenshot': {
      const {cssVisualViewport} = await cdp(args.tabId, 'Page.getLayoutMetrics');
      const capture = await cdp(args.tabId, 'Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
      return {...capture, viewport: {width: cssVisualViewport.clientWidth, height: cssVisualViewport.clientHeight}, coordinateSystem: 'CSS pixels relative to visible viewport'};
    }
    case 'browser_detach': if (attached.has(args.tabId)) await chrome.debugger.detach({tabId: args.tabId}); attached.delete(args.tabId); return {detached: true};
    default: throw new Error('Herramienta desconocida');
  }
}
