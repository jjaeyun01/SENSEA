# Android CPU inference patch

This directory contains the small Android-only patch for the pinned
`react-native-fast-tflite` 3.0.1 package. `fast-tflite-3.0.1.patch` shows every
change to upstream C++ sources. `SenseaCpuModel.hpp` implements the new default
CPU construction path. JavaScript APIs, explicit NNAPI/GPU requests, the model,
and iOS behavior remain unchanged.

`npm install` / `npm ci` runs `scripts/patch-tflite-cpu.mjs` through `postinstall`.
It checks the package version, complete normalized-LF source hashes, patch
anchors and vendored header hashes before writing anything. It accepts an
already applied identical patch. An unexpected dependency/source version fails
installation so it must be reviewed explicitly. No package download or binary
replacement is performed by the patch script.

## CPU execution and lifetime

Android calls with an empty delegate list create an XNNPACK delegate with two
threads and signed/unsigned 8-bit support. The interpreter also uses two CPU
threads. The pinned LiteRT 1.4.0 default flags already contain QS8/QU8; explicitly
ORing those flags preserves other upstream defaults. No weight cache file is
configured and no model inputs or camera images are persisted.

The delegate is retained by the model and destroyed after its interpreter.
Local RAII owners also guarantee this ordering when interpreter creation or
AllocateTensors fails. In that case the helper retries with the original CPU
runtime, using two threads. Invocation fallback is enabled only for this default
CPU path: the pinned EfficientDet model is stateless, and native tensor pointers
are reacquired on each call. With this C API option, DelegateError and
ApplicationError report a successful CPU retry with valid outputs; other errors
remain failures. The wrapper recognizes those two statuses only when it enabled
fallback. It logs the fallback once and retains delegate ownership until model
cleanup. No inference-age limit is changed by this patch.

## Third-party source and ABI

`../litert-1.4.0/xnnpack_delegate.h` is copied without modification from the
Apache-2.0-licensed LiteRT v1.4.0 project. Its original copyright/license notice
and the complete upstream LICENSE are preserved next to it.

- Project: https://github.com/google-ai-edge/LiteRT
- Pinned commit: `0348ffbe4232df35ab2651e6383528b3d8bf792f` (v1.4.0)
- Header: https://github.com/google-ai-edge/LiteRT/blob/0348ffbe4232df35ab2651e6383528b3d8bf792f/tflite/delegates/xnnpack/xnnpack_delegate.h
- Header SHA-256: `d01b38bc1ae87422c9fe96f5f0daee0ef284272a6020f69aab75a0b1cab07aed`
- Library: the existing `com.google.ai.edge.litert:litert:1.4.0` AAR used by fast-tflite.

The pinned header's 64-bit options struct is 56 bytes (`flags` offset 8,
`weight_cache_file_descriptor` offset 40). These match the included arm64/x86_64
libraries' OptionsDefault implementation; compile-time checks catch incompatible
headers. Do not substitute a current/master XNNPACK header: the struct ABI has
changed since this release.

Only public open-source code and APIs are used. No company project source is
included. Native compilation and on-device timing are separate verification
steps; source patch application alone does not prove inference performance.
