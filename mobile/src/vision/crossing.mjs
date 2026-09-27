import { validBox, boxOverlap, groupSignalHeads, followsSignal, readSignalEvidence } from "./signal-observations.mjs";
export { validBox, boxOverlap } from "./signal-observations.mjs";
/** Short-lived observations, never a grant to cross. All positions are image-space. */
export const CROSSING_LIMITS = Object.freeze({ ttl: 1000, history: 5, detections: 24, texts: 16 });
const vehicles = new Set(["car", "truck", "bus", "motorcycle", "bicycle", "e_scooter"]);
const fresh = (at, now, ttl = 1000) => Number.isFinite(at) && at <= now && now - at <= ttl;
const unknown = () => ({ status: "unknown", text: "Pedestrian signal not identified.", seconds: null, target: null, navigation_safe: false });
export class CrossingTracker {
  constructor() { this.reset(); }
  reset() { this.history=[]; this.selected=null; this.lastAt=-Infinity; this.lastNow=-Infinity; this.value=unknown(); }
  select(box) { this.reset(); if (validBox(box)) this.selected={...box}; }
  update(frame, mode="unknown", now=Date.now()) {
    if (!frame || !fresh(frame.receivedAt,now) || now < this.lastNow || frame.quality !== "usable") {
      this.reset(); return unknown();
    }
    this.lastNow=now;
    if (frame.receivedAt<=this.lastAt) return structuredValue(this.value);
    this.lastAt=frame.receivedAt;
    const heads=groupSignalHeads(frame.detections??[]);
    const matches=this.selected?heads.filter(h=>followsSignal(h.box,this.selected)):heads;
    const head=matches.length===1?matches[0]:null;
    if(!head) {
      this.history=[]; this.value={...unknown(),status:heads.length>1?"select_target":"unknown",
        text:heads.length>1?"Multiple pedestrian signals detected. Aim at the signal for your crossing and keep it near the center.":"Pedestrian signal not identified. Keep the signal centered and hold the camera steady.",
        observedAt:heads.length?frame.receivedAt:undefined,candidates:heads.map(h=>({...h.box}))};
      return structuredValue(this.value);
    }
    if(this.history.length && (frame.receivedAt-this.history.at(-1).at>1800 || !followsSignal(head.box,this.history.at(-1).box))) this.history=[];
    if(this.selected) this.selected={...head.box};
    const {seconds,symbol,conflict}=readSignalEvidence(head,heads,frame.texts??[]);
    this.history.push({at:frame.receivedAt,box:{...head.box},seconds,symbol});
    this.history=this.history.slice(-5);
    const last=this.history.at(-1), prior=this.history.at(-2);
    const stable=!!prior && last.at-prior.at>=180;
    const numberStable=stable && seconds!==null && prior.seconds!==null &&
      prior.seconds-seconds>=0 && prior.seconds-seconds<=Math.ceil((last.at-prior.at)/1000)+1;
    const symbolStable=stable && symbol!=="unknown" && prior.symbol===symbol;
    let status="confirming",text=conflict?"Signal symbols are unclear. Keep checking the pedestrian signal.":"Pedestrian signal detected. Checking its symbol and countdown.";
    if(numberStable || (symbolStable && symbol==="hand")) {
      status=numberStable && seconds<10?"short_countdown":"dont_start";
      const reading=numberStable?`The signal shows ${seconds} ${seconds === 1 ? "second" : "seconds"}. `:"A DON'T WALK symbol is visible. ";
      text=mode==="crossing"?reading+"You selected Crossing. Watch for nearby traffic.":
        mode==="waiting"?reading+"Do not start crossing. Wait for the next WALK signal.":
        reading+"If you have not started crossing, wait for the next WALK signal.";
    } else if(symbolStable && symbol==="walk") {
      status="walk_observed"; text="A WALK symbol is visible. Check for turning vehicles and your surroundings.";
    }
    this.value={status,text,seconds:numberStable?seconds:null,target:{...head.box},observedAt:frame.receivedAt,navigation_safe:false,candidates:heads.map(h=>({...h.box}))};
    return structuredValue(this.value);
  }
}
function structuredValue(v) { return {...v,target:v.target?{...v.target}:null,candidates:(v.candidates??[]).map(b=>({...b}))}; }
const angle = (value, base) => ((value-base+540)%360)-180;
export class StopScan {
  constructor() { this.reset(); }
  reset() { this.active=false;this.step=0;this.base=null;this.samples=0;this.firstAt=0;this.lastAt=-Infinity;this.startedAt=0;this.observations=[]; }
  start(frame, mode, now=Date.now()) {
    this.reset();
    if(mode!=="waiting") return {status:"unavailable",text:"Select Waiting on sidewalk and start the scan before entering the road.",navigation_safe:false};
    if(!frame || frame.quality!=="usable" || !fresh(frame.receivedAt,now) || !fresh(frame.headingAt,now,500) || !Number.isFinite(frame.heading) || !(frame.headingAccuracy>=1))
      return {status:"unavailable",text:"Phone orientation is unavailable.",navigation_safe:false};
    if(!(frame.detections??[]).slice(0,24).some(d=>d.label==="stop sign" && d.score>=.25 && validBox(d.box)))
      return {status:"unavailable",text:"No STOP sign identified in the latest frame.",navigation_safe:false};
    this.active=true;this.base=frame.heading;this.startedAt=now;
    return this.describe();
  }
  describe() {
    return {status:this.active?"scanning":this.step===3?"observed":"idle",step:this.step,
      text:this.active?["Stay in place and turn the camera to the left.","Now turn the camera to the right.","Check the left again."][this.step]:
        this.step===3?"Left-right-left scan complete. Unseen vehicles or stopped vehicles may move. Crossing clearance has not been established.":"You can start a surroundings scan at a STOP sign.",
      observations:this.observations.map(o=>({...o})),navigation_safe:false};
  }
  update(frame,mode,now=Date.now()) {
    if(!this.active) return this.describe();
    if(mode!=="waiting" || !frame || !fresh(frame.receivedAt,now) || !fresh(frame.headingAt,now,500) || frame.quality!=="usable" ||
      !Number.isFinite(frame.heading) || !(frame.headingAccuracy>=1) || now-this.startedAt>20000) {
      this.reset();return {status:"unavailable",text:"Scan stopped because observations were interrupted. Stay in place and restart.",navigation_safe:false};
    }
    if(frame.receivedAt<=this.lastAt) return this.describe();
    this.lastAt=frame.receivedAt;
    const delta=angle(frame.heading,this.base),inDirection=this.step===1?delta>=25&&delta<=100:delta<=-25&&delta>=-100;
    if(!inDirection){this.samples=0;this.firstAt=0;return this.describe();}
    if(!this.samples) this.firstAt=frame.receivedAt;
    this.samples++;
    if(this.samples<2 || frame.receivedAt-this.firstAt<200) return this.describe();
    const seen=(frame.detections??[]).slice(0,24).filter(d=>vehicles.has(d.label)&&d.score>=.2&&validBox(d.box));
    this.observations.push({direction:this.step===1?"right":"left",at:frame.receivedAt,vehicles:seen.length,
      text:seen.length?`Possible vehicles or bicycles in the image: ${seen.length}.`:"No vehicles identified in the image. Vehicles may still be present."});
    this.step++;this.samples=0;this.firstAt=0;
    if(this.step===3) this.active=false;
    return this.describe();
  }
}
/** Bounded change announcements; a repeated state cannot flood TTS or vibration. */
export class CrossingAnnouncementGate {
  constructor(){this.reset();}
  reset(){this.key="";this.at=-Infinity;}
  offer(value,now=Date.now()){
    if(!value || !fresh(value.observedAt,now) || !["short_countdown","dont_start","walk_observed"].includes(value.status))return null;
    const key=value.status;
    if(key===this.key&&now-this.at<8000 || now-this.at<1500)return null;
    this.key=key;this.at=now;return value.text;
  }
}
