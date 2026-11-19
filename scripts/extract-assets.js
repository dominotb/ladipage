const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_HTML = path.join(ROOT, 'Landing_Page_Tu_Bep_INOX_v2 (1).html');
const IMG_DIR = path.join(ROOT, 'public', 'assets', 'images');
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads');

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.writeFileSync(path.join(UPLOADS_DIR, '.gitkeep'), '', 'utf8');

if (!fs.existsSync(SOURCE_HTML)) {
  console.error('Source HTML not found:', SOURCE_HTML);
  process.exit(1);
}

const html = fs.readFileSync(SOURCE_HTML, 'utf8');
const hashToFile = new Map();
let count = 0;

const mapping = [];
const regex = /data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)/g;
let match;
while ((match = regex.exec(html)) !== null) {
  count++;
  const mimeType = match[1].toLowerCase();
  const ext = mimeType === 'jpeg' ? 'jpg' : mimeType;
  const buf = Buffer.from(match[2], 'base64');
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);

  let filename = hashToFile.get(hash);
  if (!filename) {
    filename = `domino-${String(count).padStart(2, '0')}-${hash}.${ext}`;
    fs.writeFileSync(path.join(IMG_DIR, filename), buf);
    hashToFile.set(hash, filename);
  }
  mapping.push({ index: count, filename, bytes: buf.length, url: `/assets/images/${filename}` });
}

fs.writeFileSync(
  path.join(IMG_DIR, 'manifest.json'),
  JSON.stringify(mapping, null, 2),
  'utf8'
);

console.log(`Extracted ${hashToFile.size} unique images (${count} total occurrences) into ${IMG_DIR}`);

