const { withAppBuildGradle, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs=require('node:fs');const path=require('node:path');
const marker='// SENSEA urban vision dependencies';
module.exports=function withUrbanVision(config){
 config=withAppBuildGradle(config,result=>{
  if(result.modResults.language!=='groovy')throw new Error('Urban vision requires Groovy Gradle');
  if(!result.modResults.contents.includes(marker))result.modResults.contents+=`
${marker}
dependencies {
 implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.22.0'
 implementation 'com.google.mlkit:text-recognition:16.0.1'
}
// Restrict every native dependency to the ABIs actually built by React Native.
android { defaultConfig { ndk { abiFilters.addAll((findProperty('reactNativeArchitectures') ?: 'arm64-v8a,x86_64').split(',')) } } }
`;
  return result;
 });
 config=withMainApplication(config,result=>{
  const text='add(com.sensea.urban.UrbanVisionPackage())';
  if(!result.modResults.contents.includes(text)){
   if(!result.modResults.contents.includes('PackageList(this).packages.apply {'))throw new Error('Unknown MainApplication shape');
   result.modResults.contents=result.modResults.contents.replace('PackageList(this).packages.apply {','PackageList(this).packages.apply {\n          '+text);
  }return result;
 });
 return withDangerousMod(config,['android',async result=>{
  const root=result.modRequest.projectRoot;
  const source=path.join(root,'native/urban-vision');
  const target=path.join(root,'android/app/src/main/java/com/sensea/urban');fs.mkdirSync(target,{recursive:true});
  for(const file of ['UrbanVisionModule.kt','UrbanFrameAnalyzer.kt'])fs.copyFileSync(path.join(source,file),path.join(target,file));
  const assets=path.join(root,'android/app/src/main/assets/sensea-urban');fs.mkdirSync(assets,{recursive:true});
  for(const file of ['urban-int8.onnx','urban-manifest.json','urban-labels.json'])fs.copyFileSync(path.join(root,'assets/models',file),path.join(assets,file));
  const proguard=path.join(root,'android/app/proguard-rules.pro');
  const rules='\n# SENSEA reflected frame observer\n-keep class com.sensea.urban.** { *; }\n-keep class ai.onnxruntime.** { *; }\n';
  if(!fs.readFileSync(proguard,'utf8').includes('# SENSEA reflected frame observer'))fs.appendFileSync(proguard,rules);
  return result;
 }]);
};
