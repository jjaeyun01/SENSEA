import { projectBoxToPreview } from "./preview-geometry.mjs";
import { groupSignalHeads } from "./signal-observations.mjs";
import { boxOverlap, validBox } from "./crossing.mjs";
export const OVERLAY_LIMIT=10;
const fresh=(at,now)=>Number.isFinite(at)&&now>=at&&now-at<=1000;
/** Current observations only; priority boxes first, then ordinary object detections. */
export function buildObjectOverlays(result,hazard,urban,previewSize,now=Date.now()) {
  const selected=[];
  const add=(item,imageSize,key,level="detected")=>{
    if(selected.length>=OVERLAY_LIMIT || !item || !validBox(item.box))return;
    if(selected.some(s=>s.label===item.label&&boxOverlap(s.box,item.box)>.4))return;
    const pixels=projectBoxToPreview(item.box,imageSize,previewSize);
    if(pixels)selected.push({...pixels,key,label:item.label,box:{...item.box},level,score:item.score??null});
  };
  if(result&&fresh(result.receivedAt,now)&&result.quality?.status==="usable"){
    if(hazard&&fresh(hazard.observedAt,now))for(const h of hazard.hazards.slice(0,3))add(h,result.imageSize,`h-${h.trackId}`,h.level);

  }
  if(urban&&fresh(urban.receivedAt,now)&&urban.quality==="usable") {
    for(const [i,d] of urban.detections.slice(0,24).entries())
      if(d.level==="priority"||d.level==="caution")add(d,urban.imageSize,`u-alert-${i}`,d.level);
    // One housing/symbol cluster gets one box; state is confirmed by the signal panel.
    for(const [i,head] of groupSignalHeads(urban.detections).entries())
      add({label:"pedestrian_signal",box:head.box,score:head.score},urban.imageSize,`signal-${i}`,"candidate");
    for(const [i,d] of urban.detections.slice(0,24).entries())
      if(!["pedestrian_signal","walk_signal","dont_walk_signal"].includes(d.label))add(d,urban.imageSize,`u-${i}`,d.level??"candidate");
  }
  if(result&&fresh(result.receivedAt,now)&&result.quality?.status==="usable")
    for(const [i,d] of result.detections.slice(0,25).entries())add(d,result.imageSize,`d-${i}`,d.nearCandidate?"candidate":"detected");
  return selected;
}
