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
const instructions = 'Usa browser_mode para consultar o cambiar de modo cuando el usuario lo pida. fast prioriza lectura DOM y acciones por selectores, sin capturas innecesarias. normal requiere capturas, ratón y teclado para leer e interactuar con el contenido; bloquea las herramientas DOM. No cambies de normal a fast por iniciativa propia para sortear un error. El modo pertenece a esta conexión MCP; las pestañas se conservan. normal no garantiza indetectabilidad y no revierte las acciones anteriores. Con browser_batch encadena solo acciones ya verificadas esta sesión, con pausas razonables en pauseMs: es para repetir flujos estables, no para explorar; su cadencia mecánica es observable por la página y no garantiza indetectabilidad. Controla el progreso con browser_batch_status y cancela con browser_batch_cancel.';
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
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return write({jsonrpc: '2.0', id: message?.id ?? null, error: {code: -32600, message: 'Petición inválida'}});
  if (!Object.hasOwn(message, 'id')) return;
  const reply = result => write({jsonrpc: '2.0', id: message.id, result});
  const error = (code, text) => write({jsonrpc: '2.0', id: message.id, error: {code, message: text}});
  if (message.method === 'initialize') {
    initialized = true;
    return reply({protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'dialbot-mcp', version: '0.4.3'}, instructions: `Modo inicial: ${mode}. ${instructions} Usa browser_outline para enlaces y menús en fast; browser_activate para activar pestañas; browser_behavior para cursor, movimiento humano y warm-up por prompt. Cursor auto está visible solo en fast; movimiento auto es humano en normal. Warm-up automático desactivado inicialmente. Para adjuntos usa browser_file_inputs y browser_upload en fast, o browser_upload_click tras una captura en normal. Seleccionar archivos puede iniciar su transferencia al sitio; no confirma fin de subida. Comprueba la página y respeta las instrucciones del usuario sobre publicación.`});
  }
  if (message.method === 'ping') return reply({});
  if (message.method === 'notifications/cancelled') return requestCancelled(message);
  if (!initialized) return error(-32002, 'Inicializa la sesión primero');
  if (message.method === 'tools/list') return reply({tools});
  if (message.method === 'tools/call') {
    const {name, arguments: args = {}} = message.params ?? {};
    try {
      validate(name, args);
    } catch (e) {return error(-32602, e.message);}
    if (name === 'browser_mode') {
      if (args.mode && args.mode !== mode && activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Espera a que terminen las operaciones pendientes antes de cambiar de modo.'}]});
      const previousMode = mode;
      if (args.mode) mode = args.mode;
      let warnings = [];
      if (mode !== previousMode) {activeCalls++; try {warnings = await syncCursor();} finally {activeCalls--;}}
      return reply({content: [{type: 'text', text: JSON.stringify({mode, previousMode, changed: mode !== previousMode, scope: 'mcp-session', behavior: behavior(), warnings, allowedTools: availableTools(mode).map(tool => tool.name), guidance: instructions})}]});
    }
    if (name === 'browser_behavior') {
      const changing = Object.keys(args).length > 0;
      if (changing && activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Espera a que termine la operación antes de cambiar el comportamiento.'}]});
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
      if (batch.running) return reply({isError: true, content: [{type: 'text', text: 'Ya hay un lote en curso; espera su finalización, consulta con browser_batch_status o cáncelalo con browser_batch_cancel.'}]});
      if (activeCalls) return reply({isError: true, content: [{type: 'text', text: 'Espera a que terminen las operaciones pendientes antes de iniciar un lote.'}]});
      batch.progressToken = message.params?._meta?.progressToken;
      batch.messageId = message.id;
      batch.running = true; batch.steps = args.steps; batch.index = 0; batch.results = []; batch.cancelled = false; batch.stoppedOn = null; batch.finished = null;
      runBatch(Date.now(), args.stopOnError ?? true).catch(e => write({jsonrpc: '2.0', id: message.id, error: {code: -32603, message: e.message}}));
      return;
    }
    if (!availableTools(mode).some(tool => tool.name === name)) return reply({isError: true, content: [{type: 'text', text: `La herramienta ${name} está bloqueada en modo normal. Usa capturas, ratón y teclado. Cambia con browser_mode solo si el usuario lo solicita.`}]});
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
  error(-32601, 'Método desconocido');
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
  try {message = JSON.parse(line);} catch {write({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'JSON inválido'}}); return;}
  handle(message).catch(e => write({jsonrpc: '2.0', id: message?.id ?? null, error: {code: -32603, message: e.message}}));
});
