const multer = require('multer');
const crypto = require('crypto');
const store = require('../db/store');

// Max 5 MB per image
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Verify magic bytes so attackers cannot upload disguised HTML/SVG/JS scripts
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // GIF: GIF87a or GIF89a
  const gifHead = buffer.subarray(0, 6).toString('ascii');
  if (gifHead === 'GIF87a' || gifHead === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  return null;
}

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận định dạng ảnh JPG, PNG, WebP hoặc GIF.'));
    }
    return cb(null, true);
  },
});

async function saveVerifiedImage(file) {
  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw new Error('File tải lên không phải ảnh hợp lệ (kiểm tra chữ ký nhị phân thất bại).');
  }
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${detected.ext}`;
  const url = await store.uploadImageToStorage(filename, file.buffer, detected.mime);

  return {
    filename,
    original_name: String(file.originalname || filename).slice(0, 200),
    mime_type: detected.mime,
    size_bytes: file.buffer.length,
    url,
  };
}

module.exports = {
  uploadMiddleware,
  saveVerifiedImage,
};
