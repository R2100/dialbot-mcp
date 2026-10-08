import net from 'node:net';
import {config} from './config.mjs';
export function callBrowser(name, args, context = {}) {
  const settings = config();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(settings.pipe);
    let buffer = '';
    let done = false;
    function finish(error, result) {
      if (done) return; done = true;
      socket.destroy();
      error ? reject(error) : resolve(result);
    }
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () => finish(new Error('Tiempo agotado; verifica el navegador antes de repetir.')));
    socket.on('connect', () => socket.write(JSON.stringify({token: settings.token, name, arguments: args, context}) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 24 * 1024 * 1024) return finish(new Error('Respuesta demasiado grande'));
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        finish(response.error ? new Error(response.error) : null, response.result);
      } catch (error) {finish(error);}
    });
    socket.on('error', error => finish(new Error(`Puente no disponible (${error.code}). Carga la extensión y pulsa Conectar.`)));
    socket.on('end', () => finish(new Error('La extensión cerró la conexión.')));
  });
}
