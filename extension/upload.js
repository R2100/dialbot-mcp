import {input} from './input.js';

export function fileInputs() {
  return [...document.querySelectorAll('input[type="file"]')].map(element => {
    const parts = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const siblings = [...(node.parentElement?.children ?? [])].filter(sibling => sibling.tagName === node.tagName);
      parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1 || 1})`);
    }
    return {selector: parts.join(' > '), accept: element.accept, multiple: element.multiple, disabled: element.matches(':disabled'), name: element.getAttribute('aria-label') || element.name || '', visible: Boolean(element.getClientRects().length)};
  });
}

export async function upload(cdp, name, args, context) {
  const {tabId, files} = args;
  let target;
  if (name === 'browser_upload') {
    const {root} = await cdp(tabId, 'DOM.getDocument');
    const {nodeIds} = await cdp(tabId, 'DOM.querySelectorAll', {nodeId: root.nodeId, selector: args.selector});
    if (nodeIds.length !== 1) throw new Error(`The selector must match a single field; found: ${nodeIds.length}`);
    const {node} = await cdp(tabId, 'DOM.describeNode', {nodeId: nodeIds[0]});
    const attributes = new Map();
    for (let i = 0; i < (node.attributes?.length ?? 0); i += 2) attributes.set(node.attributes[i], node.attributes[i + 1]);
    if (node.nodeName !== 'INPUT' || attributes.get('type')?.toLowerCase() !== 'file') throw new Error('A file input is required');
    // :disabled includes inherited fieldset restrictions.
    const {nodeIds: disabled} = await cdp(tabId, 'DOM.querySelectorAll', {nodeId: root.nodeId, selector: 'input[type="file"]:disabled'});
    if (disabled.includes(node.nodeId)) throw new Error('Field is disabled');
    if (files.length > 1 && !attributes.has('multiple')) throw new Error('The field does not support multiple files');
    target = {nodeId: node.nodeId};
    await cdp(tabId, 'DOM.setFileInputFiles', {...target, files});
  } else {
    let timer;
    let listener;
    const chooser = new Promise(resolve => {
      listener = (source, method, params) => {
        if (source.tabId === tabId && !source.sessionId && method === 'Page.fileChooserOpened') resolve(params);
      };
      chrome.debugger.onEvent.addListener(listener);
      timer = setTimeout(() => resolve(null), 8000);
    });
    try {
      await cdp(tabId, 'Page.enable');
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', {enabled: true});
      await input(cdp, 'browser_mouse_click', {tabId, x: args.x, y: args.y}, context);
      const opened = await chooser;
      if (!opened?.backendNodeId) throw new Error('No compatible file chooser opened; check the page before retrying');
      if (files.length > 1 && opened.mode !== 'selectMultiple') throw new Error('The chooser does not support multiple files');
      target = {backendNodeId: opened.backendNodeId};
      await cdp(tabId, 'DOM.setFileInputFiles', {...target, files});
    } finally {
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      await cdp(tabId, 'Page.setInterceptFileChooserDialog', {enabled: false});
    }
  }
  return {selectionSent: true, count: files.length, names: files.map(path => path.split(/[\\/]/).pop()), uploadComplete: 'unknown', note: 'Check the preview and progress on the page. No publish button was pressed.'};
}
