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
    socket.setTimeout(30000, () => finish(new Error('Timed out; check the browser before retrying.')));
    socket.on('connect', () => socket.write(JSON.stringify({token: settings.token, name, arguments: args, context}) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 24 * 1024 * 1024) return finish(new Error('Response too large'));
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        finish(response.error ? new Error(response.error) : null, response.result);
      } catch (error) {finish(error);}
    });
    socket.on('error', error => finish(new Error(`Bridge unavailable (${error.code}). Load the extension and press Conectar (Connect).`)));
    socket.on('end', () => finish(new Error('The extension closed the connection.')));
  });
}
