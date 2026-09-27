import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { UrbanResult } from "./types";
const native = Platform.OS === "android" ? NativeModules.SenseaUrbanVision : null;
let revision = 0;
export function startUrbanAnalysis(onResult:(result:UrbanResult)=>void,onStatus:(status:string)=>void) {
  if(!native){onStatus("unavailable");return ()=>{};}
  const generation=++revision;
  const emitter=new NativeEventEmitter(native);
  let active=true;
  const result=emitter.addListener("SenseaUrbanResult",(value:UrbanResult)=>{
    if(active&&value.generation===generation)onResult(value);
  });
  const status=emitter.addListener("SenseaUrbanStatus",(value:{generation:number;status:string})=>{
    if(active&&value.generation===generation)onStatus(value.status);
  });
  native.setEnabled(true,generation);
  return ()=>{active=false;result.remove();status.remove();native.setEnabled(false,++revision);};
}
