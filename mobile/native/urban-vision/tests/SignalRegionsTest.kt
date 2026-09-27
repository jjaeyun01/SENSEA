package com.sensea.urban

fun main() {
  var checks=0
  fun verify(value:Boolean){check(value);checks++}
  val box=SignalBox(.3f,.1f,.5f,.4f)
  verify(SignalRegions.sameHead(box,SignalBox(.37f,.2f,.43f,.3f)))
  verify(!SignalRegions.sameHead(box,SignalBox(.54f,.1f,.74f,.4f)))
  for(w in listOf(480,640))for(h in listOf(480,640))for(b in listOf(box,SignalBox(0f,0f,.02f,.02f),SignalBox(.97f,.96f,1f,1f))){
    val r=SignalRegions.focus(b,w,h)
    verify(r.left>=0&&r.top>=0&&r.right<=w&&r.bottom<=h&&r.width==r.height&&r.width>0)
    val o=SignalRegions.ocr(b,w,h)
    verify(o.left>=0&&o.top>=0&&o.right<=w&&o.bottom<=h&&o.width>0&&o.height>0)
  }
  for(i in 0..8){val r=SignalRegions.search(480,640,i);verify(r.left>=0&&r.top>=0&&r.right<=480&&r.bottom<=640)}
  val fixed=PixelRegion(120,72,360,312)
  verify(SignalRegions.pixels(fixed.normalized(480,640),480,640)==fixed)
  verify(SignalRegions.pixels(SignalRegions.full,480,640)==PixelRegion(0,0,480,640))
  val mapped=SignalRegions.mapBox(floatArrayOf(.5f,.5f,.5f,.5f),SignalBox(.2f,.1f,.6f,.5f))!!
  verify(kotlin.math.abs(mapped.left-.3f)<.00001f&&kotlin.math.abs(mapped.bottom-.4f)<.00001f)
  verify(SignalRegions.mapBox(floatArrayOf(Float.NaN,0f,1f,1f),box)==null)
  val labels=listOf("streetlight","pedestrian_signal","walk_signal","dont_walk_signal")
  val scores=Array(144){FloatArray(4)};val boxes=Array(144){floatArrayOf(.5f,.5f,.2f,.3f)}
  scores[0]=floatArrayOf(.3f,.24f,.23f,.22f)
  val all=SignalRegions.decode(scores,boxes,labels)
  verify(all.map{it.label}.toSet()==labels.toSet())
  verify(SignalRegions.decode(scores,boxes,labels,signalsOnly=true).none{it.label=="streetlight"})
  verify(SignalRegions.heads(all).size==1)
  scores[0]=floatArrayOf(.05f,.6f,.05f,.26f)
  verify(SignalRegions.decode(scores,boxes,labels).any{it.label=="dont_walk_signal"})
  verify(SignalRegions.focusInterval(false,1000,1600)==600L)
  verify(SignalRegions.focusInterval(false,1000,2000)==600L)
  verify(SignalRegions.focusInterval(false,1000,2001)==1200L)
  verify(SignalRegions.focusInterval(false,1001,1000)==1200L)
  verify(SignalRegions.focusInterval(true,1000,1600)==1200L)
  verify(SignalRegions.focusInterval(false,0,1600)==1200L)
  verify(SignalRegions.illuminatedText(0x00ee3311))
  verify(SignalRegions.illuminatedText(0x00ffaa22))
  verify(SignalRegions.illuminatedText(0x00eeeeee))
  verify(!SignalRegions.illuminatedText(0x00151515))
  verify(!SignalRegions.illuminatedText(0x0011ee33))
  verify(!SignalRegions.illuminatedText(0x00707070))
  val crowded=(0..39).map{UrbanDetection("other$it",.9f,box)}+UrbanDetection("pedestrian_signal",.17f,box)
  val limited=SignalRegions.limit(crowded)
  verify(limited.size==24&&limited.any{it.label=="pedestrian_signal"})
  val patterns=listOf("abcdef","bc","abdeg","abcdg","bcfg","acdfg","acdefg","abc","abcdefg","abcdfg")
  fun fixture(pattern:String):IntArray {
    val p=IntArray(256*256){0xff101010.toInt()}
    fun rect(l:Int,t:Int,r:Int,b:Int){for(y in t until b)for(x in l until r)p[y*256+x]=0xffff4020.toInt()}
    for(c in pattern)when(c){
      'a'->rect(170,60,230,70);'b'->rect(220,60,230,115);'c'->rect(220,105,230,160)
      'd'->rect(170,150,230,160);'e'->rect(170,105,180,160);'f'->rect(170,60,180,115);'g'->rect(170,105,230,115)
    }
    return p
  }
  for(n in 0..9){val read=LedCountdown.read(fixture(patterns[n]),256,256);verify(if(n==1)read.isEmpty() else read.singleOrNull()?.value==n)}
  verify(LedCountdown.read(IntArray(256*256),256,256).isEmpty())
  val filled=IntArray(256*256){i->if(i%256 in 170..230&&i/256 in 60..160)0xffff4020.toInt() else 0xff101010.toInt()}
  verify(LedCountdown.read(filled,256,256).isEmpty())
  verify(LedCountdown.read(IntArray(257*256),257,256).isEmpty())
  println("SignalRegions: $checks native geometry/decoder checks passed")
}
