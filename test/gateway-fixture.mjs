import http from 'node:http';
// Controlled frontend only; no application data or external calls.
http.createServer((request, response) => { response.end(JSON.stringify({ page: 'controlled-frontend', path: request.url })); }).listen(3000, '0.0.0.0');
