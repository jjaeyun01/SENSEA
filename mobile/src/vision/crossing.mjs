/** Short-lived observations, never a grant to cross. All positions are image-space. */
export const CROSSING_LIMITS = Object.freeze({ ttl: 1000, history: 5, detections: 24, texts: 16 });
const signals = new Set(["pedestrian_signal", "walk_signal", "dont_walk_signal"]);
const vehicles = new Set(["car", "truck", "bus", "motorcycle", "bicycle", "e_scooter"]);
const fresh = (at, now, ttl = 1000) => Number.isFinite(at) && at <= now && now - at <= ttl;
export function validBox(b) {
  return !!b && [b.left,b.top,b.right,b.bottom].every(Number.isFinite) && b.left >= 0 && b.top >= 0 &&
    b.right <= 1 && b.bottom <= 1 && b.right > b.left && b.bottom > b.top;
}
export function boxOverlap(a, b) {
  if (!validBox(a) || !validBox(b)) return 0;
  const intersection = Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) * Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  const area = x => (x.right-x.left)*(x.bottom-x.top);
  return intersection / (area(a)+area(b)-intersection || 1);
}
const unknown = () => ({ status: "unknown", text: "보행 신호를 확인하지 못했습니다.", seconds: null, target: null, navigation_safe: false });
function inside(b, region) {
  const x=(b.left+b.right)/2,y=(b.top+b.bottom)/2;
  return x>=region.left && x<=region.right && y>=region.top && y<=region.bottom;
}
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
    const candidates=(frame.detections??[]).slice(0,24).filter(d=>signals.has(d.label) && validBox(d.box) && Number.isFinite(d.score) && d.score>=0.16 && d.score<=1);
    // Same head can have a generic and a symbol-specific proposal. Keep strongest per head.
    const heads=[];
    for(const d of candidates.sort((a,b)=>b.score-a.score)) if(!heads.some(h=>boxOverlap(h.box,d.box)>.35)) heads.push(d);
    let head;
    if(this.selected) head=heads.filter(d=>boxOverlap(d.box,this.selected)>=.35).sort((a,b)=>boxOverlap(b.box,this.selected)-boxOverlap(a.box,this.selected))[0];
    else if(heads.length===1) head=heads[0];
    if(!head) {
      this.history=[]; this.value={...unknown(),status:heads.length>1?"select_target":"unknown",text:heads.length>1?"여러 보행 신호가 보입니다. 확인할 신호를 선택해 주세요.":"보행 신호를 확인하지 못했습니다."};
      return structuredValue(this.value);
    }
    if(this.history.length && (frame.receivedAt-this.history.at(-1).at>1800 || boxOverlap(head.box,this.history.at(-1).box)<.35)) this.history=[];
    if(this.selected) this.selected={...head.box};
    const textCandidates=(frame.texts??[]).slice(0,16).filter(t=>validBox(t.box) && inside(t.box,head.box) && typeof t.text==="string");
    const numbers=textCandidates.filter(t=>/^\d{1,2}$/.test(t.text.trim())).map(t=>Number(t.text.trim()));
    const unique=[...new Set(numbers)];
    const seconds=unique.length===1 && unique[0]>=0 && unique[0]<=99?unique[0]:null;
    const words=textCandidates.map(t=>t.text.toUpperCase().replace(/[^A-Z]/g,"")).join("");
    // Symbol detections remain model observations. Never turn the WALK observation into permission.
    const symbol=words.includes("DONTWALK")||words.includes("DONOTWALK")?"hand":words==="WALK"?"walk":
      head.label==="dont_walk_signal"?"hand":head.label==="walk_signal"?"walk":"unknown";
    this.history.push({at:frame.receivedAt,box:{...head.box},seconds,symbol});
    this.history=this.history.slice(-5);
    const last=this.history.at(-1), prior=this.history.at(-2);
    const stable=!!prior && last.at-prior.at>=180;
    const numberStable=stable && seconds!==null && prior.seconds!==null &&
      prior.seconds-seconds>=0 && prior.seconds-seconds<=Math.ceil((last.at-prior.at)/1000)+1;
    const symbolStable=stable && symbol!=="unknown" && prior.symbol===symbol;
    let status="confirming",text="보행 신호를 반복 확인 중입니다.";
    if(numberStable || (symbolStable && symbol==="hand")) {
      status=numberStable && seconds<10?"short_countdown":"dont_start";
      const reading=numberStable?`보행 신호 숫자 ${seconds}초가 보입니다. `:"보행 정지 표시가 보입니다. ";
      text=mode==="crossing"?reading+"횡단 중 안내입니다. 주변 차량에 주의하세요.":
        mode==="waiting"?reading+"새로 건너지 말고 다음 보행 신호를 기다려 주세요.":
        reading+"아직 건너기 전이라면 다음 보행 신호를 기다려 주세요.";
    } else if(symbolStable && symbol==="walk") {
      status="walk_observed"; text="보행자 표시가 보입니다. 회전 차량과 주변 상황을 확인해 주세요.";
    }
    this.value={status,text,seconds:numberStable?seconds:null,target:{...head.box},observedAt:frame.receivedAt,navigation_safe:false};
    return structuredValue(this.value);
  }
}
function structuredValue(v) { return {...v,target:v.target?{...v.target}:null}; }
const angle = (value, base) => ((value-base+540)%360)-180;
export class StopScan {
  constructor() { this.reset(); }
  reset() { this.active=false;this.step=0;this.base=null;this.samples=0;this.firstAt=0;this.lastAt=-Infinity;this.startedAt=0;this.observations=[]; }
  start(frame, mode, now=Date.now()) {
    this.reset();
    if(mode!=="waiting") return {status:"unavailable",text:"도로에 들어가기 전 대기 상태에서 스캔을 시작해 주세요.",navigation_safe:false};
    if(!frame || frame.quality!=="usable" || !fresh(frame.receivedAt,now) || !fresh(frame.headingAt,now,500) || !Number.isFinite(frame.heading) || !(frame.headingAccuracy>=1))
      return {status:"unavailable",text:"휴대폰 방향을 확인할 수 없습니다.",navigation_safe:false};
    if(!(frame.detections??[]).slice(0,24).some(d=>d.label==="stop sign" && d.score>=.25 && validBox(d.box)))
      return {status:"unavailable",text:"최신 영상에서 STOP 표지를 확인하지 못했습니다.",navigation_safe:false};
    this.active=true;this.base=frame.heading;this.startedAt=now;
    return this.describe();
  }
  describe() {
    return {status:this.active?"scanning":this.step===3?"observed":"idle",step:this.step,
      text:this.active?["제자리에서 카메라를 왼쪽으로 돌려 주세요.","이번에는 카메라를 오른쪽으로 돌려 주세요.","왼쪽을 다시 확인해 주세요."][this.step]:
        this.step===3?"좌우 관찰을 마쳤습니다. 보이지 않는 차량이나 재출발 차량이 있을 수 있습니다. 횡단 가능 여부는 확인하지 못했습니다.":"STOP 표지에서 주변 스캔을 시작할 수 있습니다.",
      observations:this.observations.map(o=>({...o})),navigation_safe:false};
  }
  update(frame,mode,now=Date.now()) {
    if(!this.active) return this.describe();
    if(mode!=="waiting" || !frame || !fresh(frame.receivedAt,now) || !fresh(frame.headingAt,now,500) || frame.quality!=="usable" ||
      !Number.isFinite(frame.heading) || !(frame.headingAccuracy>=1) || now-this.startedAt>20000) {
      this.reset();return {status:"unavailable",text:"관찰이 끊겨 스캔을 중지했습니다. 제자리에서 다시 시작해 주세요.",navigation_safe:false};
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
      text:seen.length?`화면에 차량·자전거 후보 ${seen.length}개가 보입니다.`:"화면에서 차량을 식별하지 못했습니다. 차량이 없다는 뜻은 아닙니다."});
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
