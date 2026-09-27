import { validBox } from "./signal-observations.mjs";
const signals=new Set(["pedestrian_signal","walk_signal","dont_walk_signal"]);
const confirmed=new Set(["short_countdown","dont_start","walk_observed"]);
const fresh=(at,now)=>Number.isFinite(at)&&Number.isFinite(now)&&at<=now&&now-at<=1000;
const lights=base=>(base?.detections??[]).slice(0,25).filter(d=>d.label==="traffic light"&&d.score>=.55&&d.score<=1&&validBox(d.box));
export function hasSignalInView(base,urban,now) {
  return !!((fresh(base?.receivedAt,now)&&base?.quality?.status==="usable"&&lights(base).length) ||
    (fresh(urban?.receivedAt,now)&&urban?.quality==="usable"&&(urban.detections??[]).slice(0,24).some(d=>signals.has(d.label)&&d.score>=.16&&d.score<=1&&validBox(d.box))));
}
/** Hands-free camera aiming feedback, not a route decision or a WALK classifier. */
export class SignalSearchGate {
  constructor(){this.reset();}
  reset(){this.candidate="";this.firstAt=0;this.lastAt=-Infinity;this.samples=0;this.lastSeen=-Infinity;this.confirmedUntil=-Infinity;this.spoken="";this.spokenAt=-Infinity;this.lost=false;this.lastNow=-Infinity;}
  retry(){this.spoken="";this.spokenAt=-Infinity;}
  offer(signal,base,now=Date.now()) {
    if(!Number.isFinite(now)||now<this.lastNow){this.reset();return null;}
    this.lastNow=now;
    const current=fresh(signal?.observedAt,now);
    if(current&&confirmed.has(signal.status)) {
      this.lastSeen=signal.observedAt;this.confirmedUntil=now+3000;this.candidate="";this.samples=0;this.lost=false;return null;
    }
    let key="",text="",at=now;
    if(current&&(validBox(signal.target)||(signal.candidates??[]).some(validBox))) {
      at=signal.observedAt;
      if(signal.status==="select_target") {
        key="multiple";text="More than one pedestrian signal is visible. Aim at the signal for your crossing and keep it near the center. Its state is not confirmed.";
      } else {
        key="checking";text="Pedestrian signal detected. Keep it centered and hold the camera steady while I check the symbol and countdown.";
      }
    } else if(fresh(base?.receivedAt,now)&&base?.quality?.status==="usable") {
      const found=lights(base);
      if(found.length){
        at=base.receivedAt;key="traffic";
        const center=found.length===1?(found[0].box.left+found[0].box.right)/2:null;
        const direction=center===null?"":center<.33?" on the left":center>.67?" on the right":" ahead";
        text=`Traffic light detected${direction}. Aim at the pedestrian signal for your crossing. Its walking signal is not yet identified.`;
      }
    }
    if(key) {
      this.lastSeen=Math.max(this.lastSeen,at);this.lost=false;
      if(key!==this.candidate||at-this.lastAt>1800){this.candidate=key;this.firstAt=at;this.samples=0;this.lastAt=-Infinity;}
      if(at>this.lastAt){this.samples++;this.lastAt=at;}
      if(this.samples<2||at-this.firstAt<180||now<this.confirmedUntil)return null;
    } else {
      this.candidate="";this.samples=0;
      // Only report loss after a previously seen signal; silence in ordinary scenes.
      if(this.lastSeen===-Infinity||now-this.lastSeen<4000||this.lost)return null;
      key="lost";text="The signal is no longer in view or cannot be read. Aim at the pedestrian signal again. Do not rely on the previous reading.";
    }
    if(now-this.spokenAt<3000 || (key===this.spoken&&now-this.spokenAt<15000))return null;
    this.spoken=key;this.spokenAt=now;if(key==="lost")this.lost=true;
    return {text,observedAt:at,status:key};
  }
}
