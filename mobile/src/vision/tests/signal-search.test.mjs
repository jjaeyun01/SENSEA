import test from "node:test";
import assert from "node:assert/strict";
import { SignalSearchGate, hasSignalInView } from "../signal-search.mjs";
import { CrossingTracker, CrossingAnnouncementGate } from "../crossing.mjs";
const box={left:.1,top:.1,right:.2,bottom:.3};
const base=at=>({receivedAt:at,quality:{status:"usable"},detections:[{label:"traffic light",score:.8,box}]});
const signal=(at,status="confirming")=>({observedAt:at,status,target:box});
test("hands-free feedback needs repeated fresh traffic-light observations and never says WALK",()=>{
 const g=new SignalSearchGate();assert.equal(g.offer(null,base(0),0),null);
 const result=g.offer(null,base(300),300);assert.match(result.text,/on the left/);assert.match(result.text,/not yet identified/);assert.equal(result.status,"traffic");
 assert.equal(g.offer(null,base(300),300),null);assert.equal(g.offer(null,base(600),600),null);
});
test("pedestrian checking and multiple-signal feedback require no selection taps",()=>{
 for(const status of ["confirming","select_target"]){
  const g=new SignalSearchGate();g.offer(signal(0,status),null,0);
  const result=g.offer(signal(600,status),null,600);
  assert.match(result.text,/center/);assert.doesNotMatch(result.text,/tap|press|select/i);
 }
});
test("confirmed readings mute transient checking feedback",()=>{
 const g=new SignalSearchGate();assert.equal(g.offer(signal(0,"short_countdown"),null,0),null);
 g.offer(signal(600),null,600);assert.equal(g.offer(signal(1200),null,1200),null);
 assert.equal(g.offer(signal(3000),null,3000)?.status,"checking");
});
test("signal loss is announced once, after four seconds, and is silent before seeing a signal",()=>{
 const g=new SignalSearchGate();assert.equal(g.offer(null,null,0),null);
 g.offer(signal(0,"walk_observed"),null,0);assert.equal(g.offer(null,null,3999),null);
 assert.equal(g.offer(null,null,4000)?.status,"lost");assert.equal(g.offer(null,null,25000),null);
});
test("stale and future signal cues are rejected; duplicates cannot create confirmation",()=>{
 const g=new SignalSearchGate();assert.equal(g.offer(signal(2000),base(2000),1000),null);
 assert.equal(g.offer(signal(0),base(0),1001),null);
 g.offer(null,base(1200),1200);assert.equal(g.offer(null,base(1200),1600),null);
});
test("search feedback is bounded and reset after stop or voice disable",()=>{
 const g=new SignalSearchGate();g.offer(signal(0),null,0);assert.ok(g.offer(signal(600),null,600));
 for(let at=1200;at<15000;at+=600)assert.equal(g.offer(signal(at),null,at),null);
 assert.ok(g.offer(signal(15600),null,15600));g.reset();assert.equal(g.offer(null,null,20000),null);
});
test("signal context suppresses generic speech only while actual signal cues are fresh",()=>{
 assert.equal(hasSignalInView(base(0),null,600),true);assert.equal(hasSignalInView(base(0),null,1001),false);
 const u={receivedAt:0,quality:"usable",detections:[{label:"pedestrian_signal",score:.2,box}]};
 assert.equal(hasSignalInView(null,u,600),true);assert.equal(hasSignalInView(null,{...u,quality:"retake"},600),false);
 assert.equal(hasSignalInView(null,{...u,detections:[{label:"person",score:.9,box}]},600),false);
});
test("default automatic situation speaks the short countdown without claiming sidewalk or road location",()=>{
 const tracker=new CrossingTracker(),gate=new CrossingAnnouncementGate();
 const f=at=>({receivedAt:at,quality:"usable",detections:[{label:"pedestrian_signal",score:.4,box}],texts:[{text:"7",box:{left:.13,top:.15,right:.17,bottom:.25}}]});
 tracker.update(f(0),undefined,0);const result=tracker.update(f(600),undefined,600);
 const spoken=gate.offer(result,600);assert.match(spoken,/7 seconds/);assert.match(spoken,/If you have not started crossing, wait for the next WALK signal/);assert.equal(result.navigation_safe,false);
});
