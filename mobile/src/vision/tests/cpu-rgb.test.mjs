import assert from "node:assert/strict";
import test from "node:test";
import { resizeCpuRgbFrame } from "../cpu-rgb.mjs";

const output = () => new Uint8Array(320 * 320 * 3);
const color = n => [n, n + 1, n + 2];
const read = (rgb, x, y) => Array.from(rgb.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3));
function frame(rows, { padding = 0, trimFinalPadding = false, orientation = "up", isMirrored = false } = {}) {
  const height = rows.length, width = rows[0].length, bytesPerRow = width * 4 + padding;
  const data = new Uint8Array(height * bytesPerRow - (trimFinalPadding ? padding : 0)).fill(251);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...color(rows[y][x]), 0], y * bytesPerRow + x * 4);
  }
  return {
    width, height, bytesPerRow, pixelFormat: "rgb-rgba-8-bit", orientation, isMirrored,
    getPlanes: () => [{ bytesPerRow, getPixelBuffer: () => data.buffer,
      dispose: () => { throw new Error("Resizer must not dispose frame-owned plane"); } }],
    getPixelBuffer: () => { throw new Error("Must not map HardwareBuffer through frame"); },
    dispose: () => { throw new Error("Resizer must not dispose caller-owned frame"); },
  };
}

test("RGBA channels become RGB, ignore alpha and honor padded row stride", () => {
  const source = frame([[10, 20], [30, 40]], { padding: 12, trimFinalPadding: true });
  const before = Array.from(new Uint8Array(source.getPlanes()[0].getPixelBuffer()));
  const rgb = output();
  assert.equal(resizeCpuRgbFrame(source, rgb), rgb.buffer);
  assert.deepEqual(read(rgb, 80, 80), color(10));
  assert.deepEqual(read(rgb, 240, 80), color(20));
  assert.deepEqual(read(rgb, 80, 240), color(30));
  assert.deepEqual(read(rgb, 240, 240), color(40));
  assert.deepEqual(Array.from(new Uint8Array(source.getPlanes()[0].getPixelBuffer())), before);
});

for (const [orientation, expected] of [
  ["up", [[10, 20], [30, 40]]],
  ["left", [[30, 10], [40, 20]]],
  ["down", [[40, 30], [20, 10]]],
  ["right", [[20, 40], [10, 30]]],
]) {
  test(`orientation ${orientation} is counter-rotated into an upright image`, () => {
    const rgb = output();
    resizeCpuRgbFrame(frame([[10, 20], [30, 40]], { orientation }), rgb);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      assert.deepEqual(read(rgb, 80 + x * 160, 80 + y * 160), color(expected[y][x]));
    }
  });
}

for (const [orientation, expected] of [
  ["up", [[20, 10], [40, 30]]],
  ["left", [[40, 20], [30, 10]]],
  ["down", [[30, 40], [10, 20]]],
  ["right", [[10, 30], [20, 40]]],
]) {
  test(`mirrored ${orientation} matches source mirroring after inverse rotation`, () => {
    const rgb = output();
    resizeCpuRgbFrame(frame([[10, 20], [30, 40]], { orientation, isMirrored: true }), rgb);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      assert.deepEqual(read(rgb, 80 + x * 160, 80 + y * 160), color(expected[y][x]));
    }
  });
}

test("contain keeps landscape content centered and overwrites old pixels with black padding", () => {
  const rgb = output().fill(199);
  resizeCpuRgbFrame(frame([[10, 20]]), rgb);
  assert.deepEqual(read(rgb, 0, 79), [0, 0, 0]);
  assert.deepEqual(read(rgb, 0, 80), color(10));
  assert.deepEqual(read(rgb, 319, 239), color(20));
  assert.deepEqual(read(rgb, 319, 240), [0, 0, 0]);
  const identity = rgb.buffer;
  assert.equal(resizeCpuRgbFrame(frame([[30, 40]], { orientation: "left" }), rgb), identity);
  assert.deepEqual(read(rgb, 79, 160), [0, 0, 0]);
  assert.deepEqual(read(rgb, 80, 0), color(30));
  assert.deepEqual(read(rgb, 239, 319), color(40));
  assert.deepEqual(read(rgb, 240, 160), [0, 0, 0]);
});

