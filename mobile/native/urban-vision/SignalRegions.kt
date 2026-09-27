package com.sensea.urban

import kotlin.math.*

internal data class SignalBox(val left:Float,val top:Float,val right:Float,val bottom:Float) {
  val area:Float get()=(right-left)*(bottom-top)
  fun valid()=listOf(left,top,right,bottom).all{it.isFinite()} && left>=0 && top>=0 && right<=1 && bottom<=1 && right>left && bottom>top
}
internal data class UrbanDetection(val label:String,val score:Float,val box:SignalBox)
internal data class PixelRegion(val left:Int,val top:Int,val right:Int,val bottom:Int) {
  val width:Int get()=right-left
  val height:Int get()=bottom-top
  fun normalized(w:Int,h:Int)=SignalBox(left.toFloat()/w,top.toFloat()/h,right.toFloat()/w,bottom.toFloat()/h)
}
/** Bounded geometry shared by the native detector and its JVM regression checks. */
internal object SignalRegions {
  val full=SignalBox(0f,0f,1f,1f)
  fun isSignal(label:String)=label in setOf("pedestrian_signal","walk_signal","dont_walk_signal")
  fun overlap(a:SignalBox,b:SignalBox):Float {
    val n=max(0f,min(a.right,b.right)-max(a.left,b.left))*max(0f,min(a.bottom,b.bottom)-max(a.top,b.top))
    return n/(a.area+b.area-n).coerceAtLeast(.000001f)
  }
  fun sameHead(a:SignalBox,b:SignalBox):Boolean {
    if(overlap(a,b)>=.35f)return true
    val large=if(a.area>=b.area)a else b;val small=if(a.area>=b.area)b else a
    val n=max(0f,min(a.right,b.right)-max(a.left,b.left))*max(0f,min(a.bottom,b.bottom)-max(a.top,b.top))
    return small.area/large.area>=.06f && n/small.area>=.85f &&
      abs((a.left+a.right-b.left-b.right)/2)<=(large.right-large.left)*.22f &&
      abs((a.top+a.bottom-b.top-b.bottom)/2)<=(large.bottom-large.top)*.22f
  }
  fun mapBox(raw:FloatArray,region:SignalBox):SignalBox? {
    if(raw.size!=4||raw.any{!it.isFinite()}||!region.valid())return null
    val l=(raw[0]-raw[2]/2).coerceIn(0f,1f);val t=(raw[1]-raw[3]/2).coerceIn(0f,1f)
    val r=(raw[0]+raw[2]/2).coerceIn(0f,1f);val b=(raw[1]+raw[3]/2).coerceIn(0f,1f)
    if(r-l<.008f||b-t<.008f)return null
    return SignalBox(region.left+l*(region.right-region.left),region.top+t*(region.bottom-region.top),
      region.left+r*(region.right-region.left),region.top+b*(region.bottom-region.top)).takeIf{it.valid()}
  }
  fun decode(scores:Array<FloatArray>,boxes:Array<FloatArray>,labels:List<String>,region:SignalBox=full,signalsOnly:Boolean=false):List<UrbanDetection> {
    require(scores.size==144 && boxes.size==144)
    val found=ArrayList<UrbanDetection>()
    for(i in scores.indices){
      require(scores[i].size==labels.size)
      val b=mapBox(boxes[i],region)?:continue
      val valid=scores[i].indices.filter{scores[i][it].isFinite()&&scores[i][it] in 0f..1f}
      val best=valid.maxByOrNull{scores[i][it]}?:continue
      // Keep competing signal labels. Winner-take-all used to hide a signal behind
      // its pole/housing and discard hand/WALK disagreement before JS could see it.
      for(c in valid){val score=scores[i][c];val signal=isSignal(labels[c])
        if(signal && score>=.16f && (isSignal(labels[best]) || score>=scores[i][best]*.65f))
          found.add(UrbanDetection(labels[c],score,b))
        else if(!signalsOnly && c==best && !signal && score>=.2f)found.add(UrbanDetection(labels[c],score,b))
      }
    }
    return limit(found)
  }
  fun limit(input:List<UrbanDetection>):List<UrbanDetection> {
    val kept=ArrayList<UrbanDetection>()
    for(d in input.sortedByDescending{it.score}){
      if(kept.none{it.label==d.label&&overlap(it.box,d.box)>.45f})kept.add(d)
      if(kept.size>=96)break
    }
    // Reserve signal slots so many nearby objects do not evict the distant head.
    val signals=kept.filter{isSignal(it.label)}.take(8)
    return signals+kept.filter{!isSignal(it.label)}.take(24-signals.size)
  }
  fun heads(detections:List<UrbanDetection>):List<UrbanDetection> {
    val heads=ArrayList<UrbanDetection>()
    for(d in detections.filter{isSignal(it.label)}.sortedWith(compareByDescending<UrbanDetection>{it.label=="pedestrian_signal"}.thenByDescending{it.score}))
      if(heads.none{sameHead(it.box,d.box)})heads.add(d)
    return heads.take(4)
  }
  // OCR contrast only: these pixels never classify a signal's state or color.
  fun illuminatedText(pixel:Int):Boolean {
    val r=(pixel shr 16) and 255;val g=(pixel shr 8) and 255;val b=pixel and 255
    val hi=max(r,max(g,b));val lo=min(r,min(g,b))
    return hi>=90 && ((r>g*1.25 && r>b*1.15) || (hi>=180 && hi-lo<70))
  }
  fun focusInterval(hasCurrentHead:Boolean,recentAt:Long,now:Long):Long =
    if(!hasCurrentHead && recentAt>0 && now-recentAt in 0..1000)600L else 1200L
  fun focus(box:SignalBox,w:Int,h:Int):PixelRegion {
    require(box.valid()&&w>0&&h>0)
    val side=max(max((box.right-box.left)*w,(box.bottom-box.top)*h)*2.2f,min(w,h)*.35f).coerceAtMost(min(w,h)*.9f).roundToInt().coerceAtLeast(1)
    val left=(((box.left+box.right)*w-side)/2).roundToInt().coerceIn(0,w-side)
    val top=(((box.top+box.bottom)*h-side)/2).roundToInt().coerceIn(0,h-side)
    return PixelRegion(left,top,left+side,top+side)
  }
  fun search(w:Int,h:Int,index:Int):PixelRegion {
    val side=(min(w,h)*.5f).roundToInt().coerceAtLeast(1)
    val cx=floatArrayOf(w*.5f,side/2f,w-side/2f)[Math.floorMod(index,3)]
    val left=(cx-side/2).roundToInt().coerceIn(0,w-side)
    val top=(h*.3f-side/2).roundToInt().coerceIn(0,h-side)
    return PixelRegion(left,top,left+side,top+side)
  }
  fun pixels(box:SignalBox,w:Int,h:Int):PixelRegion {
    require(box.valid()&&w>0&&h>0)
    val l=(box.left*w).roundToInt().coerceIn(0,w-1);val t=(box.top*h).roundToInt().coerceIn(0,h-1)
    return PixelRegion(l,t,(box.right*w).roundToInt().coerceIn(l+1,w),(box.bottom*h).roundToInt().coerceIn(t+1,h))
  }
  fun ocr(box:SignalBox,w:Int,h:Int):PixelRegion {
    require(box.valid()&&w>0&&h>0)
    val dx=min(.02f,(box.right-box.left)*.18f);val dy=min(.02f,(box.bottom-box.top)*.12f)
    val l=floor((box.left-dx)*w).toInt().coerceIn(0,w-1);val t=floor((box.top-dy)*h).toInt().coerceIn(0,h-1)
    return PixelRegion(l,t,ceil((box.right+dx)*w).toInt().coerceIn(l+1,w),ceil((box.bottom+dy)*h).toInt().coerceIn(t+1,h))
  }
}
