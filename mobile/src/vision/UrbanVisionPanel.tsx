import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { startUrbanAnalysis } from "./urban-native";
import { CrossingTracker, CrossingAnnouncementGate, StopScan, boxOverlap } from "./crossing.mjs";
import { FacilityAttention } from "./facility-attention.mjs";
import type { UrbanResult } from "./types";
import vocabulary from "../../assets/models/urban-labels.json";
const name=(label:string)=>vocabulary.find(x=>x.label===label)?.name??label;
type Mode="unknown"|"waiting"|"crossing";
type Observation={status:string;text:string;seconds?:number|null;observedAt?:number};
type Props={live:boolean;enabled:boolean;voice:boolean;onResult:(value:UrbanResult|null)=>void;
 say:(text:string,at:number,manual?:boolean,priority?:boolean,onDropped?:()=>void)=>boolean;
 canAnnounce:()=>boolean;cancel:()=>void};
export function UrbanVisionPanel({live,enabled,voice,onResult,say,canAnnounce,cancel}:Props){
 const [mode,setMode]=useState<Mode>("unknown"),modeRef=useRef<Mode>("unknown");
 const [status,setStatus]=useState("카메라를 켜면 확장 분석을 준비합니다.");
 const [frame,setFrame]=useState<UrbanResult|null>(null),latest=useRef<UrbanResult|null>(null);
 const [signal,setSignal]=useState<Observation>({status:"unknown",text:"보행 신호를 확인하지 못했습니다."});
 const [scan,setScan]=useState<Observation>({status:"idle",text:"STOP 표지에서 좌우 스캔을 시작할 수 있습니다."});
 const [facilityText,setFacilityText]=useState("");
 const crossing=useRef(new CrossingTracker()),gate=useRef(new CrossingAnnouncementGate()),scanner=useRef(new StopScan()),facilities=useRef(new FacilityAttention());
 const voiceRef=useRef(voice);voiceRef.current=voice;
 const callbacks=useRef({onResult,say,canAnnounce,cancel});callbacks.current={onResult,say,canAnnounce,cancel};
 const lastFacility=useRef({key:"",at:-Infinity});
 const lastScanStep=useRef(-1);
 useEffect(()=>{
  latest.current=null;setFrame(null);callbacks.current.onResult(null);
  crossing.current.reset();gate.current.reset();scanner.current.reset();facilities.current.reset();lastFacility.current={key:"",at:-Infinity};
  setSignal({status:"unknown",text:"보행 신호를 확인하지 못했습니다."});
  setScan({status:"idle",text:"STOP 표지에서 좌우 스캔을 시작할 수 있습니다."});setFacilityText("");
  if(!live){setStatus("카메라를 켜면 확장 분석을 준비합니다.");return;}
  if(!enabled){setStatus("기본 위험 분석을 우선하고 있어 확장 분석은 대기 중입니다.");return;}
  setStatus("시설물·보행 신호 분석 준비 중");
  let active=true;
  const stop=startUrbanAnalysis(next=>{
   if(!active||Date.now()-next.receivedAt>1000||next.receivedAt>Date.now())return;
   if(latest.current&&next.receivedAt<=latest.current.receivedAt)return;
   latest.current=next;setFrame(next);setStatus(next.quality==="usable"?"시설물·보행 신호 분석 중":"영상이 어둡거나 가려져 확장 분석을 보류합니다.");
   const observation=crossing.current.update(next,modeRef.current,Date.now());setSignal(observation);
   const scanValue=scanner.current.update(next,modeRef.current,Date.now());setScan(scanValue);
   const attention=facilities.current.update(next,Date.now()),target=attention.find(x=>x.level!=="notice");
   const details=attention.map(x=>`${name(x.label)} 후보 · ${x.level==="priority"?"우선 주의":x.level==="caution"?"주의":"참고"}`).join(" · ");setFacilityText(details);
   callbacks.current.onResult({...next,detections:next.detections.map(d=>{
    const match=attention.find(a=>a.label===d.label && boxOverlap(a.box,d.box)>.45);
    return match?{...d,level:match.level}:d;
   })});
   if(!voiceRef.current||!callbacks.current.canAnnounce())return;
   let text:string|null=null,important=false,scanStep:number|null=null;
   if(target){
    const key=`${target.id}/${target.level}`;
    if(key!==lastFacility.current.key||Date.now()-lastFacility.current.at>=8000){
     text=`${target.level==="priority"?"우선 주의":"주의"}. ${name(target.label)} 후보가 화면 ${target.relation==="direct"?"중앙 아래":"주변"}에 보입니다.`;important=true;
     lastFacility.current={key,at:Date.now()};
    }
   }
   if(!text && scanValue.status!=="idle" && "step" in scanValue && typeof scanValue.step==="number" && scanValue.step!==lastScanStep.current){
    const observed="observations" in scanValue ? scanValue.observations?.at(-1)?.text ?? "" : "";
    text=observed+" "+scanValue.text;scanStep=scanValue.step;
   }
   if(!text)text=gate.current.offer(observation,Date.now());
   if(text&&voiceRef.current&&callbacks.current.canAnnounce()){
    const spoken=callbacks.current.say(text,next.receivedAt,false,important,()=>{if(active){gate.current.reset();lastFacility.current={key:"",at:-Infinity};lastScanStep.current=-1;}});
    if(spoken&&scanStep!==null)lastScanStep.current=scanStep;
   }
  },state=>{
   if(!active)return;
   if(state==="ready")setStatus("시설물·보행 신호 분석 준비 완료");
   else if(state==="slow"||state==="unavailable"){
    latest.current=null;setFrame(null);callbacks.current.onResult(null);crossing.current.reset();gate.current.reset();facilities.current.reset();scanner.current.reset();
    setSignal({status:"unknown",text:"확장 분석을 사용할 수 없어 신호를 확인하지 못했습니다."});
    setScan({status:"unavailable",text:"주변 스캔을 중지했습니다."});setFacilityText("");
    setStatus(state==="slow"?"확장 분석이 느려 중지했습니다. 기본 카메라 분석은 유지됩니다.":"확장 분석을 준비하지 못했습니다. 카메라를 다시 켜 주세요.");
   }else if(state==="frame_error")setStatus("확장 분석 결과를 얻지 못했습니다. 다음 영상을 확인합니다.");
  });
  const timer=setInterval(()=>{
   const current=latest.current;
   if(current&&Date.now()-current.receivedAt>1000){
    latest.current=null;setFrame(null);callbacks.current.onResult(null);crossing.current.reset();gate.current.reset();facilities.current.reset();
    setSignal({status:"unknown",text:"최신 신호 분석이 없어 확인할 수 없습니다."});setFacilityText("");
    if(scanner.current.active){scanner.current.reset();setScan({status:"unavailable",text:"관찰이 끊겨 스캔을 중지했습니다."});}
   }
  },200);
  return()=>{active=false;clearInterval(timer);stop();};
 },[live,enabled]);
 useEffect(()=>{gate.current.reset();lastFacility.current={key:"",at:-Infinity};},[voice]);
 const changeMode=(next:Mode)=>{callbacks.current.cancel();modeRef.current=next;setMode(next);crossing.current.reset();gate.current.reset();scanner.current.reset();setScan(scanner.current.describe());setSignal({status:"unknown",text:"새 상태에서 보행 신호를 다시 확인합니다."});};
 return <View style={styles.panel} testID="urban-panel">
  <Text accessibilityRole="header" style={styles.title}>시설물·미국 보행 신호 · 시험 기능</Text>
  <Text testID="urban-state" style={styles.note}>{status}</Text>
  <Text style={styles.note}>가로등·쓰레기통·자전거 거치대/보관함 등을 확장 후보로 찾습니다. 잘못 인식하거나 놓칠 수 있습니다.</Text>
  {!!facilityText&&<Text style={styles.text}>{facilityText}</Text>}
  <Text style={styles.label}>현재 상황</Text>
  <View style={styles.row}>{([["unknown","상태 미확인"],["waiting","보도에서 대기"],["crossing","횡단 중"]] as const).map(([value,label])=>
   <Pressable key={value} accessibilityRole="radio" accessibilityState={{selected:mode===value}} onPress={()=>changeMode(value)} style={[styles.button,mode===value&&styles.selected]}><Text style={styles.buttonText}>{label}</Text></Pressable>)}</View>
  <Text testID="crossing-guidance" style={styles.text}>{signal.text}</Text>
  <Text style={styles.note}>카운트다운은 새로 건너기 시작할 수 있는 시간이 아닙니다. 신호를 읽어도 횡단 가능을 확정하지 않습니다.</Text>
  {signal.status==="select_target"&&frame?.detections.filter(d=>d.label.endsWith("signal")).slice(0,3).map((d,i)=>
   <Pressable key={i} style={styles.button} accessibilityRole="button" onPress={()=>{callbacks.current.cancel();crossing.current.select(d.box);gate.current.reset();setSignal({status:"confirming",text:"선택한 신호를 다시 확인합니다."});}}><Text style={styles.buttonText}>화면 {((d.box.left+d.box.right)/2)<.33?"왼쪽":((d.box.left+d.box.right)/2)>.67?"오른쪽":"중앙"} 신호 후보 선택</Text></Pressable>)}
  <Pressable testID="stop-scan-start" accessibilityRole="button" accessibilityState={{disabled:!live}} disabled={!live} style={styles.button} onPress={()=>{
   const value=scanner.current.start(latest.current,modeRef.current,Date.now());lastScanStep.current=0;setScan(value);
   if(live)callbacks.current.say(value.text,Date.now(),true,false);
  }}><Text style={styles.buttonText}>STOP 주변 스캔 시작</Text></Pressable>
  <Text testID="stop-scan-guidance" style={styles.text}>{scan.text}</Text>
  <Pressable accessibilityRole="button" style={styles.button} onPress={()=>{if(live){const current=latest.current;const valid=current&&Date.now()-current.receivedAt<=1000&&current.quality==="usable";callbacks.current.say(valid?`${signal.text} ${scan.text}`:"최신 신호·주변 관찰 결과가 없습니다.",Date.now(),true,false);}}}><Text style={styles.buttonText}>신호·스캔 안내 다시 듣기</Text></Pressable>
 </View>;
}
const styles=StyleSheet.create({panel:{marginVertical:16,padding:16,borderWidth:1,borderColor:"#35556B",borderRadius:18,backgroundColor:"#162433"},title:{color:"#F3F6FA",fontSize:19,fontWeight:"700",marginBottom:8},note:{color:"#B6C5D4",fontSize:14,lineHeight:21,marginVertical:5},text:{color:"#F3F6FA",fontSize:17,lineHeight:25,marginVertical:8},label:{color:"#F3F6FA",fontSize:16,fontWeight:"700",marginTop:10},row:{flexDirection:"row",flexWrap:"wrap",gap:6},button:{minHeight:48,justifyContent:"center",padding:10,borderWidth:1,borderColor:"#7894AA",borderRadius:10,marginVertical:5},selected:{backgroundColor:"#204B48",borderColor:"#64D9C1"},buttonText:{color:"#D5F7EF",fontSize:16}});