test("nearest-neighbor downscaling samples source pixel centers without copying input", () => {
  const width = 640, height = 480, bytesPerRow = width * 4;
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * bytesPerRow + x * 4;
    data[i] = x % 256; data[i + 1] = y % 256; data[i + 2] = 111;
  }
  let reads = 0;
  const source = { width, height, bytesPerRow, pixelFormat: "rgb-rgba-8-bit", orientation: "up", isMirrored: false,
    getPlanes: () => [{ bytesPerRow, getPixelBuffer: () => { reads++; return data.buffer; } }],
    getPixelBuffer: () => { throw new Error("Must not map HardwareBuffer through frame"); } };
  const rgb = output();
  resizeCpuRgbFrame(source, rgb);
  assert.equal(reads, 1);
  assert.deepEqual(read(rgb, 0, 40), [1, 1, 111]);
  assert.deepEqual(read(rgb, 319, 279), [639 % 256, 479 % 256, 111]);
});

test("unsupported layouts fail before reading native pixels", () => {
  for (const change of [
    { pixelFormat: "yuv-420-8-bit-full" }, { pixelFormat: "rgb-bgra-8-bit" },
    { width: 0 }, { height: -1 }, { width: 1.5 }, { height: NaN },
    { width: 1281, height: 720 },
    { orientation: "unknown" }, { isMirrored: undefined },
  ]) {
    let reads = 0;
    const source = { ...frame([[10, 20], [30, 40]]), ...change,
      getPlanes: () => [{ bytesPerRow: 8, getPixelBuffer: () => { reads++; throw new Error("should not read"); } }] };
    assert.throws(() => resizeCpuRgbFrame(source, output()), /CPU/);
    assert.equal(reads, 0);
  }
});

test("a missing final pixel or invalid buffer is rejected without touching output", () => {
  for (const pixels of [new ArrayBuffer(15), new Uint8Array(16), null]) {
    const source = { ...frame([[10, 20], [30, 40]]), getPlanes: () => [{ bytesPerRow: 8, getPixelBuffer: () => pixels }] };
    const rgb = output().fill(123);
    assert.throws(() => resizeCpuRgbFrame(source, rgb), /pixel buffer/);
    assert.ok(rgb.every(value => value === 123));
  }
});

test("only a dedicated reusable model-sized Uint8Array is accepted", () => {
  for (const rgb of [new Uint8Array(3), new Float32Array(320 * 320 * 3),
    new Uint8Array(new ArrayBuffer(320 * 320 * 3 + 1), 1), new ArrayBuffer(320 * 320 * 3)]) {
    assert.throws(() => resizeCpuRgbFrame(frame([[10]]), rgb), /output/);
  }
  const rgb = output();
  const source = { ...frame([[10]]), getPlanes: () => [{ bytesPerRow: 4, getPixelBuffer: () => rgb.buffer }] };
  assert.throws(() => resizeCpuRgbFrame(source, rgb), /pixel buffer/);
});


test("missing or multiple RGBA planes fail without reading or disposing them", () => {
  const plane = { bytesPerRow: 8,
    getPixelBuffer: () => { throw new Error("Must not read rejected plane"); },
    dispose: () => { throw new Error("Must not dispose rejected plane"); } };
  for (const planes of [[], [plane, plane], null, undefined]) {
    const source = { ...frame([[10, 20], [30, 40]]), getPlanes: () => planes };
    assert.throws(() => resizeCpuRgbFrame(source, output()), /plane count/);
  }
});

test("RGBA plane stride is validated before accessing its buffer", () => {
  for (const bytesPerRow of [0, 7, 8.5, Infinity, NaN, undefined]) {
    let reads = 0;
    const source = { ...frame([[10, 20], [30, 40]]),
      getPlanes: () => [{ bytesPerRow, getPixelBuffer: () => { reads++; return new ArrayBuffer(16); } }] };
    assert.throws(() => resizeCpuRgbFrame(source, output()), /plane layout/);
    assert.equal(reads, 0);
  }
});

test("CPU pixels and row stride are obtained only from the single RGBA plane", () => {
  const source = frame([[10, 20], [30, 40]], { padding: 16 });
  Object.defineProperty(source, "bytesPerRow", { get() { throw new Error("Use the plane stride"); } });
  const rgb = output();
  resizeCpuRgbFrame(source, rgb);
  assert.deepEqual(read(rgb, 240, 240), color(40));
});


