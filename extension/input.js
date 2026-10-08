import {trajectory, logPause, strokeSegments} from './motion.js';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pointerPositions = new Map();
const warmed = new Map();
const buttonBits = {none: 0, left: 1, right: 2, middle: 4};
export const forgetPointer = tabId => {pointerPositions.delete(tabId); warmed.delete(tabId);};
export const pointerPosition = tabId => pointerPositions.get(tabId);
async function viewport(cdp, tabId) {
  const {cssVisualViewport: view} = await cdp(tabId, 'Page.getLayoutMetrics');
  return {width: view.clientWidth, height: view.clientHeight};
}
async function movePointer(cdp, tabId, target, bounds, human, duration, button = 'none', timing, onPointer) {
  const previous = pointerPositions.get(tabId) ?? (human ? {x: 2, y: 2} : target);
  const ms = duration ?? (human ? logPause(180 + Math.sqrt(Math.hypot(target.x - previous.x, target.y - previous.y)) * 18, 160, 900) : 0);
  for (const point of trajectory(previous, target, bounds, {human, duration: ms, minSteps: button === 'none' ? 1 : 2, stepMs: button === 'none' ? 20 : 40})) {
    await Promise.all([
      cdp(tabId, 'Input.dispatchMouseEvent', {type: 'mouseMoved', button, buttons: buttonBits[button], x: point.x, y: point.y}),
      onPointer?.({x: point.x, y: point.y})
    ]);
    pointerPositions.set(tabId, {x: point.x, y: point.y});
    if (timing) {
      timing.deadline += point.delay;
      const remaining = timing.deadline - performance.now();
      if (remaining > 0) await pause(remaining);
    } else if (point.delay) await pause(point.delay);
  }
}
export async function warmup(cdp, tabId, context, force = false) {
  let sessions = warmed.get(tabId);
  if (!force && (!context.warmup || sessions?.has(context.sessionId))) return;
  const bounds = await viewport(cdp, tabId);
  const corner = {x: Math.min(2, bounds.width - 1), y: Math.min(2, bounds.height - 1)};
  await movePointer(cdp, tabId, corner, bounds, false, 0, 'none', undefined, context.onPointer);
  for (let i = 0; i < 3; i++) {
    const point = {x: bounds.width * (0.05 + Math.random() * 0.18), y: bounds.height * (0.04 + Math.random() * 0.2)};
    await movePointer(cdp, tabId, point, bounds, true, logPause(220, 120, 380), 'none', undefined, context.onPointer);
    await pause(logPause(350, 150, 650));
  }
  if (!sessions) {sessions = new Set(); warmed.set(tabId, sessions);}
  sessions.add(context.sessionId);
  if (sessions.size > 100) sessions.delete(sessions.values().next().value);
  return {warmed: true, clicks: 0, pointer: pointerPositions.get(tabId)};
}
const special = {
  Enter: ['Enter', 13], Tab: ['Tab', 9], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
  Escape: ['Escape', 27], ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38],
  ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36],
  End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Space: ['Space', 32],
  Control: ['ControlLeft', 17], Shift: ['ShiftLeft', 16], Alt: ['AltLeft', 18], Meta: ['MetaLeft', 91]
};
const modifierBits = {Control: 2, Shift: 8, Alt: 1, Meta: 4};
function keyInfo(key) {
  if (special[key]) return {key: key === 'Space' ? ' ' : key, code: special[key][0], windowsVirtualKeyCode: special[key][1]};
  if (/^[a-z]$/i.test(key)) return {key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0)};
  if (/^[0-9]$/.test(key)) return {key, code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0)};
  throw new Error(`Unsupported key: ${key}`);
}
export function parseKeys(keys) {
  const parts = keys.split('+');
  const key = parts.pop();
  if (!key || parts.some(part => !modifierBits[part]) || new Set(parts).size !== parts.length || modifierBits[key]) throw new Error('Use a key or a chord, for example Control+A or Shift+Tab');
  return {modifiers: parts, key: keyInfo(key)};
}
async function sendKeys(cdp, tabId, keys, holdMs = 40) {
  const parsed = parseKeys(keys);
  const held = [];
  let mask = 0;
  const dispatch = params => cdp(tabId, 'Input.dispatchKeyEvent', params);
  try {
    for (const modifier of parsed.modifiers) {
      mask |= modifierBits[modifier];
      const info = keyInfo(modifier);
      held.push(info);
      await dispatch({...info, type: 'rawKeyDown', modifiers: mask});
    }
    const info = parsed.key;
    held.push(info);
    const text = !(mask & 7) ? (info.key === 'Enter' ? '\r' : info.key.length === 1 ? (mask & 8 ? info.key.toUpperCase() : info.key) : '') : '';
    await dispatch({...info, type: text ? 'keyDown' : 'rawKeyDown', modifiers: mask, ...(text ? {text, unmodifiedText: text} : {})});
    await pause(holdMs);
  } finally {
    for (const info of held.reverse()) {
      mask &= ~(modifierBits[info.key] ?? 0);
      await dispatch({...info, type: 'keyUp', modifiers: mask}).catch(() => {});
    }
  }
}
export async function input(cdp, name, args, context = {}) {
  const {tabId, x, y} = args;
  const human = context.humanMotion === true;
  if (name === 'browser_warmup') return warmup(cdp, tabId, context, true);
  if (name === 'browser_sendkeys') {parseKeys(args.keys); await warmup(cdp, tabId, context); await sendKeys(cdp, tabId, args.keys, human ? logPause(45, 20, 90) : 40); return {sent: true};}
  if (name === 'browser_paste') {
    if (!args.text.length) return {inserted: 0};
    await warmup(cdp, tabId, context);
    await sendKeys(cdp, tabId, 'Control+V', human ? logPause(45, 20, 90) : 40);
    return {inserted: [...args.text].length};
  }
  if (name === 'browser_type') {
    const text = args.text;
    const delay = args.delayMs ?? 40;
    const plan = [...text].map(char => ({char, delay: human && delay > 0 ? logPause(delay, 0, 180) : delay, hold: human ? logPause(25, 12, 55) : 0}));
    if (plan.length > 200 || plan.reduce((sum, step) => sum + step.delay + step.hold + 10, 0) > 18000) throw new Error('Split the text into blocks of up to 200 characters and less than 18 seconds');
    await warmup(cdp, tabId, context);
    for (const {char, delay: gap, hold} of plan) {
      if (char === '\n' || char === '\t') await sendKeys(cdp, tabId, char === '\n' ? 'Enter' : 'Tab', hold);
      else if (/^[A-Z]$/.test(char)) await sendKeys(cdp, tabId, `Shift+${char}`, hold);
      else {
        let info;
        try {info = keyInfo(char === ' ' ? 'Space' : char);} catch {}
        if (info) {
          try {await cdp(tabId, 'Input.dispatchKeyEvent', {...info, type: 'keyDown', text: char, unmodifiedText: char}); await pause(hold);}
          finally {await cdp(tabId, 'Input.dispatchKeyEvent', {...info, type: 'keyUp'}).catch(() => {});}
        } else await cdp(tabId, 'Input.insertText', {text: char});
      }
      await pause(gap);
    }
    return {typed: [...text].length};
  }
  const bounds = await viewport(cdp, tabId);
  const targets = name === 'browser_mouse_drag' ? args.points : [{x, y}];
  if (targets.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height)) throw new Error('Coordinates outside the visible area; use CSS pixels from the top-left corner');
  await warmup(cdp, tabId, context);
  if (name === 'browser_mouse_drag') {
    const first = targets[0];
    const button = args.button ?? 'left';
    await movePointer(cdp, tabId, first, bounds, human, undefined, 'none', undefined, context.onPointer);
    const segments = strokeSegments(targets, args.durationMs ?? 600);
    try {
      await cdp(tabId, 'Input.dispatchMouseEvent', {type: 'mousePressed', ...first, button, buttons: buttonBits[button], clickCount: 1});
      await pause(human ? logPause(60, 30, 110) : 60);
      const timing = {deadline: performance.now()};
      for (const segment of segments) {
        await movePointer(cdp, tabId, segment.point, bounds, false, segment.duration, button, timing, context.onPointer);
      }
    } finally {
      await cdp(tabId, 'Input.dispatchMouseEvent', {type: 'mouseReleased', ...(pointerPositions.get(tabId) ?? first), button, buttons: 0, clickCount: 1});
    }
    return {dragged: true, points: targets.length, pointer: pointerPositions.get(tabId)};
  }
  const mouse = params => cdp(tabId, 'Input.dispatchMouseEvent', {x, y, ...params});
  await movePointer(cdp, tabId, {x, y}, bounds, human, args.durationMs, 'none', undefined, context.onPointer);
  if (name === 'browser_mouse_move') return {moved: true};
  if (name === 'browser_scroll') {
    await mouse({type: 'mouseWheel', deltaX: args.deltaX ?? 0, deltaY: args.deltaY, button: 'none'});
    return {scrolled: true};
  }
  const button = args.button ?? 'left';
  for (let count = 1; count <= (args.clickCount ?? 1); count++) {
    try {
      await mouse({type: 'mousePressed', button, buttons: buttonBits[button], clickCount: count});
      await pause(human ? logPause(60, 30, 110) : 60);
    } finally {await mouse({type: 'mouseReleased', button, buttons: 0, clickCount: count});}
    if (count < (args.clickCount ?? 1)) await pause(human ? logPause(80, 40, 130) : 80);
  }
  return {clicked: true};
}
