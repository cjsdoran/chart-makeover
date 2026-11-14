// Photos and screenshots (spec §3.3, CMS-8): turned upright from their EXIF orientation, resized
// to a long side of upload.imageLongSidePx for the read call (never enlarged), JPEG 0.9 (0.8 if
// that is over upload.imageMaxBytes); and a 1,600 px JPEG copy kept for Stages 2–4 and the record.
// The decoder and canvas are passed in, so the browser and the read test share this code.
import { config } from '../../shared/limits.js';

const upload = config.upload;

/**
 * The EXIF orientation (1–8) of a JPEG, or 1 when it has none. Reads only the APP1 segment.
 * @param {Uint8Array} bytes
 */
export function exifOrientation(bytes) {
  const b = bytes;
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const tiff = i + 10;
      const little = b[tiff] === 0x49;
      const u16 = (o) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const entry = ifd + 2 + k * 12;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

/** Draws an image upright at the given long side (never larger than it is). */
function drawUpright(decoded, orientation, longSide, createCanvas) {
  const swap = orientation >= 5;
  const w0 = swap ? decoded.height : decoded.width;
  const h0 = swap ? decoded.width : decoded.height;
  const scale = Math.min(1, longSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // Drawing size before the rotation: the stored image's own width and height, scaled.
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  switch (orientation) {
    case 2: ctx.setTransform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, w, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, w, h); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, h); break;
    default: break;
  }
  ctx.drawImage(decoded.image, 0, 0, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/**
 * @param {Uint8Array} bytes a PNG or JPEG
 * @param {string} mediaType
 * @param {{ decodeImage, createCanvas, encode }} deps
 * @returns {Promise<{ image: { mediaType, bytes, width, height }, record: { mediaType, bytes, width, height }, orientation: number }>}
 */
export async function preparePhoto(bytes, mediaType, { decodeImage, createCanvas, encode }) {
  const decoded = await decodeImage(bytes, mediaType);
  try {
    const orientation = decoded.exifApplied || mediaType !== 'image/jpeg' ? 1 : exifOrientation(bytes);
    const big = drawUpright(decoded, orientation, upload.imageLongSidePx, createCanvas);
    let out = await encode(big, 'image/jpeg', 0.9);
    if (out.length > upload.imageMaxBytes) out = await encode(big, 'image/jpeg', 0.8);
    const small = drawUpright(decoded, orientation, upload.recordImageLongSidePx, createCanvas);
    const rec = await encode(small, 'image/jpeg', upload.recordImageQuality);
    return {
      image: { mediaType: 'image/jpeg', bytes: out, width: big.width, height: big.height },
      record: { mediaType: 'image/jpeg', bytes: rec, width: small.width, height: small.height },
      orientation,
    };
  } finally {
    decoded.close?.();
  }
}
