import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {tools, availableTools, normalizeMode, validate} from './tools.mjs';
import {callBrowser} from './bridge-client.mjs';
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
let mode = normalizeMode(process.env.BROWSER_MODE ?? 'fast');
let activeCalls = 0;
const sessionId = randomUUID();
const touchedTabs = new Set();
const preferences = {cursor: 'auto', motion: 'auto', warmup: false};
const behavior = () => ({cursor: preferences.cursor === 'auto' ? mode === 'fast' : preferences.cursor === 'on', humanMotion: preferences.motion === 'auto' ? mode === 'normal' : preferences.motion === 'human', warmup: preferences.warmup, sessionId});
async function syncCursor() {
  const warnings = [];
  for (const tabId of touchedTabs) {
    try {const result = await callBrowser('browser_behavior', {tabId}, behavior()); if (result.cursorWarning) warnings.push({tabId, error: result.cursorWarning});}
    catch (e) {warnings.push({tabId, error: e.message}); touchedTabs.delete(tabId);}
  }
  return warnings;
}
const instructions = 'Use browser_mode to query or switch modes when the user asks. fast prioritizes DOM reading and selector-based actions without unnecessary screenshots. normal requires screenshots, mouse and keyboard to read and interact with content; it blocks the session\'s DOM tools. Do not switch from normal to fast on your own initiative to work around an error. The mode belongs to this MCP connection; tabs are preserved. normal does not guarantee undetectability and does not undo previous fast actions. With browser_batch chain only actions already verified in this session, with reasonable pauseMs pauses: it is for repeating stable flows, not for exploring; its mechanical cadence is observable by the page and does not guarantee undetectability. Track progress with browser_batch_status and cancel with browser_batch_cancel.';
let initialized = false;
const batch = {running: false, steps: [], index: 0, results: [], cancelled: false, stoppedOn: null, finished: null, messageId: null, progressToken: undefined};
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const sleep = ms => new Promise(resolve => {
  const timer = setTimeout(() => {batch.wake = null; resolve();}, ms);
  batch.wake = () => {batch.wake = null; clearTimeout(timer); resolve();};
});
function requestCancelled(message) {
  const token = message.params?.requestId;
  if (typeof token !== 'object' || token === null) return;
  const id = Object.values(token)[0];
  if (id !== undefined && [batch.messageId, batch.progressToken].includes(id)) batch.cancelled = true;
  batch.wake?.();
}
async function handle(message) {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return write({jsonrpc: '2.0', id: message?.id ?? null, error: {code: -32600, message: 'Invalid request'}});
  if (!Object.hasOwn(message, 'id')) return;
  const reply = result => write({jsonrpc: '2.0', id: message.id, result});
  const error = (code, text) => write({jsonrpc: '2.0', id: message.id, error: {code, message: text}});
  if (message.method === 'initialize') {
    initialized = true;
    return reply({protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'dialbot-mcp', version: '0.4.4'}, instructions: `Initial mode: ${mode}. ${instructions} Use browser_outline for links and menus in fast; browser_activate to activate tabs; browser_behavior for cursor, human motion and warm-up per prompt. Cursor auto is visible only in fast; motion auto is human in normal. Automatic warm-up is initially off. For attachments use browser_file_inputs and browser_upload in fast, or browser_upload_click after a screenshot. Selecting files may start their transfer to the site; it does not confirm upload completion. Check the page and respect the user's instructions about publishing.`});
  }
  if (message.method === 'ping') return reply({});
  if (message.method === 'notifications/cancelled') return requestCancelled(message);
  if (!initialized) return error(-32002, 'Initialize the session first');
  if (message.method === 'tools/list') return reply({tools});
  if (message.method === 'tools/call') {
    const {name, arguments: args = {}} = message.params ?? {};
    try {
      validate(name, args);
    } catch (e) {return error(-32602, e.message);}
    if (name === 'browser_mode') {
      if (args.mode && args.mode !== mode && activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Wait for pending operations to finish before switching modes.'}]});
      const previousMode = mode;
      if (args.mode) mode = args.mode;
      let warnings = [];
      if (mode !== previousMode) {activeCalls++; try {warnings = await syncCursor();} finally {activeCalls--;}}
      return reply({content: [{type: 'text', text: JSON.stringify({mode, previousMode, changed: mode !== previousMode, scope: 'mcp-session', behavior: behavior(), warnings, allowedTools: availableTools(mode).map(tool => tool.name), guidance: instructions})}]});
    }
    if (name === 'browser_behavior') {
      const changing = Object.keys(args).length > 0;
      if (changing && activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Wait for the running operation to finish before changing behavior.'}]});
      for (const key of ['cursor', 'motion', 'warmup']) if (args[key] !== undefined) preferences[key] = args[key];
      if (args.tabId !== undefined) touchedTabs.add(args.tabId);
      let warnings = [];
      if (changing) {activeCalls++; try {warnings = await syncCursor();} finally {activeCalls--;}}
      return reply({content: [{type: 'text', text: JSON.stringify({preferences, effective: behavior(), scope: 'mcp-session', warnings})}]});
    }
    if (name === 'browser_batch_status') return reply({content: [{type: 'text', text: JSON.stringify(batchStatus())}]});
    if (name === 'browser_batch_cancel') {
      if (batch.running) batch.cancelled = true;
      batch.wake?.();
      return reply({content: [{type: 'text', text: JSON.stringify(batchStatus())}]});
    }
    if (name === 'browser_batch') {
      if (batch.running) return reply({isError: true, content: [{type: 'text', text: 'A batch is already running; wait for it to finish, check with browser_batch_status or cancel it with browser_batch_cancel.'}]});
      if (activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Wait for pending operations to finish before starting a batch.'}]});
      batch.progressToken = message.params?._meta?.progressToken;
      batch.messageId = message.id;
      batch.running = true; batch.steps = args.steps; batch.index = 0; batch.results = []; batch.cancelled = false; batch.stoppedOn = null; batch.finished = null;
      runBatch(Date.now(), args.stopOnError ?? true).catch(e => write({jsonrpc: '2.0', id: message.id, error: {code: -32603, message: e.message}}));
      return;
    }
    if (!availableTools(mode).some(tool => tool.name === name)) return reply({isError: true, content: [{type: 'text', text: `The tool ${name} is blocked in normal mode. Use screenshots, mouse and keyboard. Switch with browser_mode only if the user asks.`}]});
    activeCalls++;
    try {
      if (args.tabId !== undefined && name !== 'browser_close') touchedTabs.add(args.tabId);
      const result = await callBrowser(name, args, behavior());
      if (name === 'browser_close') touchedTabs.delete(args.tabId);
      if (name === 'browser_screenshot') {
        const png = Buffer.from(result.data, 'base64');
        const image = {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
        const metadata = {viewport: result.viewport, image, coordinateSystem: result.coordinateSystem, ...(result.cursorWarning ? {cursorWarning: result.cursorWarning} : {}), imagePixelsPerCssPixel: {x: image.width / result.viewport.width, y: image.height / result.viewport.height}};
        return reply({content: [{type: 'image', data: result.data, mimeType: 'image/png'}, {type: 'text', text: JSON.stringify(metadata)}]});
      }
      return reply({content: [{type: 'text', text: JSON.stringify(result)}]});
    } catch (e) {return reply({isError: true, content: [{type: 'text', text: e.message}]});}
    finally {activeCalls--;}
  }
  error(-32601, 'Method not found');
}
function batchStatus() {
  return {running: batch.running, totalSteps: batch.steps.length, stepIndex: batch.index, cancelled: batch.cancelled, results: batch.results.map(entry => ({index: entry.index, name: entry.name, ok: entry.ok, ...(entry.ok ? {result: entry.result} : {error: entry.error})}))};
}
function notifyProgress(stepName, index) {
  if (batch.progressToken === undefined) return;
  write({jsonrpc: '2.0', method: 'notifications/progress', params: {progressToken: batch.progressToken, progress: index, total: batch.steps.length, message: stepName}});
}
async function runBatch(startedAt, stopOnError) {
  let stoppedOn = null;
  activeCalls++;
  try {
    for (; batch.index < batch.steps.length; batch.index++) {
      if (batch.cancelled) break;
      const step = batch.steps[batch.index];
      notifyProgress(step.name, batch.index);
      let entry;
      try {
        if (step.arguments?.tabId !== undefined && step.name !== 'browser_close') touchedTabs.add(step.arguments.tabId);
        const result = await callBrowser(step.name, step.arguments ?? {}, behavior());
        entry = {index: batch.index, name: step.name, ok: true, result};
      } catch (e) {
        entry = {index: batch.index, name: step.name, ok: false, error: e.message};
      }
      batch.results.push(entry);
      if (!entry.ok && stopOnError) {
        stoppedOn = batch.index;
        break;
      }
      if (step.pauseMs) await sleep(step.pauseMs);
    }
  } finally {
    activeCalls--;
    batch.running = false;
    batch.finished = Date.now();
    batch.stoppedOn = stoppedOn;
    const cancelled = batch.cancelled && stoppedOn === null;
    batch.results.forEach(entry => {if (!entry.ok) touchedTabs.delete(batch.steps[entry.index].arguments?.tabId);});
    write({jsonrpc: '2.0', id: batch.messageId, result: {content: [{type: 'text', text: JSON.stringify({results: batch.results.map(entry => ({index: entry.index, name: entry.name, ok: entry.ok, ...(entry.ok ? {result: entry.result} : {error: entry.error})})), cancelled, stoppedOn, elapsedMs: Date.now() - startedAt})}], isError: stoppedOn !== null || cancelled}});
  }
}
const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
input.on('line', line => {
  let message;
  try {message = JSON.parse(line);} catch {write({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Invalid JSON'}}); return;}
  handle(message).catch(e => write({jsonrpc: '2.0', id: message?.id ?? null, error: {code: -32603, message: e.message}}));
});
