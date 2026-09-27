package com.sensea.urban

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Paint
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
  private data class Hints(val boxes:List<SignalBox>,val at:Long)
  @Volatile private var hints=Hints(emptyList(),0)
  @Volatile private var recentSignal=Hints(emptyList(),0)
  @Volatile private var recentFocus=Hints(emptyList(),0)
  private var lastFocus=0L
  private var focusHoldUntil=0L
  private var searchIndex=0
  private var loggedFocus=false
  private var loggedOcr=false
  private val paint=Paint(Paint.FILTER_BITMAP_FLAG)
  @Synchronized internal fun setSignalHints(boxes:List<SignalBox>,at:Long,token:Long) {
    if(enabled && generation==token) hints=Hints(boxes.filter{it.valid()}.take(3),at)
  }
  @Synchronized fun attach(c:ReactApplicationContext) { context=c; sensorManager=c.getSystemService(android.content.Context.SENSOR_SERVICE) as SensorManager }
  @Synchronized fun enable(value:Boolean, token:Long) {
    if(value&&stalled){emitStatus("unavailable",token);return}
    generation=token;enabled=value;misses=0;loggedFrame=false;lastFrame=0L;headingAt=0L;heading=Double.NaN
    hints=Hints(emptyList(),0);recentSignal=Hints(emptyList(),0);recentFocus=Hints(emptyList(),0);lastFocus=0L;focusHoldUntil=0L;searchIndex=0;loggedFocus=false;loggedOcr=false
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
  private fun infer(bitmap:Bitmap,region:SignalBox=SignalRegions.full,signalsOnly:Boolean=false):List<UrbanDetection> {
    val resized=Bitmap.createScaledBitmap(bitmap,inputSize,inputSize,true)
    val pixels=IntArray(inputSize*inputSize)
    try { resized.getPixels(pixels,0,inputSize,0,0,inputSize,inputSize) } finally { if(resized!==bitmap)resized.recycle() }
    val count=pixels.size
    for(i in pixels.indices){val p=pixels[i]
      input[i]=(((p shr 16) and 255)/255f-means[0])/stds[0]
      input[count+i]=(((p shr 8) and 255)/255f-means[1])/stds[1]
      input[2*count+i]=((p and 255)/255f-means[2])/stds[2]
    }
    OnnxTensor.createTensor(env,FloatBuffer.wrap(input),longArrayOf(1,3,inputSize.toLong(),inputSize.toLong())).use{tensor->
      session!!.run(mapOf("pixels" to tensor)).use{result->
        @Suppress("UNCHECKED_CAST") val scores=(result.get("scores").get().value as Array<Array<FloatArray>>)[0]
        @Suppress("UNCHECKED_CAST") val boxes=(result.get("boxes").get().value as Array<Array<FloatArray>>)[0]
        return SignalRegions.decode(scores,boxes,labels,region,signalsOnly)
      }
    }
  }
  private fun usable(bitmap:Bitmap):Boolean {
    var sum=0.0;var square=0.0;var n=0
    for(y in 0 until bitmap.height step 8)for(x in 0 until bitmap.width step 8){
      val p=bitmap.getPixel(x,y);val gray=.2126*((p shr 16) and 255)+.7152*((p shr 8) and 255)+.0722*(p and 255)
      sum+=gray;square+=gray*gray;n++
    }
    val mean=sum/n;return mean>=18 && mean<=242 && square/n-mean*mean>=20
  }
  private fun analyze(bitmap:Bitmap,receivedAt:Long,token:Long,frameHeading:Double,frameHeadingAt:Long,accuracy:Int) {
    if(!usable(bitmap)){emitResult(emptyList(),Arguments.createArray(),bitmap,receivedAt,token,frameHeading,frameHeadingAt,accuracy,"retake");return}
    var detections=infer(bitmap)
    val now=System.currentTimeMillis();val observedHints=hints
    val freshHints=if(now-observedHints.at in 0..1000)observedHints.boxes else emptyList()
    val heads=SignalRegions.heads(detections)
    val recent=recentSignal
    val follow=if(now-recent.at in 0..1000)recent.boxes.firstOrNull() else null
    // Search every 1.2 s; a crop-only head needs a fresh follow-up on the next
    // 600 ms frame so a full-frame miss does not erase all confirmation evidence.
    // The old box only selects pixels: it is never emitted as a new detection.
    val interval=SignalRegions.focusInterval(heads.isNotEmpty(),if(follow!=null)recent.at else 0,now)
    if(enabled&&generation==token&&now-receivedAt<250&&receivedAt-lastFocus>=interval&&now>=focusHoldUntil){
      val target=heads.firstOrNull{h->freshHints.any{SignalRegions.sameHead(it,h.box)}}?.box?:heads.firstOrNull()?.box?:follow?:freshHints.firstOrNull()
      val previousFocus=recentFocus
      val repeatRegion=if(heads.isEmpty()&&follow!=null&&now-previousFocus.at in 0..1000)previousFocus.boxes.firstOrNull() else null
      val region=if(repeatRegion!=null)SignalRegions.pixels(repeatRegion,bitmap.width,bitmap.height)
        else if(target!=null)SignalRegions.focus(target,bitmap.width,bitmap.height)
        else SignalRegions.search(bitmap.width,bitmap.height,searchIndex++)
      lastFocus=receivedAt
      val crop=Bitmap.createBitmap(bitmap,region.left,region.top,region.width,region.height)
      try {
        if(usable(crop)){
          val extra=infer(crop,region.normalized(bitmap.width,bitmap.height),true)
          detections=SignalRegions.limit(detections+extra)
          if(extra.isNotEmpty()&&enabled&&generation==token)recentFocus=Hints(listOf(region.normalized(bitmap.width,bitmap.height)),receivedAt)
          if(!loggedFocus){android.util.Log.i("SENSEA","Signal focus analysis ready: candidates=${extra.size}");loggedFocus=true}
        }
      } finally {if(crop!==bitmap)crop.recycle()}
      if(System.currentTimeMillis()-now>350)focusHoldUntil=System.currentTimeMillis()+5000
    }
    val texts=Arguments.createArray()
    val ocrHeads=SignalRegions.heads(detections).sortedByDescending{d->if(freshHints.any{SignalRegions.sameHead(it,d.box)})1f+d.score else d.score}.take(2)
    if(enabled&&generation==token&&ocrHeads.isNotEmpty()&&System.currentTimeMillis()-receivedAt<700){
      readSignalText(bitmap,ocrHeads,texts)
    }
    if(enabled&&generation==token&&System.currentTimeMillis()-receivedAt in 0..1000){
      val currentHeads=SignalRegions.heads(detections)
      if(currentHeads.isNotEmpty())recentSignal=Hints(currentHeads.map{it.box}.take(2),receivedAt)
    }
    emitResult(detections,texts,bitmap,receivedAt,token,frameHeading,frameHeadingAt,accuracy,"usable")
  }
  private data class OcrTile(val head:SignalBox,val source:PixelRegion,val dest:RectF,val scale:Float)
  private fun readSignalText(bitmap:Bitmap,heads:List<UrbanDetection>,texts:WritableArray) {
    // At most two heads, each in original + contrast views, in one bounded OCR call.
    val atlas=Bitmap.createBitmap(256*heads.size,512,Bitmap.Config.ARGB_8888)
    try {
      val canvas=Canvas(atlas);canvas.drawColor(android.graphics.Color.BLACK)
      val tiles=heads.mapIndexed{index,d->
        val src=SignalRegions.ocr(d.box,bitmap.width,bitmap.height)
        val scale=min(4f,min(256f/src.width,256f/src.height))
        val left=index*256+(256-src.width*scale)/2;val top=(256-src.height*scale)/2
        val dest=RectF(left,top,left+src.width*scale,top+src.height*scale)
        canvas.drawBitmap(bitmap,Rect(src.left,src.top,src.right,src.bottom),dest,paint)
        OcrTile(d.box,src,dest,scale)
      }
      // Red/orange LED dots and white text are darkened on a white background.
      // A 1 px dilation at OCR scale connects dots; it does not synthesize digits.
      val enhanced=tiles.map { tile ->
        val left=tile.dest.left.toInt().coerceAtLeast(0);val top=tile.dest.top.toInt().coerceAtLeast(0)
        val width=min(atlas.width-left,ceil(tile.dest.width()).toInt());val height=min(256-top,ceil(tile.dest.height()).toInt())
        val pixels=IntArray(width*height);atlas.getPixels(pixels,0,width,left,top,width,height)
        val ink=BooleanArray(pixels.size){SignalRegions.illuminatedText(pixels[it])}
        val highContrast=IntArray(pixels.size){android.graphics.Color.WHITE}
        for(y in 0 until height)for(x in 0 until width){
          var active=false
          for(dy in -1..1)for(dx in -1..1){val xx=x+dx;val yy=y+dy;if(xx in 0 until width&&yy in 0 until height&&ink[yy*width+xx])active=true}
          if(active)highContrast[y*width+x]=android.graphics.Color.BLACK
        }
        atlas.setPixels(highContrast,0,width,left,top+256,width,height)
        tile.copy(dest=RectF(tile.dest.left,tile.dest.top+256,tile.dest.right,tile.dest.bottom+256))
      }
      val views=tiles+enhanced
      // Retain both bitmaps until ML Kit completes, including errors and slow work.
      val read=Tasks.await(recognizer.process(InputImage.fromBitmap(atlas,0)))
      var kept=0
      val numericHeads=HashSet<SignalBox>()
      for(block in read.textBlocks)for(line in block.lines)for(element in line.elements){
        if(kept>=16)continue
        val rect=element.boundingBox?:continue
        val tile=views.singleOrNull{rect.left>=it.dest.left-1&&rect.top>=it.dest.top-1&&rect.right<=it.dest.right+1&&rect.bottom<=it.dest.bottom+1}?:continue
        val text=element.text.trim().take(32)
        if(!text.matches(Regex("(?i)([0-9]{1,2}|WALK|DON['’]?T(?:\\s+WALK)?|DO(?:\\s+NOT(?:\\s+WALK)?)?|NOT)")))continue
        fun x(v:Int)=((tile.source.left+(v-tile.dest.left)/tile.scale)/bitmap.width).coerceIn(0f,1f)
        fun y(v:Int)=((tile.source.top+(v-tile.dest.top)/tile.scale)/bitmap.height).coerceIn(0f,1f)
        val item=Arguments.createMap();item.putString("text",text);item.putMap("box",boxMap(x(rect.left),y(rect.top),x(rect.right),y(rect.bottom)))
        val h=tile.head;item.putMap("signalBox",boxMap(h.left,h.top,h.right,h.bottom));texts.pushMap(item);kept++
        if(text.matches(Regex("[0-9]{1,2}")))numericHeads.add(h)
      }
      for(tile in tiles){
        if(tile.head in numericHeads||kept>=16)continue
        val left=tile.dest.left.toInt();val top=tile.dest.top.toInt()
        val w=min(atlas.width-left,ceil(tile.dest.width()).toInt());val h=min(256-top,ceil(tile.dest.height()).toInt())
        val pixels=IntArray(w*h);atlas.getPixels(pixels,0,w,left,top,w,h)
        for(d in LedCountdown.read(pixels,w,h)){
          if(kept>=16)break
          fun x(v:Int)=((tile.source.left+(left+v-tile.dest.left)/tile.scale)/bitmap.width).coerceIn(0f,1f)
          fun y(v:Int)=((tile.source.top+(top+v-tile.dest.top)/tile.scale)/bitmap.height).coerceIn(0f,1f)
          val b=d.region;val head=tile.head
          val item=Arguments.createMap();item.putString("text",d.value.toString());item.putString("method","led_segments")
          item.putMap("box",boxMap(x(b.left),y(b.top),x(b.right),y(b.bottom)))
          item.putMap("signalBox",boxMap(head.left,head.top,head.right,head.bottom));texts.pushMap(item);kept++
        }
      }
      if(!loggedOcr){android.util.Log.i("SENSEA","Signal crop OCR ready: heads=${heads.size}, tokens=$kept");loggedOcr=true}
    } finally {atlas.recycle()}
  }
  private fun boxMap(l:Float,t:Float,r:Float,b:Float):WritableMap=Arguments.createMap().apply{putDouble("left",l.toDouble());putDouble("top",t.toDouble());putDouble("right",r.toDouble());putDouble("bottom",b.toDouble())}
  private fun emitResult(detections:List<UrbanDetection>,texts:WritableArray,bitmap:Bitmap,at:Long,token:Long,yaw:Double,yawAt:Long,accuracy:Int,quality:String) {
    if(!enabled||token!=generation)return
    val age=System.currentTimeMillis()-at
    if(age<0||age>1000){misses++;if(misses>=3){enabled=false;emitStatus("slow",token)};return}
    misses=0
    val payload=Arguments.createMap();payload.putDouble("receivedAt",at.toDouble());payload.putDouble("processedMs",age.toDouble());payload.putDouble("generation",token.toDouble());payload.putString("quality",quality)
    payload.putMap("imageSize",Arguments.createMap().apply{putInt("width",bitmap.width);putInt("height",bitmap.height)})
    val found=Arguments.createArray()
    for(d in detections){found.pushMap(Arguments.createMap().apply{putString("label",d.label);putDouble("score",d.score.toDouble());putString("source","owlvit");putMap("box",boxMap(d.box.left,d.box.top,d.box.right,d.box.bottom))})}
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
