const installed = new Set();
export function forgetCursor(tabId) {installed.delete(tabId);}
export async function cursor(tabId, enabled, point) {
  if (!enabled && !installed.has(tabId)) return;
  await chrome.scripting.executeScript({target: {tabId}, func: (enabled, point) => {
    const key = '__dialbotCrosshair';
    let state = globalThis[key];
    // Remove the listener left by versions that followed the physical mouse.
    if (state) removeEventListener('mousemove', state.move, {capture: true});
    if (!enabled) {
      state?.host.remove();
      delete globalThis[key]; return;
    }
    if (!state || !state.host.isConnected) {
      document.getElementById('dialbot-cursor-overlay')?.remove();
      const host = document.createElement('div');
      host.id = 'dialbot-cursor-overlay';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:2147483647!important;opacity:1!important;';
      const shadow = host.attachShadow({mode: 'open'});
      const horizontal = document.createElement('div'), vertical = document.createElement('div');
      horizontal.style.cssText = 'position:absolute;left:0;width:100%;height:1px;background:#00ff00;opacity:1;pointer-events:none';
      vertical.style.cssText = 'position:absolute;top:0;width:1px;height:100%;background:#00ff00;opacity:1;pointer-events:none';
      shadow.append(horizontal, vertical); document.documentElement.append(host);
      const move = event => {horizontal.style.top = `${event.clientY}px`; vertical.style.left = `${event.clientX}px`;};
      state = {host, move}; globalThis[key] = state;
      move({clientX: innerWidth / 2, clientY: innerHeight / 2});
    }
    if (point) state.move({clientX: point.x, clientY: point.y});
  }, args: [enabled, point ?? null]});
  if (enabled) installed.add(tabId); else installed.delete(tabId);
}
