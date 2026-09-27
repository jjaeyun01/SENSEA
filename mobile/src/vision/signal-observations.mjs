/** Image-space signal evidence. A traffic-light box alone never identifies WALK. */
export function validBox(b) {
  return !!b && [b.left,b.top,b.right,b.bottom].every(Number.isFinite) && b.left >= 0 && b.top >= 0 &&
    b.right <= 1 && b.bottom <= 1 && b.right > b.left && b.bottom > b.top;
}
const area = b => (b.right-b.left)*(b.bottom-b.top);
const intersection = (a,b) => Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
  Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
export function boxOverlap(a,b) {
  if (!validBox(a) || !validBox(b)) return 0;
  const n=intersection(a,b); return n/(area(a)+area(b)-n || 1);
}
export function sameSignalHead(a,b) {
  if (!validBox(a) || !validBox(b)) return false;
  if (boxOverlap(a,b)>=.35) return true;
  const large=area(a)>=area(b)?a:b, small=large===a?b:a;
  // Merge a centered symbol with its housing, not adjacent signals or a huge scene box.
  return area(small)/area(large)>=.06 && intersection(a,b)/area(small)>=.85 &&
    Math.abs((a.left+a.right-b.left-b.right)/2)<=(large.right-large.left)*.22 &&
    Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<=(large.bottom-large.top)*.22;
}
export function followsSignal(a,b) {
  if (!validBox(a) || !validBox(b)) return false;
  if (boxOverlap(a,b)>=.25) return true;
  const aw=a.right-a.left, ah=a.bottom-a.top, bw=b.right-b.left, bh=b.bottom-b.top;
  return aw/bw>=.65 && aw/bw<=1.55 && ah/bh>=.65 && ah/bh<=1.55 &&
    Math.abs((a.left+a.right-b.left-b.right)/2)<=Math.min(aw,bw)*.4 &&
    Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<=Math.min(ah,bh)*.4;
}
const signals=new Set(["pedestrian_signal","walk_signal","dont_walk_signal"]);
export function groupSignalHeads(detections=[]) {
  const candidates=detections.slice(0,24).filter(d=>signals.has(d?.label) && validBox(d.box) &&
    Number.isFinite(d.score) && d.score>=.16 && d.score<=1);
  candidates.sort((a,b)=>(b.label==="pedestrian_signal")-(a.label==="pedestrian_signal") || b.score-a.score);
  const heads=[];
  for (const d of candidates) {
    const matches=heads.filter(h=>sameSignalHead(h.box,d.box));
    if (matches.length>1) continue; // A broad proposal cannot merge distinct heads.
    if (!matches.length) heads.push({box:{...d.box},score:d.score,members:[d]});
    else { matches[0].members.push(d); matches[0].score=Math.max(matches[0].score,d.score); }
  }
  return heads;
}
function textRegion(b) {
  const x=Math.min(.02,(b.right-b.left)*.18), y=Math.min(.02,(b.bottom-b.top)*.12);
  return {left:Math.max(0,b.left-x),top:Math.max(0,b.top-y),right:Math.min(1,b.right+x),bottom:Math.min(1,b.bottom+y)};
}
function belongsTo(t,head,heads) {
  if (!validBox(t?.box) || typeof t.text!=="string" || t.text.length>32) return false;
  if (t.signalBox && (!validBox(t.signalBox) || !sameSignalHead(t.signalBox,head.box))) return false;
  const matches=heads.filter(h=>intersection(t.box,textRegion(h.box))/area(t.box)>=.8);
  return matches.length===1 && matches[0]===head;
}
/** Join only adjacent, aligned digit fragments. Conflicting rows/numbers remain unknown. */
export function readSignalEvidence(head,heads,texts=[]) {
  const kept=[];
  for (const t of texts.slice(0,16)) {
    if (!belongsTo(t,head,heads)) continue;
    const text=t.text.trim().toUpperCase().replace(/[’']/g, "");
    if (!/^(?:[0-9]{1,2}|WALK|DONT(?:\s+WALK)?|DO(?:\s+NOT(?:\s+WALK)?)?|NOT)$/.test(text)) continue;
    if (kept.some(k=>k.text===text && boxOverlap(k.box,t.box)>.6)) continue;
    kept.push({text,box:t.box});
  }
  const digits=kept.filter(t=>/^\d{1,2}$/.test(t.text)).sort((a,b)=>a.box.left-b.box.left);
  let seconds=digits.length===1?Number(digits[0].text):null;
  if (digits.length===2 && digits.every(d=>d.text.length===1)) {
    const [a,b]=digits, ah=a.box.bottom-a.box.top, bh=b.box.bottom-b.box.top;
    const gap=b.box.left-a.box.right;
    if (ah/bh>=.65 && ah/bh<=1.55 && gap>=0 && gap<=Math.max(ah,bh)*.7 &&
        Math.abs((a.box.top+a.box.bottom-b.box.top-b.box.bottom)/2)<=Math.min(ah,bh)*.3)
      seconds=Number(a.text+b.text);
  }
  const words=kept.filter(t=>!/^\d/.test(t.text)).flatMap(t=>t.text.split(/\s+/));
  const hasWalk=words.includes("WALK"), hasDont=words.includes("DONT") || (words.includes("DO")&&words.includes("NOT"));
  const fromText=hasWalk?(hasDont?"hand":"walk"):"unknown";
  const score=label=>Math.max(0,...head.members.filter(d=>d.label===label).map(d=>d.score));
  const walk=score("walk_signal"), hand=score("dont_walk_signal");
  const conflicting=walk>=.16 && hand>=.16 && (Math.abs(walk-hand)<.07 || Math.max(walk,hand)<Math.min(walk,hand)*1.25);
  const fromModel=conflicting?"unknown":hand>=.22&&hand>walk?"hand":walk>=.24&&walk>hand?"walk":"unknown";
  // Contradictory symbol evidence must not turn into a WALK announcement.
  const conflict=conflicting || (fromText!=="unknown"&&fromModel!=="unknown"&&fromText!==fromModel);
  const symbol=conflict?"unknown":fromText!=="unknown"?fromText:fromModel;
  return {seconds,symbol,conflict};
}
