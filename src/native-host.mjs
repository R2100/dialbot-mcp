import net from 'node:net';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {config} from './config.mjs';
import {nativeFrame, nativeDecoder} from './framing.mjs';
import {validate} from './tools.mjs';
import {localFiles} from './upload.mjs';
import {writeClipboard} from './clipboard.mjs';
const settings = config();
const pending = new Map();
const sockets = new Set();
function authenticated(token) {
  if (typeof token !== 'string') return false;
  const a = Buffer.from(token), b = Buffer.from(settings.token);
  return a.length === b.length && timingSafeEqual(a, b);
}
const server = net.createServer(socket => {
  sockets.add(socket);
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('close', () => {
    sockets.delete(socket);
    for (const [id, request] of pending) if (request.socket === socket) {clearTimeout(request.timer); pending.delete(id);}
  });
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) {socket.destroy(); return;}
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let request;
      try {
        request = JSON.parse(line);
        if (!authenticated(request.token)) {socket.destroy(); return;}
        validate(request.name, request.arguments ?? {});
        if (['browser_upload', 'browser_upload_click'].includes(request.name)) request.arguments.files = localFiles(request.arguments.files);
        const context = request.context ?? {};
        for (const key of ['cursor', 'humanMotion', 'warmup']) if (context[key] !== undefined && typeof context[key] !== 'boolean') throw new Error('Contexto inválido');
        if (context.sessionId !== undefined && (typeof context.sessionId !== 'string' || context.sessionId.length > 100)) throw new Error('Sesión inválida');
        if (pending.size >= 100) throw new Error('Demasiadas operaciones pendientes');
        if (request.name === 'browser_paste' && [...pending.values()].some(value => value.name === 'browser_paste')) throw new Error('Portapapeles ocupado; espera a que termine el pegado anterior');
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          socket.end(JSON.stringify({error: 'Tiempo agotado; comprueba el estado antes de repetir la operación.'}) + '\n');
        }, 25000);
        pending.set(id, {socket, timer, name: request.name});
        const send = async () => {
          if (request.name === 'browser_paste' && request.arguments.text.length) await writeClipboard(request.arguments.text);
          if (!pending.has(id)) return;
          process.stdout.write(nativeFrame({id, name: request.name, arguments: request.arguments ?? {}, context: {cursor: context.cursor === true, humanMotion: context.humanMotion === true, warmup: context.warmup === true, sessionId: context.sessionId ?? 'legacy'}}));
        };
        send().catch(error => {
          if (!pending.has(id)) return;
          pending.delete(id); clearTimeout(timer);
          socket.end(JSON.stringify({error: error.message}) + '\n');
        });
      } catch (error) {socket.end(JSON.stringify({error: error.message}) + '\n');}
    }
  });
});
process.stdin.on('data', chunk => {
  try {decode(chunk);} catch {process.exit(1);}
});
const decode = nativeDecoder(message => {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  request.socket.end(JSON.stringify({result: message.result, error: message.error}) + '\n');
});
server.on('error', error => {console.error('No se pudo abrir el puente:', error.code); process.exit(1);});
server.listen(settings.pipe, () => process.stdout.write(nativeFrame({ready: true})));
process.stdin.on('end', () => {
  for (const socket of sockets) socket.destroy();
  server.close();
  process.exit(0);
});
