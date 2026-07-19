/**
 * Normalise une photo de ticket pour l’API Vision :
 * - HEIC iPhone → JPEG via canvas
 * - Redimensionne (max 1600px)
 * - Compresse (~0.85)
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de lire la photo. Réessayez en JPG depuis l’appareil photo.'));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Compression photo échouée'));
        else resolve(blob);
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

/**
 * @param {File} file
 * @returns {Promise<File>} JPEG prêt pour /receipts/scan
 */
export async function prepareReceiptImage(file) {
  if (!file) throw new Error('Aucune photo');

  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || 'ticket').toLowerCase();
  const isHeic = type.includes('heic') || type.includes('heif') || /\.heic$|\.heif$/.test(name);

  // Déjà petit JPEG/PNG/WebP : on peut envoyer tel quel si < 2 Mo
  if (!isHeic && file.size < 2 * 1024 * 1024 && /image\/(jpeg|jpg|png|webp)/.test(type)) {
    return file;
  }

  try {
    const img = await loadImageFromFile(file);
    let { width, height } = img;
    if (!width || !height) throw new Error('Image invalide');

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasToJpegBlob(canvas);
    const base = (file.name || 'ticket').replace(/\.[^.]+$/, '') || 'ticket';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (err) {
    if (isHeic) {
      throw new Error(
        'Photo HEIC non convertie. Utilisez « Scanner un ticket » (appareil photo) ou enregistrez le reçu en JPG.'
      );
    }
    throw err;
  }
}
