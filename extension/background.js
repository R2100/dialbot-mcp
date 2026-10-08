import {execute} from './browser.js';
let port;
let ready = false;
let lastError = '';
let enabled = false;
const loaded = chrome.storage.local.get({enabled: true}).then(value => {enabled = value.enabled; connect();});
function connect() {
  if (port || !enabled) return;
  try {
    const current = chrome.runtime.connectNative('local.browser.bridge');
    port = current;
    current.onMessage.addListener(async message => {
      if (message.ready) {ready = true; lastError = ''; return;}
      if (!message.id) return;
      let response;
      try { response = {id: message.id, result: await execute(message.name, message.arguments ?? {}, message.context ?? {})}; }
      catch (error) { response = {id: message.id, error: error.message}; }
      try { current.postMessage(response); } catch {}
    });
    current.onDisconnect.addListener(() => {
      lastError = chrome.runtime.lastError?.message ?? 'Connection closed';
      if (port === current) {port = undefined; ready = false;}
    });
    lastError = '';
  } catch (error) { lastError = error.message; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  loaded.then(async () => {
    if (message.action === 'connect') {enabled = true; await chrome.storage.local.set({enabled}); connect();}
    if (message.action === 'disconnect') {enabled = false; await chrome.storage.local.set({enabled}); port?.disconnect(); port = undefined; ready = false; lastError = '';}
    reply({connected: ready, error: lastError, extensionId: chrome.runtime.id});
  }).catch(error => reply({connected: false, error: error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create('reconnect', {periodInMinutes: 0.5});
