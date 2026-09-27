/** Resize CameraX RGBA into the caller-owned RGB model buffer without retaining a frame. */
export function resizeCpuRgbFrame(frame, rgb) {
  "worklet";
  const outputSize = 320, outputBytes = 320 * 320 * 3;
  if (!(rgb instanceof Uint8Array) || rgb.byteLength !== outputBytes ||
      rgb.byteOffset !== 0 || rgb.buffer.byteLength !== outputBytes) {
    throw new Error("CPU RGB output must be a dedicated 320x320x3 Uint8Array");
  }
  const width = frame.width, height = frame.height;
  if (frame.pixelFormat !== "rgb-rgba-8-bit") throw new Error("Unsupported CPU camera pixel format");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width * height > 1280 * 720) {
    throw new Error("Invalid CPU camera frame layout");
  }
  const orientation = frame.orientation;
  if (orientation !== "up" && orientation !== "right" && orientation !== "down" && orientation !== "left") {
    throw new Error("Unsupported CPU camera orientation");
  }
  const mirrored = frame.isMirrored;
  if (typeof mirrored !== "boolean") throw new Error("Invalid CPU camera mirror flag");
  // VisionCamera 5.2.3 exposes the single CameraX RGBA plane on Android.
  // Frame.getPixelBuffer() first tries HardwareBuffer mapping, which can fail;
  // the plane directly wraps CameraX's readable ByteBuffer instead.
  const planes = frame.getPlanes();
  if (!Array.isArray(planes) || planes.length !== 1) throw new Error("Invalid CPU RGBA plane count");
  const plane = planes[0], stride = plane?.bytesPerRow;
  if (!Number.isInteger(stride) || stride < width * 4) throw new Error("Invalid CPU camera plane layout");
  const source = plane.getPixelBuffer();
  // The final row can omit its padding. The ArrayBuffer remains borrowed from frame.
  // The caller disposes frame, which also disposes its cached plane wrappers.
  const requiredBytes = (height - 1) * stride + width * 4;
  if (!(source instanceof ArrayBuffer) || source.byteLength < requiredBytes || source === rgb.buffer) {
    throw new Error("Invalid CPU camera pixel buffer");
  }
  const rgba = new Uint8Array(source);
  const sideways = orientation === "right" || orientation === "left";
  const uprightWidth = sideways ? height : width, uprightHeight = sideways ? width : height;
  const scale = Math.min(outputSize / uprightWidth, outputSize / uprightHeight);
  const renderedWidth = Math.max(1, Math.floor(uprightWidth * scale));
  const renderedHeight = Math.max(1, Math.floor(uprightHeight * scale));
  const left = Math.floor((outputSize - renderedWidth) / 2);
  const top = Math.floor((outputSize - renderedHeight) / 2);
  // VisionCamera describes how the input is rotated, so counter-rotate it.
  // Its Android bridge maps CameraX rotationDegrees 90 -> left, 270 -> right;
  // those CameraX values are the clockwise correction required by the buffer.
  // Convert that correction and source mirroring to byte steps once per frame.
  const horizontalStep = mirrored ? -4 : 4;
  const horizontalOrigin = mirrored ? (width - 1) * 4 : 0;
  let origin = horizontalOrigin, columnStep = horizontalStep, rowStep = stride;
  if (orientation === "left") {
    origin = horizontalOrigin + (height - 1) * stride;
    columnStep = -stride; rowStep = horizontalStep;
  } else if (orientation === "down") {
    origin = horizontalOrigin + (width - 1) * horizontalStep + (height - 1) * stride;
    columnStep = -horizontalStep; rowStep = -stride;
  } else if (orientation === "right") {
    origin = horizontalOrigin + (width - 1) * horizontalStep;
    columnStep = stride; rowStep = -horizontalStep;
  }
  // floor((x + 0.5) * uprightWidth / renderedWidth), expressed as exact
  // integer quotient/remainder steps. This removes divisions and rotation
  // branches from the pixel loop without allocating coordinate lookup arrays.
  const denominator = 2 * renderedWidth;
  const firstColumn = Math.floor(uprightWidth / denominator);
  const initialRemainder = uprightWidth - firstColumn * denominator;
  const wholeStep = Math.floor(uprightWidth / renderedWidth);
  const remainderStep = 2 * uprightWidth - wholeStep * denominator;
  const wholeByteStep = wholeStep * columnStep;
  rgb.fill(0);
  for (let y = 0; y < renderedHeight; y++) {
    const uprightY = Math.floor((y + 0.5) * uprightHeight / renderedHeight);
    let inputOffset = origin + uprightY * rowStep + firstColumn * columnStep;
    let outputOffset = ((y + top) * outputSize + left) * 3;
    let remainder = initialRemainder;
    for (let x = 0; x < renderedWidth; x++) {
      rgb[outputOffset] = rgba[inputOffset];
      rgb[outputOffset + 1] = rgba[inputOffset + 1];
      rgb[outputOffset + 2] = rgba[inputOffset + 2];
      outputOffset += 3;
      inputOffset += wholeByteStep;
      remainder += remainderStep;
      if (remainder >= denominator) {
        remainder -= denominator;
        inputOffset += columnStep;
      }
    }
  }
  return rgb.buffer;
}
