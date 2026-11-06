import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { diagnose, snapshot } from './diagnostics.mjs';
const root = resolve('dist'); const port = Number(process.env.PORT || 5182); let busy = false;
const origins = [`http://127.0.0.1:${port}`,`http://localhost:${port}`];
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.woff2':'font/woff2',
  '.woff':'font/woff', '.json':'application/json', '.webmanifest':'application/manifest+json' };
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type':'application/json' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 4096) throw new Error('Request too large.'); }
  return JSON.parse(data || '{}');
}
createServer(async (req, res) => {
  if (!origins.includes(`http://${req.headers.host}`)) { json(res,403,{error:{message:'Loopback access only.'}}); return; }
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://speed.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  try {
    if (req.url === '/api/health') { json(res,200,{status:'ok',app:'WaveScope'}); return; }
    if (req.url === '/api/network' && req.method === 'GET') { json(res,200,await snapshot()); return; }
    if (req.url?.startsWith('/api/')) {
      if (req.method !== 'POST' || req.headers['x-wavescope'] !== 'local-action'
        || (req.headers.origin && !origins.includes(req.headers.origin))) { json(res,403,{error:{message:'Start diagnostics from this app.'}}); return; }
      if (busy) { json(res,429,{error:{message:'A diagnostic is running. Try again when it finishes.'}}); return; }
      busy = true;
      try {
        const options = await body(req);
        if (req.url === '/api/scan') json(res,200,await snapshot(true));
        else if (req.url === '/api/test') json(res,200,await diagnose(options));
        else json(res,404,{error:{message:'Unknown endpoint.'}});
      } finally { busy = false; }
      return;
    }
    const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = resolve(root,`.${path}`);
    if (!file.startsWith(root+'\\') && !file.startsWith(root+'/') && file !== root) { json(res,400,{error:{message:'Invalid path.'}}); return; }
    if (file === root || !(await stat(file).catch(() => null))?.isFile()) file=resolve(root,'index.html');
    res.setHeader('Content-Type',types[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control','no-cache'); res.end(await readFile(file));
  } catch (cause) {
    const clientError = cause instanceof Error && /Invalid|Use |Unexpected|Request too large/i.test(cause.message);
    json(res,clientError ? 400 : 503,{error:{message:clientError ? 'Invalid request. Check the destination and test options.' : 'The local adapter is unavailable. Retry or check OS permissions.'}});
  }
}).listen(port,'127.0.0.1',() => process.stdout.write(`WaveScope ready at http://127.0.0.1:${port}\n`));
