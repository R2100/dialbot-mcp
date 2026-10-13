import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';

const port = Number(process.env.PORT ?? 8765);
const root = resolve(fileURLToPath(new URL('./', import.meta.url)));
createServer((request, response) => {
  const path = new URL(request.url, `http://${request.headers.host}`).pathname;
  const file = resolve(root, path === '/' ? 'questionnaire.html' : path.slice(1));
  if (!file.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
  createReadStream(file).on('error', () => { response.writeHead(404); response.end('Not found'); }).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Demo server: http://127.0.0.1:${port}/`));
