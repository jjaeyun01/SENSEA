package com.sensea.urban

import android.graphics.Bitmap
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import ai.onnxruntime.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*

/** One copied, bounded frame at a time; the camera still owns and closes its ImageProxy. */
object UrbanFrameAnalyzer: SensorEventListener {
  private var context: ReactApplicationContext? = null
  private val worker=Executors.newSingleThreadExecutor { r -> Thread(r,"sensea-urban").apply{isDaemon=true} }
  private val busy=AtomicBoolean(false)
  private val watchdog=Handler(Looper.getMainLooper())
  @Volatile private var stalled=false
  @Volatile private var enabled=false
  @Volatile private var generation=0L
  @Volatile private var session: OrtSession?=null
  @Volatile private var heading=Double.NaN
  @Volatile private var headingAt=0L
  @Volatile private var headingAccuracy=0
  private var sensorManager: SensorManager?=null
  private var lastFrame=0L
  private var misses=0
  @Volatile private var loggedFrame=false
  private var recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val env=OrtEnvironment.getEnvironment()
  private var labels=emptyList<String>()
  private var inputSize=384
  private var input=FloatArray(3*384*384)
  private val means=floatArrayOf(.48145466f,.4578275f,.40821073f)
  private val stds=floatArrayOf(.26862954f,.26130258f,.27577711f)
  private data class Detection(val label:String,val score:Float,val left:Float,val top:Float,val right:Float,val bottom:Float)
  @Synchronized fun attach(c:ReactApplicationContext) { context=c; sensorManager=c.getSystemService(android.content.Context.SENSOR_SERVICE) as SensorManager }
  @Synchronized fun enable(value:Boolean, token:Long) {
    if(value&&stalled){emitStatus("unavailable",token);return}
    generation=token;enabled=value;misses=0;loggedFrame=false;lastFrame=0L;headingAt=0L;heading=Double.NaN
    sensorManager?.unregisterListener(this)
    if(value) {
      sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let{sensorManager?.registerListener(this,it,SensorManager.SENSOR_DELAY_UI)}
      worker.execute { try { initialize(); if(enabled&&generation==token) emitStatus("ready",token) } catch(e:Exception){ android.util.Log.w("SENSEA","Urban initialization failed",e);if(generation==token){enabled=false;emitStatus("unavailable",token)} } }
    }
  }
  @Synchronized fun detach() {
    enabled=false;generation++;sensorManager?.unregisterListener(this)
    worker.execute { session?.close();session=null;recognizer.close() }
    context=null
  }
  private fun initialize() {
    if(session!=null)return
    val c=context?:return
    val manifest=JSONObject(c.assets.open("sensea-urban/urban-manifest.json").bufferedReader().use{it.readText()})
    val expected=manifest.getString("sha256")
    inputSize=manifest.getInt("input_size")
    require(inputSize==384)
    val list=JSONArray(c.assets.open("sensea-urban/urban-labels.json").bufferedReader().use{it.readText()})
    labels=(0 until list.length()).map{list.getJSONObject(it).getString("label")}
    require(labels.size==manifest.getInt("classes") && labels.size<=64)
    val file=File(c.filesDir,"sensea-urban-$expected.onnx")
    fun hash(f:File):String { val d=MessageDigest.getInstance("SHA-256");f.inputStream().use{stream-> val bytes=ByteArray(65536);while(true){val n=stream.read(bytes);if(n<0)break;d.update(bytes,0,n)}};return d.digest().joinToString(""){"%02x".format(it)} }
    if(!file.isFile || hash(file)!=expected) {
      val temp=File(c.filesDir,"sensea-urban-$expected.partial")
      c.assets.open("sensea-urban/urban-int8.onnx").use{src->temp.outputStream().use{src.copyTo(it)}}
      require(hash(temp)==expected){"Model checksum mismatch"}
      check(temp.renameTo(file)){"Cannot install bundled model"}
    }
    val options=OrtSession.SessionOptions()
    options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1)
    try{session=env.createSession(file.absolutePath,options)}finally{options.close()}
    input=FloatArray(3*inputSize*inputSize)
  }
  /** Called synchronously by the public camera output hook. Never retain buffer. */
  @JvmStatic fun offerFrame(buffer:ByteBuffer,width:Int,height:Int,stride:Int,rotation:Int,mirrored:Boolean) {
    if(!enabled || session==null)return
    val now=SystemClock.elapsedRealtime()
    if(now-lastFrame<600 || !busy.compareAndSet(false,true))return
    lastFrame=now
    val token=generation;val receivedAt=System.currentTimeMillis()
    val frameHeading=heading;val frameHeadingAt=headingAt;val accuracy=headingAccuracy
    var bitmap:Bitmap?=null
    try {
      require(width>0&&height>0&&width*height<=1280*720&&stride>=width*4&&rotation in listOf(0,90,180,270))
      val bytes=buffer.duplicate();require(bytes.limit()>=(height-1)*stride+width*4)
      val uw=if(rotation%180==0)width else height;val uh=if(rotation%180==0)height else width
      val scale=min(1.0,640.0/max(uw,uh));val ow=max(1,(uw*scale).toInt());val oh=max(1,(uh*scale).toInt())
      val pixels=IntArray(ow*oh)
      for(y in 0 until oh) for(x in 0 until ow) {
        val ux=min(uw-1,((if(mirrored)ow-1-x else x)*uw.toDouble()/ow).toInt());val uy=min(uh-1,(y*uh.toDouble()/oh).toInt())
        val sx:Int;val sy:Int
        when(rotation){90->{sx=uy;sy=height-1-ux};180->{sx=width-1-ux;sy=height-1-uy};270->{sx=width-1-uy;sy=ux};else->{sx=ux;sy=uy}}
        val i=sy*stride+sx*4
        pixels[y*ow+x]=(255 shl 24) or ((bytes.get(i).toInt() and 255) shl 16) or ((bytes.get(i+1).toInt() and 255) shl 8) or (bytes.get(i+2).toInt() and 255)
      }
      bitmap=Bitmap.createBitmap(pixels,ow,oh,Bitmap.Config.ARGB_8888)
      val owned=bitmap
      val timeout=Runnable { if(busy.get()){stalled=true;enabled=false;emitStatus("slow",generation)} }
      watchdog.postDelayed(timeout,3000)
      worker.execute {
        try {
          if(!enabled||generation!=token)return@execute
          analyze(owned,receivedAt,token,frameHeading,frameHeadingAt,accuracy)
        } catch(e:Exception) { android.util.Log.w("SENSEA","Urban processing failed",e);if(enabled&&generation==token)emitStatus("frame_error",token) }
        finally { watchdog.removeCallbacks(timeout);owned.recycle();busy.set(false) }
      }
    } catch(e:Exception){bitmap?.recycle();busy.set(false)}
  }
  private fun iou(a:Detection,b:Detection):Float {
    val n=max(0f,min(a.right,b.right)-max(a.left,b.left))*max(0f,min(a.bottom,b.bottom)-max(a.top,b.top))
    return n/((a.right-a.left)*(a.bottom-a.top)+(b.right-b.left)*(b.bottom-b.top)-n).coerceAtLeast(.000001f)
  }
  private fun analyze(bitmap:Bitmap,receivedAt:Long,token:Long,frameHeading:Double,frameHeadingAt:Long,accuracy:Int) {
    val resized=Bitmap.createScaledBitmap(bitmap,inputSize,inputSize,true)
    val pixels=IntArray(inputSize*inputSize);resized.getPixels(pixels,0,inputSize,0,0,inputSize,inputSize)
    if(resized!==bitmap)resized.recycle()
    var brightness=0.0;var brightness2=0.0
    val count=pixels.size
    for(i in pixels.indices){ val p=pixels[i];val r=(p shr 16) and 255;val g=(p shr 8) and 255;val b=p and 255
      input[i]=(r/255f-means[0])/stds[0];input[count+i]=(g/255f-means[1])/stds[1];input[2*count+i]=(b/255f-means[2])/stds[2]
      val gray=.2126*r+.7152*g+.0722*b;brightness+=gray;brightness2+=gray*gray
    }
    val mean=brightness/count;val variance=brightness2/count-mean*mean
    if(mean<18||mean>242||variance<20){emitResult(emptyList(),Arguments.createArray(),bitmap,receivedAt,token,frameHeading,frameHeadingAt,accuracy,"retake");return}
    val candidates=ArrayList<Detection>()
    OnnxTensor.createTensor(env,FloatBuffer.wrap(input),longArrayOf(1,3,inputSize.toLong(),inputSize.toLong())).use{tensor->
      session!!.run(mapOf("pixels" to tensor)).use{result->
        @Suppress("UNCHECKED_CAST") val scores=(result.get("scores").get().value as Array<Array<FloatArray>>)[0]
        @Suppress("UNCHECKED_CAST") val boxes=(result.get("boxes").get().value as Array<Array<FloatArray>>)[0]
        require(scores.size==144&&boxes.size==scores.size)
        for(i in scores.indices){
          val c=scores[i].indices.maxByOrNull{scores[i][it]}?:continue;val score=scores[i][c]
          val threshold=if(labels[c].endsWith("signal")) .16f else .2f
          if(!score.isFinite()||score<threshold||score>1)continue
          val b=boxes[i];if(b.size!=4||b.any{!it.isFinite()})continue
          val l=(b[0]-b[2]/2).coerceIn(0f,1f);val t=(b[1]-b[3]/2).coerceIn(0f,1f)
          val r=(b[0]+b[2]/2).coerceIn(0f,1f);val bottom=(b[1]+b[3]/2).coerceIn(0f,1f)
          if(r-l<.008||bottom-t<.008)continue
          candidates.add(Detection(labels[c],score,l,t,r,bottom))
        }
      }
    }
    val detections=ArrayList<Detection>()
    for(d in candidates.sortedByDescending{it.score}) {
      if(detections.size>=24)break
      if(detections.none{it.label==d.label&&iou(it,d)>.45})detections.add(d)
    }
    val texts=Arguments.createArray()
    val heads=detections.filter{it.label.endsWith("signal")}
    if(heads.isNotEmpty()&&System.currentTimeMillis()-receivedAt<700){
      // OCR owns only this one bitmap until completion. No timeout frees an in-use image.
      val read=Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap,0)))
      var kept=0
      for(block in read.textBlocks)for(line in block.lines)for(element in line.elements){
        if(kept>=16)break
        val rect=element.boundingBox?:continue
        val x=rect.exactCenterX()/bitmap.width;val y=rect.exactCenterY()/bitmap.height
        if(heads.none{x>=it.left&&x<=it.right&&y>=it.top&&y<=it.bottom})continue
        val text=element.text.trim().take(16)
        if(!text.matches(Regex("(?i)([0-9]{1,2}|WALK|DON.?T|DO|NOT)")))continue
        val item=Arguments.createMap();item.putString("text",text)
        item.putMap("box",boxMap(rect.left.toFloat()/bitmap.width,rect.top.toFloat()/bitmap.height,rect.right.toFloat()/bitmap.width,rect.bottom.toFloat()/bitmap.height))
        texts.pushMap(item);kept++
      }
    }
    emitResult(detections,texts,bitmap,receivedAt,token,frameHeading,frameHeadingAt,accuracy,"usable")
  }
  private fun boxMap(l:Float,t:Float,r:Float,b:Float):WritableMap=Arguments.createMap().apply{putDouble("left",l.toDouble());putDouble("top",t.toDouble());putDouble("right",r.toDouble());putDouble("bottom",b.toDouble())}
  private fun emitResult(detections:List<Detection>,texts:WritableArray,bitmap:Bitmap,at:Long,token:Long,yaw:Double,yawAt:Long,accuracy:Int,quality:String) {
    if(!enabled||token!=generation)return
    val age=System.currentTimeMillis()-at
    if(age<0||age>1000){misses++;if(misses>=3){enabled=false;emitStatus("slow",token)};return}
    misses=0
    val payload=Arguments.createMap();payload.putDouble("receivedAt",at.toDouble());payload.putDouble("processedMs",age.toDouble());payload.putDouble("generation",token.toDouble());payload.putString("quality",quality)
    payload.putMap("imageSize",Arguments.createMap().apply{putInt("width",bitmap.width);putInt("height",bitmap.height)})
    val found=Arguments.createArray()
    for(d in detections){found.pushMap(Arguments.createMap().apply{putString("label",d.label);putDouble("score",d.score.toDouble());putString("source","owlvit");putMap("box",boxMap(d.left,d.top,d.right,d.bottom))})}
    payload.putArray("detections",found);payload.putArray("texts",texts)
    if(yaw.isFinite())payload.putDouble("heading",yaw)
    payload.putDouble("headingAt",yawAt.toDouble());payload.putInt("headingAccuracy",accuracy)
    if(!loggedFrame&&quality=="usable"){android.util.Log.i("SENSEA","Urban frame analysis ready: ${age}ms, quality=$quality, candidates=${detections.size}");loggedFrame=true}
    emit("SenseaUrbanResult",payload)
  }
  private fun emitStatus(status:String,token:Long){android.util.Log.i("SENSEA","Urban status: $status");val map=Arguments.createMap();map.putString("status",status);map.putDouble("generation",token.toDouble());emit("SenseaUrbanStatus",map)}
  private fun emit(name:String,payload:WritableMap){val c=context?:return;if(c.hasActiveReactInstance())c.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name,payload)}
  override fun onSensorChanged(event:SensorEvent){
    val rotation=FloatArray(9);val remapped=FloatArray(9);val out=FloatArray(3)
    SensorManager.getRotationMatrixFromVector(rotation,event.values)
    SensorManager.remapCoordinateSystem(rotation,SensorManager.AXIS_X,SensorManager.AXIS_Z,remapped)
    SensorManager.getOrientation(remapped,out)
    heading=((out[0]*180/Math.PI)+360)%360;headingAt=System.currentTimeMillis();headingAccuracy=event.accuracy
  }
  override fun onAccuracyChanged(sensor:Sensor?,accuracy:Int){headingAccuracy=accuracy}
}