// Independent direct-coordinate reference for the integer stepping optimization.
function referenceResize(frame, rgb) {
  const width = frame.width, height = frame.height, orientation = frame.orientation, mirrored = frame.isMirrored;
  const plane = frame.getPlanes()[0], stride = plane.bytesPerRow;
  const rgba = new Uint8Array(plane.getPixelBuffer()), outputSize = 320;
  const sideways = orientation === "right" || orientation === "left";
  const uprightWidth = sideways ? height : width, uprightHeight = sideways ? width : height;
  const scale = Math.min(outputSize / uprightWidth, outputSize / uprightHeight);
  const renderedWidth = Math.max(1, Math.floor(uprightWidth * scale));
  const renderedHeight = Math.max(1, Math.floor(uprightHeight * scale));
  const left = Math.floor((outputSize - renderedWidth) / 2), top = Math.floor((outputSize - renderedHeight) / 2);
  rgb.fill(0);
  for (let y = 0; y < renderedHeight; y++) {
    const uprightY = Math.min(uprightHeight - 1, Math.floor((y + 0.5) * uprightHeight / renderedHeight));
    for (let x = 0; x < renderedWidth; x++) {
      const uprightX = Math.min(uprightWidth - 1, Math.floor((x + 0.5) * uprightWidth / renderedWidth));
      // Undo the metadata rotation, with mirroring applied in source coordinates.
      let sourceX = uprightX, sourceY = uprightY;
      if (orientation === "left") { sourceX = uprightY; sourceY = height - 1 - uprightX; }
      else if (orientation === "down") { sourceX = width - 1 - uprightX; sourceY = height - 1 - uprightY; }
      else if (orientation === "right") { sourceX = width - 1 - uprightY; sourceY = uprightX; }
      if (mirrored) sourceX = width - 1 - sourceX;
      const inputOffset = sourceY * stride + sourceX * 4;
      const outputOffset = ((y + top) * outputSize + x + left) * 3;
      rgb[outputOffset] = rgba[inputOffset];
      rgb[outputOffset + 1] = rgba[inputOffset + 1];
      rgb[outputOffset + 2] = rgba[inputOffset + 2];
    }
  }
  return rgb.buffer;
}

test("integer byte steps are byte-identical to direct coordinates across sizes, padding and orientations", () => {
  const sizes = [[1, 1], [1, 319], [319, 1], [3, 7], [641, 479], [640, 480],
    [1280, 720], [720, 1280], [320, 320], [17, 31], [4, 1], [1, 4]];
  const actual = output(), expected = output();
  for (let n = 0; n < sizes.length; n++) {
    const [width, height] = sizes[n], bytesPerRow = width * 4 + n % 8;
    const data = new Uint8Array((height - 1) * bytesPerRow + width * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 17 + (i >>> 8) * 31) % 256;
    for (const orientation of ["up", "right", "down", "left"]) {
      for (const isMirrored of [false, true]) {
        const source = { width, height, pixelFormat: "rgb-rgba-8-bit", orientation, isMirrored,
          getPlanes: () => [{ bytesPerRow, getPixelBuffer: () => data.buffer }] };
        resizeCpuRgbFrame(source, actual);
        referenceResize(source, expected);
        assert.equal(Buffer.compare(actual, expected), 0,
          JSON.stringify({ width, height, bytesPerRow, orientation, isMirrored }));
      }
    }
  }
});


test("CameraX clockwise rotationDegrees are honored through VisionCamera 5.2.3 orientation metadata", () => {
  // Independent contract, checked against the installed Android bridge:
  // ImageProxy+orientation.kt passes rotationDegrees to fromDegrees(), whose
  // 90-degree branch returns LEFT and 270-degree branch returns RIGHT.
  // CameraX ImageInfo defines these as the clockwise correction to apply:
  // https://developer.android.com/reference/androidx/camera/core/ImageInfo#getRotationDegrees()
  const cameraXFrames = [
    { clockwiseDegrees: 0, orientation: "up", expected: [[10, 20, 30], [40, 50, 60]] },
    { clockwiseDegrees: 90, orientation: "left", expected: [[40, 10], [50, 20], [60, 30]] },
    { clockwiseDegrees: 180, orientation: "down", expected: [[60, 50, 40], [30, 20, 10]] },
    { clockwiseDegrees: 270, orientation: "right", expected: [[30, 60], [20, 50], [10, 40]] },
  ];
  for (const { clockwiseDegrees, orientation, expected } of cameraXFrames) {
    const rgb = output();
    resizeCpuRgbFrame(frame([[10, 20, 30], [40, 50, 60]], { orientation }), rgb);
    const height = expected.length, width = expected[0].length;
    const scale = Math.min(320 / width, 320 / height);
    const renderedWidth = Math.floor(width * scale), renderedHeight = Math.floor(height * scale);
    const left = Math.floor((320 - renderedWidth) / 2), top = Math.floor((320 - renderedHeight) / 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const outputX = left + Math.floor((x + 0.5) * renderedWidth / width);
      const outputY = top + Math.floor((y + 0.5) * renderedHeight / height);
      assert.deepEqual(read(rgb, outputX, outputY), color(expected[y][x]),
        `CameraX ${clockwiseDegrees} degrees -> ${orientation}, pixel (${x}, ${y})`);
    }
  }
});
