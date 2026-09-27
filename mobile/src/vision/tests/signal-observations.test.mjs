import test from "node:test";
import assert from "node:assert/strict";
import { groupSignalHeads, readSignalEvidence, followsSignal } from "../signal-observations.mjs";
import { CrossingTracker } from "../crossing.mjs";
import { buildObjectOverlays } from "../overlay.mjs";
import { signalFocusHints } from "../signal-hints.mjs";
const box={left:.3,top:.1,right:.5,bottom:.4};
const d=(label,score=.4,b=box)=>({label,score,box:b});
const t=(text,left=.34,top=.2,right=.38,bottom=.28)=>({text,box:{left,top,right,bottom}});
const frame=(at,detections,texts=[])=>({receivedAt:at,quality:"usable",detections,texts});
const twice=(detections,texts=[])=>{const tracker=new CrossingTracker();tracker.update(frame(0,detections,texts),"waiting",0);return tracker.update(frame(600,detections,texts),"waiting",600);};
test("a centered symbol nested inside a housing is one head and preserves its meaning",()=>{
 const detections=[d("pedestrian_signal",.6),d("dont_walk_signal",.4,{left:.37,top:.2,right:.43,bottom:.3})];
 assert.equal(groupSignalHeads(detections).length,1);
 assert.equal(twice(detections).status,"dont_start");
});
test("a generic winner cannot hide confident WALK evidence",()=>{
 assert.equal(twice([d("pedestrian_signal",.6),d("walk_signal",.4)]).status,"walk_observed");
});
test("near-tied hand and WALK candidates never announce WALK",()=>{
 const r=twice([d("walk_signal",.4),d("dont_walk_signal",.38)]);
 assert.equal(r.status,"confirming");assert.match(r.text,/unclear/);assert.equal(r.navigation_safe,false);
});
test("OCR WALK conflicting with a hand symbol stays unknown",()=>{
 assert.equal(twice([d("dont_walk_signal",.5)],[t("WALK",.33,.2,.47,.28)]).status,"confirming");
});
test("split aligned countdown digits are assembled before temporal validation",()=>{
 const texts=[t("1",.33,.2,.36,.28),t("9",.37,.2,.4,.28)];
 const r=twice([d("pedestrian_signal")],texts);
 assert.equal(r.seconds,19);assert.equal(r.status,"dont_start");
 const tracker=new CrossingTracker();tracker.update(frame(0,[d("pedestrian_signal")],texts),"waiting",0);
 assert.equal(tracker.update(frame(600,[d("pedestrian_signal")],[t("9")]),"waiting",600).seconds,null);
});
test("separate rows or far-apart digits do not form a countdown",()=>{
 for(const texts of [[t("1"),t("9",.4,.3,.44,.37)],[t("1",.31,.2,.33,.23),t("9",.45,.2,.47,.23)]])
  assert.equal(twice([d("pedestrian_signal")],texts).seconds,null);
});
test("duplicate OCR boxes do not create a false 99",()=>{
 assert.equal(twice([d("pedestrian_signal")],[t("9"),t("9")]).seconds,9);
});
test("both whole and out-of-order DON'T WALK text resolve to a hand observation",()=>{
 for(const texts of [[t("DON'T WALK",.32,.2,.48,.28)],[t("WALK",.4,.2,.48,.28),t("DON’T",.31,.2,.39,.28)]])
  assert.equal(twice([d("pedestrian_signal")],texts).status,"dont_start");
});
test("adjacent signals require one selection and cannot share nearby countdown text",()=>{
 const right={left:.54,top:.1,right:.74,bottom:.4};const detections=[d("pedestrian_signal"),d("pedestrian_signal",.5,right)];
 const heads=groupSignalHeads(detections);assert.equal(heads.length,2);
 assert.equal(twice(detections,[t("9",.59,.2,.63,.28)]).status,"select_target");
 assert.equal(readSignalEvidence(heads[0],heads,[{...t("9"),signalBox:right}]).seconds,null);
});
test("small head jitter keeps temporal evidence but a neighboring head does not",()=>{
 const small={left:.45,top:.2,right:.49,bottom:.25}, moved={left:.461,top:.21,right:.501,bottom:.26};
 assert.equal(followsSignal(small,moved),true);
 assert.equal(followsSignal(small,{...moved,left:.51,right:.55}),false);
 const tracker=new CrossingTracker();tracker.update(frame(0,[d("walk_signal",.4,small)]),"waiting",0);
 assert.equal(tracker.update(frame(600,[d("walk_signal",.4,moved)]),"waiting",600).status,"walk_observed");
});
test("traffic lights and plain people are never promoted to pedestrian WALK",()=>{
 assert.equal(twice([d("traffic light",.95),d("person",.98)]).status,"unknown");
});
test("focused hints prefer a fresh selected signal and contain only bounded boxes",()=>{
 const base={receivedAt:900,quality:{status:"usable"},detections:[d("person",.99),d("traffic light",.8)]};
 const target={left:.7,top:.1,right:.8,bottom:.3};
 const h=signalFocusHints(base,{target,observedAt:800},1000);
 assert.deepEqual(h.boxes,[target,box]);assert.equal(h.receivedAt,800);
 h.boxes[0].left=0;assert.equal(target.left,.7);
 assert.equal(signalFocusHints({...base,receivedAt:0},null,1001).boxes.length,0);
 assert.equal(signalFocusHints({...base,receivedAt:1002},null,1001).boxes.length,0);
 assert.equal(signalFocusHints({...base,quality:{status:"retake"}},null,1000).boxes.length,0);
});

test("one signal gets one overlay even when housing and competing symbols overlap",()=>{
 const urban={...frame(0,[d("pedestrian_signal"),d("walk_signal",.3),d("dont_walk_signal",.31),d("bench",.4,{left:.6,top:.6,right:.9,bottom:.9})]),imageSize:{width:640,height:480}};
 const boxes=buildObjectOverlays(null,null,urban,{width:640,height:480},0);
 assert.equal(boxes.length,2);assert.deepEqual(boxes.map(b=>b.label),["pedestrian_signal","bench"]);
});


test("signal boxes cannot evict urgent street hazards from the ten-box overlay budget",()=>{
 const detections=[];
 for(let i=0;i<4;i++)detections.push(d("pedestrian_signal",.4,{left:i*.22,top:.05,right:i*.22+.1,bottom:.15}));
 for(let i=0;i<15;i++)detections.push(d(`notice${i}`,.7,box));
 detections.push({...d("bollard",.3),level:"priority"});
 const u={...frame(0,detections),imageSize:{width:640,height:480}};
 const boxes=buildObjectOverlays(null,null,u,{width:640,height:480},0);
 assert.equal(boxes.length,10);assert.equal(boxes[0].label,"bollard");assert.equal(boxes[0].level,"priority");
});


test("disagreeing original and contrast OCR readings do not become a countdown",()=>{
 assert.equal(twice([d("pedestrian_signal")],[t("7"),t("1")]).seconds,null);
 assert.equal(twice([d("pedestrian_signal")],[t("17"),t("7")]).seconds,null);
});
