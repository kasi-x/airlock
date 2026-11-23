import type { FastifyReply } from 'fastify';
import { htmlEscape } from './notify.js';

// Shared self-contained HTML page for public, token-gated flows
// (email-channel verification, email approval links). Deliberately has no
// script; the form may only post back to this origin.
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function sendHtmlPage(reply: FastifyReply, status: number, heading: string, bodyHtml: string) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${htmlEscape(heading)} · Impri</title>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#0f1115;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:440px;margin:24px 16px;padding:32px;background:#181b22;border-radius:12px}
h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 16px;color:#b8bcc6}
button{font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:8px;background:#7c5cff;color:#fff;cursor:pointer}
a{color:#a996ff}
</style>
</head>
<body><main><h1>${htmlEscape(heading)}</h1>${bodyHtml}</main></body>
</html>`;
  return reply
    .status(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Content-Security-Policy', PAGE_CSP)
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .send(html);
}
