package com.sensea.urban

import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class UrbanVisionModule(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
  init { UrbanFrameAnalyzer.attach(context) }
  override fun getName() = "SenseaUrbanVision"
  @ReactMethod fun setEnabled(enabled: Boolean, generation: Double) { UrbanFrameAnalyzer.enable(enabled, generation.toLong()) }
  @ReactMethod fun setSignalHints(hints:ReadableArray,receivedAt:Double,generation:Double) {
    if(!receivedAt.isFinite()||!generation.isFinite())return
    val boxes=ArrayList<SignalBox>()
    for(i in 0 until minOf(hints.size(),3)){
      val b=hints.getMap(i)?:continue
      if(listOf("left","top","right","bottom").any{!b.hasKey(it)||b.isNull(it)})continue
      val box=SignalBox(b.getDouble("left").toFloat(),b.getDouble("top").toFloat(),b.getDouble("right").toFloat(),b.getDouble("bottom").toFloat())
      if(box.valid())boxes.add(box)
    }
    UrbanFrameAnalyzer.setSignalHints(boxes,receivedAt.toLong(),generation.toLong())
  }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  override fun invalidate() { UrbanFrameAnalyzer.detach(); super.invalidate() }
}
class UrbanVisionPackage: ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(UrbanVisionModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*,*>> = emptyList()
}
