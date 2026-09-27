import test from "node:test";
import assert from "node:assert/strict";
import { CrossingTracker, CrossingAnnouncementGate, StopScan } from "../crossing.mjs";
const box={left:.25,top:.1,right:.75,bottom:.6};
const frame=(at,seconds=9,label="pedestrian_signal")=>({receivedAt:at,quality:"usable",heading:180,headingAt:at,headingAccuracy:3,
 detections:[{label,score:.4,box}],texts:seconds===null?[]:[{text:String(seconds),box:{left:.5,top:.2,right:.65,bottom:.4}}]});
const read=(mode,seconds)=>{const tracker=new CrossingTracker();tracker.update(frame(0,seconds),mode,0);return tracker.update(frame(600,seconds),mode,600);};
test("under ten countdown requires repeat observation and advises a waiting user to wait",()=>{
 const tracker=new CrossingTracker();assert.equal(tracker.update(frame(0),"waiting",0).status,"confirming");
 const result=tracker.update(frame(600),"waiting",600);assert.equal(result.seconds,9);assert.equal(result.status,"short_countdown");assert.match(result.text,/다음 보행 신호/);assert.equal(result.navigation_safe,false);
});
test("a countdown above ten is not permission to begin",()=>{const result=read("waiting",15);assert.equal(result.status,"dont_start");assert.match(result.text,/새로 건너지/);});
test("crossing and unknown modes never get an unconditional wait-in-the-road instruction",()=>{
 assert.doesNotMatch(read("crossing",9).text,/기다려|되돌아/);assert.match(read("unknown",9).text,/아직 건너기 전이라면/);
});
test("19 to 9 OCR error and numbers outside the selected signal never trigger short countdown",()=>{
 const tracker=new CrossingTracker();tracker.update(frame(0,19),"waiting",0);assert.equal(tracker.update(frame(600,9),"waiting",600).seconds,null);
 const other=new CrossingTracker();const a=frame(0);a.texts[0].box={left:.01,top:.8,right:.1,bottom:.9};other.update(a,"waiting",0);assert.equal(other.update({...a,receivedAt:600},"waiting",600).seconds,null);
});
test("different simultaneous digits are ambiguous, and duplicate frames do not confirm",()=>{
 const tracker=new CrossingTracker(),a=frame(100);
 a.texts.push({...a.texts[0],text:"19"});tracker.update(a,"waiting",100);
 assert.equal(tracker.update({...a,receivedAt:700},"waiting",700).seconds,null);
 const t=new CrossingTracker();t.update(frame(0),"waiting",0);assert.equal(t.update(frame(0),"waiting",100).status,"confirming");
});
test("multiple signals require target selection and disappearance clears the displayed time",()=>{
 const tracker=new CrossingTracker(),a=frame(0);a.detections.push({label:"walk_signal",score:.6,box:{left:.01,top:.1,right:.15,bottom:.5}});
 assert.equal(tracker.update(a,"waiting",0).status,"select_target");tracker.select(box);
 tracker.update(a,"waiting",0);assert.equal(tracker.update({...a,receivedAt:600},"waiting",600).seconds,9);
 assert.equal(tracker.update({...frame(800),detections:[]},"waiting",800).seconds,null);
});
test("WALK is an observation, never safe crossing certification",()=>{const t=new CrossingTracker();t.update(frame(0,null,"walk_signal"),"waiting",0);const r=t.update(frame(600,null,"walk_signal"),"waiting",600);assert.equal(r.status,"walk_observed");assert.equal(r.navigation_safe,false);assert.doesNotMatch(r.text,/건너세요|안전합니다/);});
test("stale, future and unusable input discard signal evidence",()=>{
 for(const [f,now] of [[frame(0),1001],[frame(200),100],[{...frame(0),quality:"retake"},0]])assert.equal(new CrossingTracker().update(f,"waiting",now).status,"unknown");
});
test("countdown boundary is strictly below ten with bounded speech",()=>{
 assert.equal(read("waiting",10).status,"dont_start");assert.equal(read("waiting",0).status,"short_countdown");
 const gate=new CrossingAnnouncementGate();const r=read("waiting",9);assert.ok(gate.offer(r,600));assert.equal(gate.offer({...r,observedAt:1200},1200),null);assert.equal(gate.offer({...r,observedAt:9000},9000),r.text);
});
const scanFrame=(at,heading=180)=>({...frame(at),heading,detections:[{label:"stop sign",score:.8,box},{label:"car",score:.6,box}]});
test("STOP scan needs explicit waiting mode, fresh heading and a STOP observation",()=>{
 const s=new StopScan();assert.equal(s.start(scanFrame(0),"crossing",0).status,"unavailable");
 assert.equal(s.start({...scanFrame(0),heading:undefined},"waiting",0).status,"unavailable");
 assert.equal(s.start({...scanFrame(0),detections:[]},"waiting",0).status,"unavailable");
 assert.equal(s.start(scanFrame(0),"waiting",0).status,"scanning");
});
test("elapsed time or one direction alone cannot complete a scan",()=>{
 const s=new StopScan();s.start(scanFrame(0),"waiting",0);
 for(const at of [200,600,1000,1400])assert.equal(s.update(scanFrame(at,180),"waiting",at).step,0);
 s.update(scanFrame(1800,145),"waiting",1800);assert.equal(s.update(scanFrame(2200,145),"waiting",2200).step,1);
 assert.equal(s.update(scanFrame(2600,145),"waiting",2600).step,1);
});
test("left/right/left confirmed observations complete without a go instruction",()=>{
 const s=new StopScan();s.start(scanFrame(0),"waiting",0);let r;
 for(const [at,yaw] of [[200,145],[600,145],[1000,215],[1400,215],[1800,145],[2200,145]])r=s.update(scanFrame(at,yaw),"waiting",at);
 assert.equal(r.status,"observed");assert.equal(r.observations.length,3);assert.equal(r.navigation_safe,false);assert.doesNotMatch(r.text,/건너세요|안전합니다/);
});
test("scan cancels on stale heading, unavailable quality or crossing mode",()=>{
 for(const [f,mode,now] of [[{...scanFrame(700),headingAt:0},"waiting",700],[{...scanFrame(100),quality:"retake"},"waiting",100],[scanFrame(100),"crossing",100]]){
 const s=new StopScan();s.start(scanFrame(0),"waiting",0);assert.equal(s.update(f,mode,now).status,"unavailable");assert.equal(s.active,false);
 }
});

test("STOP cannot start from a low-quality frame even with an old-looking valid box",()=>{
 assert.equal(new StopScan().start({...scanFrame(100),quality:"retake"},"waiting",100).status,"unavailable");
});
