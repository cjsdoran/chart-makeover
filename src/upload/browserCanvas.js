// Canvas and image helpers for the browser: chart pages and photos are prepared here (spec §3.3).
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Canvas could not be encoded'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, type, quality);
  });
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const dataUrl = (image) => `data:${image.mediaType};base64,${image.base64}`;

/**
 * Decodes an image file in the browser. createImageBitmap applies the EXIF orientation itself
 * ('from-image'), so photos come out upright and `exifApplied` tells the caller not to rotate again.
 */
export async function decodeImage(bytes, mediaType) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }), { imageOrientation: 'from-image' });
  return { image: bitmap, width: bitmap.width, height: bitmap.height, exifApplied: true, close: () => bitmap.close() };
}

/** HEIC to JPEG with heic2any, loaded only when a HEIC photo arrives (spec §3.2 step 3). */
export async function convertHeic(bytes) {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: new Blob([bytes], { type: 'image/heic' }), toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new Uint8Array(await blob.arrayBuffer());
}

export const browserDeps = { createCanvas, encode, toBase64, decodeImage, convertHeic };
