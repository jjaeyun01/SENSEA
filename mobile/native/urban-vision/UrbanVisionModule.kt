package com.sensea.urban

import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class UrbanVisionModule(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
  init { UrbanFrameAnalyzer.attach(context) }
  override fun getName() = "SenseaUrbanVision"
  @ReactMethod fun setEnabled(enabled: Boolean, generation: Double) { UrbanFrameAnalyzer.enable(enabled, generation.toLong()) }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  override fun invalidate() { UrbanFrameAnalyzer.detach(); super.invalidate() }
}
class UrbanVisionPackage: ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(UrbanVisionModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*,*>> = emptyList()
}
