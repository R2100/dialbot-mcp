let current;
async function refresh(action = 'status') {
  current = await chrome.runtime.sendMessage({action});
  render();
}
function render() {
  const state = document.querySelector('#state');
  const connected = current.connected === true;
  if (state.classList.contains('ok') !== connected) {
    state.classList.toggle('ok', connected);
    state.classList.toggle('off', !connected);
  }
  document.querySelector('#stateText').textContent = connected ? 'Conectado al puente' : 'Desconectado';
  const error = document.querySelector('#error');
  error.hidden = !current.error;
  error.textContent = current.error ?? '';
  document.querySelector('#connect').disabled = connected;
  document.querySelector('#disconnect').disabled = !connected;
  const status = document.querySelector('#status');
  status.textContent = current.extensionId ?? '—';
}
document.querySelector('#connect').onclick = () => refresh('connect');
document.querySelector('#disconnect').onclick = () => refresh('disconnect');
document.querySelector('#status').onclick = async event => {
  const status = event.target;
  try {await navigator.clipboard.writeText(current.extensionId ?? '');} catch {}
  status.textContent = 'Copiado';
  status.classList.add('copied');
  setTimeout(() => {status.classList.remove('copied'); render();}, 900);
};
refresh();
setInterval(() => refresh(), 1000);