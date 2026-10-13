import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';

const port = Number(process.env.PORT ?? 8765);
createServer((request, response) => {
  const path = new URL(request.url, `http://${request.headers.host}`).pathname;
  const file = path === '/' ? 'questionnaire.html' : path.slice(1);
  createReadStream(file).on('error', () => { response.writeHead(404); response.end('Not found'); }).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Demo server: http://127.0.0.1:${port}/`));
