import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/register.json': ['register.json', 'application/json'] };
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try {
    const data = await readFile('site/' + file[0]);
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(503); res.end('Run npm run demo first to generate the dashboard.'); }
}).listen(port, '127.0.0.1', () => console.log('Dashboard: http://127.0.0.1:' + port));
