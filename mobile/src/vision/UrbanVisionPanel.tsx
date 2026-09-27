import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { startUrbanAnalysis, updateSignalHints } from "./urban-native";
import { CrossingTracker, CrossingAnnouncementGate, StopScan, boxOverlap } from "./crossing.mjs";
import { FacilityAttention } from "./facility-attention.mjs";
import { SignalSearchGate } from "./signal-search.mjs";
import { signalFocusHints } from "./signal-hints.mjs";
import type { Detection, LiveResult, UrbanResult } from "./types";
import vocabulary from "../../assets/models/urban-labels.json";
const name=(label:string)=>vocabulary.find(x=>x.label===label)?.name??label;
type Mode="unknown"|"waiting"|"crossing";
type Observation={status:string;text:string;seconds?:number|null;observedAt?:number;target?:Detection["box"]|null;candidates?:Detection["box"][]};
type Props={live:boolean;enabled:boolean;voice:boolean;baseResult:LiveResult|null;onResult:(value:UrbanResult|null)=>void;
 say:(text:string,at:number,manual?:boolean,priority?:boolean,onDropped?:()=>void)=>boolean;
 canAnnounce:()=>boolean;cancel:()=>void};
export function UrbanVisionPanel({live,enabled,voice,baseResult,onResult,say,canAnnounce,cancel}:Props){
 const [mode,setMode]=useState<Mode>("unknown"),modeRef=useRef<Mode>("unknown");
 const [status,setStatus]=useState("Turn on the camera to prepare expanded analysis.");
 const [frame,setFrame]=useState<UrbanResult|null>(null),latest=useRef<UrbanResult|null>(null);
 const [signal,setSignal]=useState<Observation>({status:"unknown",text:"Pedestrian signal not identified."});
 const [scan,setScan]=useState<Observation>({status:"idle",text:"You can start a left-right-left scan at a STOP sign."});
 const [facilityText,setFacilityText]=useState("");
 const crossing=useRef(new CrossingTracker()),gate=useRef(new CrossingAnnouncementGate()),scanner=useRef(new StopScan()),facilities=useRef(new FacilityAttention());
 const voiceRef=useRef(voice);voiceRef.current=voice;
 const callbacks=useRef({onResult,say,canAnnounce,cancel});callbacks.current={onResult,say,canAnnounce,cancel};
 const searchGate=useRef(new SignalSearchGate());
 const lastFacility=useRef({key:"",at:-Infinity});
 const lastScanStep=useRef(-1);
 useEffect(()=>{
  latest.current=null;setFrame(null);callbacks.current.onResult(null);
  crossing.current.reset();gate.current.reset();searchGate.current.reset();scanner.current.reset();facilities.current.reset();lastFacility.current={key:"",at:-Infinity};
  setSignal({status:"unknown",text:"Pedestrian signal not identified."});
  setScan({status:"idle",text:"You can start a left-right-left scan at a STOP sign."});setFacilityText("");
  if(!live){setStatus("Turn on the camera to prepare expanded analysis.");return;}
  if(!enabled){setStatus("Expanded analysis is waiting while basic hazard detection takes priority.");return;}
  setStatus("Preparing street object and signal analysis");
  let active=true;
  const stop=startUrbanAnalysis(next=>{
   if(!active||Date.now()-next.receivedAt>1000||next.receivedAt>Date.now())return;
   if(latest.current&&next.receivedAt<=latest.current.receivedAt)return;
   latest.current=next;setFrame(next);setStatus(next.quality==="usable"?"Analyzing street objects and signals":"Expanded analysis paused: the image is dark or obscured.");
   const observation=crossing.current.update(next,modeRef.current,Date.now());setSignal(observation);
   const scanValue=scanner.current.update(next,modeRef.current,Date.now());setScan(scanValue);
   const attention=facilities.current.update(next,Date.now()),target=attention.find(x=>x.level!=="notice");
   const details=attention.map(x=>`Possible ${name(x.label)} · ${x.level==="priority"?"High alert":x.level==="caution"?"Caution":"Notice"}`).join(" · ");setFacilityText(details);
   callbacks.current.onResult({...next,detections:next.detections.map(d=>{
    const match=attention.find(a=>a.label===d.label && boxOverlap(a.box,d.box)>.45);
    return match?{...d,level:match.level}:d;
   })});
   if(!voiceRef.current||!callbacks.current.canAnnounce())return;
   let text:string|null=null,important=false,signalAnnouncement=false,scanStep:number|null=null;
   if(target){
    const key=`${target.id}/${target.level}`;
    if(key!==lastFacility.current.key||Date.now()-lastFacility.current.at>=8000){
     text=`${target.level==="priority"?"High alert":"Caution"}. Possible ${name(target.label)} in the ${target.relation==="direct"?"lower center":"surrounding area"} of the image.`;important=true;
     lastFacility.current={key,at:Date.now()};
    }
   }
   if(!text && scanValue.status!=="idle" && "step" in scanValue && typeof scanValue.step==="number" && scanValue.step!==lastScanStep.current){
    const observed="observations" in scanValue ? scanValue.observations?.at(-1)?.text ?? "" : "";
    text=observed+" "+scanValue.text;scanStep=scanValue.step;
   }
   if(!text){text=gate.current.offer(observation,Date.now());signalAnnouncement=!!text;if(text&&observation.status==="short_countdown")important=true;}
   if(text&&voiceRef.current&&callbacks.current.canAnnounce()){
    const spoken=callbacks.current.say(text,next.receivedAt,false,important,()=>{if(active){gate.current.reset();lastFacility.current={key:"",at:-Infinity};lastScanStep.current=-1;}});
    if(spoken&&signalAnnouncement)console.info(`[SENSEA] Automatic signal guidance: ${observation.status}`);
    if(spoken&&scanStep!==null)lastScanStep.current=scanStep;
   }
  },state=>{
   if(!active)return;
   if(state==="ready")setStatus("Street object and signal analysis ready");
   else if(state==="slow"||state==="unavailable"){
    latest.current=null;setFrame(null);callbacks.current.onResult(null);crossing.current.reset();gate.current.reset();facilities.current.reset();scanner.current.reset();
    setSignal({status:"unknown",text:"Signal unavailable because expanded analysis is unavailable."});
    setScan({status:"unavailable",text:"Surroundings scan stopped."});setFacilityText("");
    setStatus(state==="slow"?"Expanded analysis stopped because it was too slow. Basic camera analysis remains active.":"Could not prepare expanded analysis. Turn the camera off and on again.");
   }else if(state==="frame_error")setStatus("No expanded analysis result. Checking the next frame.");
  });
  const timer=setInterval(()=>{
   const current=latest.current;
   if(current&&Date.now()-current.receivedAt>1000){
    latest.current=null;setFrame(null);callbacks.current.onResult(null);crossing.current.reset();gate.current.reset();facilities.current.reset();
    setSignal({status:"unknown",text:"No fresh signal analysis is available."});setFacilityText("");
    if(scanner.current.active){scanner.current.reset();setScan({status:"unavailable",text:"Scan stopped because observations were interrupted."});}
   }
  },200);
  return()=>{active=false;clearInterval(timer);stop();};
 },[live,enabled]);
 useEffect(()=>{
  updateSignalHints(live&&enabled?signalFocusHints(baseResult,signal,Date.now()):{boxes:[],receivedAt:0});
 },[live,enabled,baseResult,signal]);
 useEffect(()=>{
  if(!live||!voice||!callbacks.current.canAnnounce())return;
  const guidance=searchGate.current.offer(signal,baseResult,Date.now());
  if(guidance){
   const accepted=callbacks.current.say(guidance.text,guidance.observedAt,false,false,()=>searchGate.current.retry());
   if(!accepted)searchGate.current.retry();
  }
 },[live,voice,baseResult,signal]);
 useEffect(()=>{gate.current.reset();searchGate.current.reset();lastFacility.current={key:"",at:-Infinity};},[voice]);
 const changeMode=(next:Mode)=>{callbacks.current.cancel();modeRef.current=next;setMode(next);crossing.current.reset();gate.current.reset();scanner.current.reset();setScan(scanner.current.describe());setSignal({status:"unknown",text:"Checking the pedestrian signal again for the selected situation."});};
 return <View style={styles.panel} testID="urban-panel">
  <Text accessibilityRole="header" style={styles.title}>Street objects and US signals · Experimental</Text>
  <Text testID="urban-state" style={styles.note}>{status}</Text>
  <Text style={styles.note}>Looks for possible streetlights, trash cans, bicycle racks and lockers. Objects may be misidentified or missed.</Text>
  {!!facilityText&&<Text style={styles.text}>{facilityText}</Text>}
  <Text style={styles.label}>Signal guidance runs automatically</Text>
  <Text style={styles.note}>No signal button is needed. With automatic voice on, aim at the pedestrian signal to hear observations. Situation controls below are optional; the camera cannot tell whether you have entered the road.</Text>
  <View style={styles.row}>{([["unknown","Automatic (default)"],["waiting","Waiting on sidewalk"],["crossing","Crossing"]] as const).map(([value,label])=>
   <Pressable key={value} accessibilityRole="radio" accessibilityState={{selected:mode===value}} onPress={()=>changeMode(value)} style={[styles.button,mode===value&&styles.selected]}><Text style={styles.buttonText}>{label}</Text></Pressable>)}</View>
  <Text style={styles.note}>Keep the pedestrian signal centered and hold the camera steady. Small or blurred symbols may remain unreadable.</Text>
  <Text testID="crossing-guidance" style={styles.text}>{signal.text}</Text>
  <Text style={styles.note}>The countdown is not time available to start crossing. Reading a signal does not establish crossing clearance.</Text>
  {signal.status==="select_target"&&(signal.candidates??[]).slice(0,4).map((box,i)=>
   <Pressable key={i} style={styles.button} accessibilityRole="button" onPress={()=>{callbacks.current.cancel();crossing.current.select(box);gate.current.reset();setSignal({status:"confirming",text:"Checking the selected signal again.",target:box,observedAt:frame?.receivedAt});}}><Text style={styles.buttonText}>Select possible signal: {((box.left+box.right)/2)<.33?"left":((box.left+box.right)/2)>.67?"right":"center"} of image</Text></Pressable>)}
  <Pressable testID="stop-scan-start" accessibilityRole="button" accessibilityState={{disabled:!live}} disabled={!live} style={styles.button} onPress={()=>{
   const value=scanner.current.start(latest.current,modeRef.current,Date.now());lastScanStep.current=0;setScan(value);
   if(live)callbacks.current.say(value.text,Date.now(),true,false);
  }}><Text style={styles.buttonText}>Start STOP surroundings scan</Text></Pressable>
  <Text testID="stop-scan-guidance" style={styles.text}>{scan.text}</Text>
  <Pressable accessibilityRole="button" style={styles.button} onPress={()=>{if(live){const current=latest.current;const valid=current&&Date.now()-current.receivedAt<=1000&&current.quality==="usable";callbacks.current.say(valid?`${signal.text} ${scan.text}`:"No fresh signal or surroundings observations.",Date.now(),true,false);}}}><Text style={styles.buttonText}>Replay signal and scan guidance</Text></Pressable>
 </View>;
}
const styles=StyleSheet.create({panel:{marginVertical:16,padding:16,borderWidth:1,borderColor:"#35556B",borderRadius:18,backgroundColor:"#162433"},title:{color:"#F3F6FA",fontSize:19,fontWeight:"700",marginBottom:8},note:{color:"#B6C5D4",fontSize:14,lineHeight:21,marginVertical:5},text:{color:"#F3F6FA",fontSize:17,lineHeight:25,marginVertical:8},label:{color:"#F3F6FA",fontSize:16,fontWeight:"700",marginTop:10},row:{flexDirection:"row",flexWrap:"wrap",gap:6},button:{minHeight:48,justifyContent:"center",padding:10,borderWidth:1,borderColor:"#7894AA",borderRadius:10,marginVertical:5},selected:{backgroundColor:"#204B48",borderColor:"#64D9C1"},buttonText:{color:"#D5F7EF",fontSize:16}});
