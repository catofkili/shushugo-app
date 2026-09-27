import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(here, '../../frontend/public/nihongo.db');
const size = statSync(databasePath).size;

createServer((request, response) => {
  if (request.url !== '/nihongo.db') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store'
  });
  createReadStream(databasePath).pipe(response);
}).listen(5195, '127.0.0.1', () => {
  console.log(`Serving factory database (${size} bytes) on http://127.0.0.1:5195/nihongo.db`);
});
