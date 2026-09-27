#pragma once

// SENSEA Android default-CPU optimization for fast-tflite 3.0.1 / LiteRT 1.4.0.
// This helper is included only on Android. Explicit GPU/NNAPI requests keep
// the package's original path; no JavaScript API or model contract is changed.
#include "HybridTfliteModel.hpp"
#include "sensea-xnnpack-v1.4.0.h"
#include <android/log.h>
#include <tflite/c/c_api_experimental.h>
#include <cstddef>
#include <memory>
#include <stdexcept>
#include <utility>

namespace margelo::nitro::tflite {

static_assert(offsetof(TfLiteXNNPackDelegateOptions, flags) == 8,
              "Use the pinned LiteRT 1.4.0 XNNPACK header");
static_assert(sizeof(void*) != 8 || sizeof(TfLiteXNNPackDelegateOptions) == 56,
              "Unexpected LiteRT 1.4.0 XNNPACK options ABI");

inline std::shared_ptr<HybridTfliteModelSpec>
createSenseaCpuModel(const std::shared_ptr<ArrayBuffer>& modelData) {
  using ModelPtr = std::unique_ptr<TfLiteModel, decltype(&TfLiteModelDelete)>;
  using OptionsPtr = std::unique_ptr<TfLiteInterpreterOptions, decltype(&TfLiteInterpreterOptionsDelete)>;
  using InterpreterPtr = std::unique_ptr<TfLiteInterpreter, decltype(&TfLiteInterpreterDelete)>;

  ModelPtr model(TfLiteModelCreate(modelData->data(), modelData->size()), TfLiteModelDelete);
  if (!model) throw std::runtime_error("Failed to create TFLite model from data!");

  const auto makeOptions = [](TfLiteDelegate* delegate) {
    OptionsPtr options(TfLiteInterpreterOptionsCreate(), TfLiteInterpreterOptionsDelete);
    TfLiteInterpreterOptionsSetNumThreads(options.get(), 2);
    if (delegate != nullptr) {
      TfLiteInterpreterOptionsAddDelegate(options.get(), delegate);
      // The pinned object detector is stateless. HybridTfliteModel fetches
      // native tensor pointers anew for each call, as this fallback requires.
      TfLiteInterpreterOptionsSetEnableDelegateFallback(options.get(), true);
    }
    return options;
  };

  auto xnnOptions = TfLiteXNNPackDelegateOptionsDefault();
  xnnOptions.num_threads = 2;
  xnnOptions.flags |= TFLITE_XNNPACK_DELEGATE_FLAG_QS8 | TFLITE_XNNPACK_DELEGATE_FLAG_QU8;
  // Keep this owner outside the interpreter scope: the interpreter must die first
  // on every constructor/AllocateTensors failure as well as normal destruction.
  auto delegate = std::shared_ptr<TfLiteDelegate>(
      TfLiteXNNPackDelegateCreate(&xnnOptions), TfLiteXNNPackDelegateDelete);
  if (delegate) {
    auto options = makeOptions(delegate.get());
    InterpreterPtr interpreter(TfLiteInterpreterCreate(model.get(), options.get()), TfLiteInterpreterDelete);
    if (interpreter) {
      try {
        // The existing constructor allocates tensors and may throw. The local
        // unique_ptr still owns the interpreter until construction succeeds.
        auto result = std::make_shared<HybridTfliteModel>(
            interpreter.get(), modelData, std::vector<TensorflowModelDelegate>{}, delegate, true);
        interpreter.release();
        __android_log_print(ANDROID_LOG_INFO, "SENSEATflite", "XNNPACK CPU enabled (2 threads, QS8/QU8)");
        return result;
      } catch (const std::runtime_error&) {
        __android_log_print(ANDROID_LOG_WARN, "SENSEATflite", "XNNPACK tensor allocation failed; retrying CPU");
      }
    } else {
      __android_log_print(ANDROID_LOG_WARN, "SENSEATflite", "XNNPACK interpreter creation failed; retrying CPU");
    }
  } else {
    __android_log_print(ANDROID_LOG_WARN, "SENSEATflite", "XNNPACK unavailable; using CPU");
  }
  // The unsuccessful accelerated interpreter has left scope and been destroyed.
  delegate.reset();
  auto options = makeOptions(nullptr);
  InterpreterPtr interpreter(TfLiteInterpreterCreate(model.get(), options.get()), TfLiteInterpreterDelete);
  if (!interpreter) throw std::runtime_error("Failed to create fallback TFLite CPU interpreter!");
  auto result = std::make_shared<HybridTfliteModel>(
      interpreter.get(), modelData, std::vector<TensorflowModelDelegate>{});
  interpreter.release();
  __android_log_print(ANDROID_LOG_INFO, "SENSEATflite", "Default CPU fallback enabled (2 threads)");
  return result;
}

} // namespace margelo::nitro::tflite
