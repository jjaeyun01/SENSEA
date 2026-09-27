import { validBox, sameSignalHead } from "./signal-observations.mjs";
/** Boxes only: a base traffic-light detection is a crop hint, never a WALK state. */
export function signalFocusHints(base, observation, now) {
  const fresh=at=>Number.isFinite(at)&&Number.isFinite(now)&&at<=now&&now-at<=1000;
  const boxes=[];const times=[];
  if(fresh(observation?.observedAt)&&validBox(observation?.target)) {
    boxes.push({...observation.target});times.push(observation.observedAt);
  }
  if(base?.quality?.status==="usable"&&fresh(base.receivedAt)) {
    for(const d of (base.detections??[]).slice(0,25)) {
      if(boxes.length>=3)break;
      if(d?.label!=="traffic light"||!Number.isFinite(d.score)||d.score<.55||d.score>1||!validBox(d.box))continue;
      if(boxes.some(b=>sameSignalHead(b,d.box)))continue;
      boxes.push({...d.box});times.push(base.receivedAt);
    }
  }
  return {boxes,receivedAt:times.length?Math.min(...times):0};
}
