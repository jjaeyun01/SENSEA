import { validBox, boxOverlap } from "./crossing.mjs";
import { screenPathRelation } from "./hazard-policy.mjs";
const facility=new Set(["streetlight","trash_can","bicycle_rack","bicycle_locker","bollard","flowerbed","construction_cone","barricade","utility_pole","e_scooter","stairs","curb","open_manhole","low_branch","awning","open_window"]);
/** Experimental model scores stay raw; never re-scale them into COCO confidence. */
export class FacilityAttention {
 constructor(){this.reset();}
 reset(){this.tracks=[];this.nextId=1;this.lastAt=-Infinity;}
 update(frame,now=Date.now()){
  if(!frame||frame.quality!=="usable"||!Number.isFinite(frame.receivedAt)||now-frame.receivedAt>1000||now<frame.receivedAt){this.reset();return [];}
  if(frame.receivedAt<=this.lastAt)return [];
  this.lastAt=frame.receivedAt;
  const old=this.tracks;const used=new Set();this.tracks=[];
  for(const d of (frame.detections??[]).slice(0,24)){
   if(!facility.has(d.label)||!validBox(d.box)||!Number.isFinite(d.score)||d.score<.22||d.score>1)continue;
   const matches=old.filter(t=>!used.has(t.id)&&t.label===d.label&&frame.receivedAt-t.at<=1500&&boxOverlap(t.box,d.box)>=.45).sort((a,b)=>boxOverlap(b.box,d.box)-boxOverlap(a.box,d.box));
   const t=matches[0];if(t)used.add(t.id);
   const scores=[...(t?.scores??[]),d.score].slice(-4);
   this.tracks.push({id:t?.id??this.nextId++,label:d.label,box:{...d.box},score:d.score,at:frame.receivedAt,first:t?.first??frame.receivedAt,count:Math.min(4,(t?.count??0)+1),scores,strong:scores.every(score=>score>=.35)});
   if(this.tracks.length>=12)break;
  }
  return this.tracks.filter(t=>t.count>=3&&t.at-t.first>=500).map(t=>{
   const relation=screenPathRelation(t.box), area=(t.box.right-t.box.left)*(t.box.bottom-t.box.top);
   const central=relation==="direct"&&t.box.bottom>=.70;
   const level=central&&area>=.18&&t.box.bottom>=.88&&t.strong?"priority":central||relation==="offset"?"caution":"notice";
   return {...t,level,relation};
  }).sort((a,b)=>({priority:2,caution:1,notice:0}[b.level]-{priority:2,caution:1,notice:0}[a.level])||b.score-a.score).slice(0,3);
 }
}
