const imageTypes = ["image/png", "image/jpeg", "image/webp"];

async function decode(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

/** Optimize locally before requesting an upload URL; never uploads the original first. */
export async function compressUploadImage(file: File, options: {
  maxBytes?: number; targetBytes?: number; maxDimension?: number; preserveFormat?: boolean;
} = {}): Promise<File> {
  const { maxBytes = 5 * 1024 * 1024, targetBytes = 1024 * 1024, maxDimension = 2400, preserveFormat = false } = options;
  if (!imageTypes.includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (!file.size) throw new Error("Choose a non-empty image.");
  if (file.size > 30 * 1024 * 1024) throw new Error("Choose an image of 30 MB or smaller for automatic compression.");
  // Already small images keep their original bytes and reusable logo hashes.
  if (file.size <= Math.min(targetBytes, maxBytes)) return file;
  let image: Awaited<ReturnType<typeof decode>>;
  try { image = await decode(file); }
  catch { throw new Error("This image could not be opened. Export it as PNG, JPG or WebP and try again."); }
  const canvas = document.createElement("canvas");
  try {
    if (!image.width || !image.height || image.width * image.height > 60_000_000) throw new Error("This image is too large to process. Choose an image below 60 megapixels.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image compression is unavailable in this browser. Try a smaller image.");
    const type = preserveFormat ? file.type : "image/webp";
    let scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    let best: Blob | null = null;
    for (let resize = 0; resize < 4; resize++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
        if (!blob?.size || !imageTypes.includes(blob.type)) throw new Error("Image compression failed. Try exporting a smaller image.");
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= targetBytes) break;
        if (blob.type === "image/png") break; // PNG ignores the quality setting.
      }
      if (best && best.size <= targetBytes) break;
      scale *= 0.8;
    }
    if (file.size <= maxBytes && (!best || best.size >= file.size)) return file;
    if (!best || best.size > maxBytes) throw new Error("This image is still too large after compression. Try a smaller image.");
    const extension = best.type === "image/jpeg" ? "jpg" : best.type.split("/")[1];
    return new File([best], `${file.name.replace(/\.[^.]+$/, "").slice(0, 160)}.${extension}`, { type: best.type, lastModified: file.lastModified });
  } finally { image.close(); canvas.width = canvas.height = 0; }
}
