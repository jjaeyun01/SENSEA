import test from "node:test";
import assert from "node:assert/strict";
import { isNearFieldBox, confirmedNearField, selectNearFieldDetections } from "../near-field.mjs";
import { HazardTracker, HazardAnnouncementGate } from "../hazards.mjs";
import { hasPriorityObstacle } from "../collision-haptics.mjs";
import { AnnouncementGate } from "../detection.mjs";
import { FacilityAttention } from "../facility-attention.mjs";
const close = { left: 0, top: .20, right: 1, bottom: 1 };
const narrow = { left: .47, top: .50, right: .53, bottom: .98 };
const low = { left: .25, top: .91, right: .75, bottom: .99 };
const far = { left: .43, top: .40, right: .57, bottom: .60 };
const frame = (at, score, box=close, label="chair") => ({ receivedAt:at,
 quality:{status:"usable",reason:null}, detections:[{label,score,box}] });

test("large clipped, low and narrow central objects have distinct near-image coverage",()=>{
 for(const b of [close,narrow,low,{left:0,top:.05,right:1,bottom:.7}]) assert.equal(isNearFieldBox(b),true);
 for(const b of [far,{left:.01,top:.4,right:.15,bottom:1},{...close,left:NaN},{...close,right:1.1}]) assert.equal(isNearFieldBox(b),false);
});

test("weak detections are retained only near the centre and never become ordinary automatic speech",()=>{
 const candidates=[{label:"chair",score:.50,box:close},{label:"car",score:.50,box:far},{label:"bench",score:.60,box:far}];
 const original=structuredClone(candidates), selected=selectNearFieldDetections(candidates);
 assert.deepEqual(selected.map(d=>d.label),["chair","bench"]);
 assert.equal(selected[0].nearCandidate,true);assert.equal(selected[0].score,.50);
 assert.deepEqual(candidates,original);
 const gate=new AnnouncementGate(), value={...frame(0,.5),detections:[selected[0]]};
 assert.equal(gate.offer(value,0),null);assert.equal(gate.offer(value,200),null);
 assert.equal(selectNearFieldDetections(Array(10000).fill(candidates[0])).length,25);
});

for(const [name,box,label] of [["clipped furniture",close,"chair"],["narrow lower pole",narrow,"fire hydrant"],["low floor blocker",low,"suitcase"]]) {
 test(name+" is confirmed in two strong frames while a single frame stays quiet",()=>{
  const tracker=new HazardTracker();
  assert.equal(hasPriorityObstacle(tracker.update(frame(0,.76,box,label),0).hazards),false);
  const result=tracker.update(frame(200,.76,box,label),200);
  assert.equal(result.status,"priority");assert.equal(result.hazards[0].screenRelation,"direct");
  assert.equal(result.hazards[0].distanceMeters,null);
  assert.ok(result.hazards[0].reasons.includes("confirmed_near_obstruction"));
  assert.equal(hasPriorityObstacle(result.hazards),true);
 });
}

test("moderate close detections need three consistent frames, with people still silent",()=>{
 const tracker=new HazardTracker(),gate=new HazardAnnouncementGate();
 for(const [i,score] of [.60,.64,.65].entries()) {
  const r=tracker.update(frame(i*200,score,close,"person"),i*200);
  assert.equal(hasPriorityObstacle(r.hazards),i===2);
  assert.equal(gate.offer(r,i*200),null);
 }
});

test("low confidence, side objects, missed frames and camera motion cannot shortcut near confirmation",()=>{
 for(const [score,box] of [[.54,close],[.60,far],[.90,{left:0,top:.2,right:.2,bottom:1}]]) {
  const tracker=new HazardTracker();for(const at of [0,200,400,600])assert.equal(hasPriorityObstacle(tracker.update(frame(at,score,box),at).hazards),false);
 }
 const tracker=new HazardTracker();tracker.update(frame(0,.76),0);tracker.update({...frame(200,.76),detections:[]},200);
 assert.equal(hasPriorityObstacle(tracker.update(frame(400,.76),400).hazards),false);
 const history=[0,200,400].map(at=>({at,score:.9,box:close,overlap:1,sceneMotion:at===400}));
 assert.equal(confirmedNearField(history),null);
});

test("the facility model uses its own score scale and keeps history bounded",()=>{
 const tracker=new FacilityAttention();let result;
 for(const at of [0,600,1200]) {
  result=tracker.update({receivedAt:at,quality:"usable",detections:[{label:"bollard",score:.31,box:narrow}]},at);
  assert.equal(hasPriorityObstacle(result),at===1200);
 }
 assert.equal(result[0].score,.31);
 for(let at=1800;at<30000;at+=600)tracker.update({receivedAt:at,quality:"usable",detections:[{label:"bollard",score:.31,box:narrow}]},at);
 assert.ok(tracker.tracks.every(t=>t.history.length<=4));
});


test("three moderate near observations can confirm at a slower cadence without retaining images",()=>{
 const tracker=new HazardTracker();let value;
 for(const [i,score] of [.60,.64,.65].entries())value=tracker.update(frame(i*700,score),i*700);
 assert.equal(value.status,"priority");assert.equal(tracker.getDiagnostics().maxHistory,3);
 assert.equal(tracker.update(frame(2600,.65),2600).status,"observing","a gap over one second restarts evidence");
});
