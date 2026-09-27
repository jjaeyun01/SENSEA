package com.sensea.urban

import kotlin.math.*

internal data class LedDigit(val value:Int,val region:PixelRegion)
/** Narrow fallback for illuminated seven-segment digits on the right of a signal.
 * It never recognizes WALK, a traffic-light color, or permission to cross.
 */
internal object LedCountdown {
  private val patterns=mapOf("abcdef" to 0,"bc" to 1,"abdeg" to 2,"abcdg" to 3,"bcfg" to 4,
    "acdfg" to 5,"acdefg" to 6,"abc" to 7,"abcdefg" to 8,"abcdfg" to 9)
  fun read(pixels:IntArray,w:Int,h:Int):List<LedDigit> {
    if(w<12||h<16||w>256||h>256||pixels.size!=w*h)return emptyList()
    val raw=BooleanArray(pixels.size){SignalRegions.illuminatedText(pixels[it])}
    val mask=BooleanArray(pixels.size)
    for(y in 1 until h-1)for(x in 1 until w-1){
      var lit=false
      for(dy in -1..1)for(dx in -1..1)if(raw[(y+dy)*w+x+dx])lit=true
      mask[y*w+x]=lit
    }
    val seen=BooleanArray(mask.size);val queue=IntArray(mask.size);val found=ArrayList<LedDigit>()
    for(start in mask.indices){
      if(!mask[start]||seen[start])continue
      var count=1;var visit=0;queue[0]=start;seen[start]=true
      var l=start%w;var r=l;var t=start/w;var b=t
      while(visit<count){
        val i=queue[visit++];val x=i%w;val y=i/w;l=min(l,x);r=max(r,x);t=min(t,y);b=max(b,y)
        for(dy in -1..1)for(dx in -1..1){val xx=x+dx;val yy=y+dy
          if(xx in 0 until w&&yy in 0 until h){val j=yy*w+xx;if(mask[j]&&!seen[j]){seen[j]=true;queue[count++]=j}}
        }
      }
      val bw=r-l+1;val bh=b-t+1;val aspect=bw.toFloat()/bh
      // Reject border/background components, the left hand glyph, and short specks.
      if(l<=1||t<=1||r>=w-2||b>=h-2||(l+r)/2f<w*.52f||bh<max(16f,h*.22f)||bh>h*.9f||aspect !in .08f.. .85f)continue
      fun fill(x0:Float,y0:Float,x1:Float,y1:Float):Float {
        val ll=(l+x0*bw).toInt();val rr=(l+x1*bw).toInt().coerceAtMost(r+1)
        val tt=(t+y0*bh).toInt();val bb=(t+y1*bh).toInt().coerceAtMost(b+1)
        var n=0;var total=0
        for(y in tt until bb)for(x in ll until rr){total++;if(mask[y*w+x])n++}
        return if(total==0)0f else n.toFloat()/total
      }
      if(aspect<.2f){
        if(fill(0f,0f,1f,1f)>=.75f)found.add(LedDigit(1,PixelRegion(l,t,r+1,b+1)))
        continue
      }
      val coverage=listOf(fill(.18f,0f,.82f,.18f),fill(.72f,.18f,1f,.42f),fill(.72f,.58f,1f,.82f),
        fill(.18f,.82f,.82f,1f),fill(0f,.58f,.28f,.82f),fill(0f,.18f,.28f,.42f),fill(.18f,.43f,.82f,.58f))
      if(coverage.any{it>.28f&&it<.48f})continue
      val pattern=coverage.mapIndexedNotNull{i,v->if(v>=.48f)('a'+i).toString() else null}.joinToString("")
      val digit=patterns[pattern]?:continue
      // Reject filled glyphs/hand fragments: centers between strokes must be empty.
      if(fill(.32f,.23f,.68f,.37f)>.35f||fill(.32f,.63f,.68f,.77f)>.35f)continue
      found.add(LedDigit(digit,PixelRegion(l,t,r+1,b+1)))
      if(found.size>2)return emptyList()
    }
    if(found.size !in 1..2)return emptyList()
    if(found.size==1&&found[0].value==1)return emptyList() // A lone bar is ambiguous.
    val ordered=found.sortedBy{it.region.left}
    if(ordered.size==2){
      val a=ordered[0].region;val b=ordered[1].region
      if(a.height.toFloat()/b.height !in .65f..1.55f || abs((a.top+a.bottom-b.top-b.bottom)/2f)>min(a.height,b.height)*.3f || b.left-a.right>max(a.height,b.height)*.7f)return emptyList()
    }
    return ordered
  }
}
