import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVoidGatewayHandler } from './_gateway.js';

const gateway = createVoidGatewayHandler();

export default function voidApiHandler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname.startsWith('/api/void-api/')) {
    url.pathname = url.pathname.replace(/^\/api\/void-api/, '/__void_api');
    req.url = `${url.pathname}${url.search}`;
  }

  gateway(req, res, () => {
    if (res.writableEnded) return;
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}
