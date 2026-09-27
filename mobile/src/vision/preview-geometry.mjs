/** Map upright content coordinates into a cover-scaled rear-camera preview.
 * Geometry is metadata only. Invalid/fully cropped boxes are omitted.
 */
export function projectBoxToPreview(box, imageSize, previewSize) {
  if (!box || !imageSize || !previewSize) return null;
  const { width: iw, height: ih } = imageSize, { width: vw, height: vh } = previewSize;
  if (![iw, ih, vw, vh].every(n => Number.isFinite(n) && n > 0) ||
      ![box.top, box.left, box.bottom, box.right].every(Number.isFinite) ||
      box.left < 0 || box.top < 0 || box.right > 1 || box.bottom > 1 ||
      box.right <= box.left || box.bottom <= box.top) return null;
  const scale = Math.max(vw / iw, vh / ih), dx = (vw - iw * scale) / 2, dy = (vh - ih * scale) / 2;
  const left = Math.max(0, box.left * iw * scale + dx), top = Math.max(0, box.top * ih * scale + dy);
  const right = Math.min(vw, box.right * iw * scale + dx), bottom = Math.min(vh, box.bottom * ih * scale + dy);
  if (right - left < 2 || bottom - top < 2) return null;
  return { left, top, width: right - left, height: bottom - top };
}
