'use strict';
/* Wraps the page fragments in full HTML documents and copies their assets into dist/, ready for any static host. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n';
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function page(src, out, assets) {
  const dir = path.join(dist, out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), head + fs.readFileSync(path.join(root, src, 'index.html'), 'utf8') + '\n</body>\n</html>\n');
  assets.forEach(a => copyDir(path.join(root, src, a), path.join(dir, a)));
}
fs.rmSync(dist, { recursive: true, force: true });
page('landing', '.', ['img']);      // dist/index.html is the landing page
page('app', 'app', ['js']);         // dist/app/ is the planner
console.log('Built dist/ (landing at /, planner at /app/)');
