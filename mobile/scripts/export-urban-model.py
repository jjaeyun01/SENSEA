"""Reproducible fixed-vocabulary OWL-ViT export. No training or private data.
Requires Python torch 2.7.1 CPU, transformers 4.53.3, onnx 1.18.0, onnxruntime 1.22.1.
The upstream safetensors revision/checksum is pinned; do not load pickle weights.
"""
from pathlib import Path
import argparse, json, hashlib, time
import numpy as np
import torch
from transformers import OwlViTForObjectDetection, CLIPTokenizer
from onnxruntime.quantization import quantize_dynamic, QuantType
import onnxruntime as ort
UPSTREAM='cbc355fb364588351c5d51c7f74465e8e7ec6f72'
WEIGHTS_SHA='4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b'
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--size',type=int,default=384)
a=p.parse_args(); root=Path(__file__).resolve().parents[1]
assert a.size in (384,512,768)
assert hashlib.sha256((a.source/'model.safetensors').read_bytes()).hexdigest()==WEIGHTS_SHA
labels=json.loads((root/'assets/models/urban-labels.json').read_text(encoding='utf-8'))
torch.set_num_threads(2)
model=OwlViTForObjectDetection.from_pretrained(a.source,local_files_only=True,use_safetensors=True,attn_implementation='eager').eval()
tokenizer=CLIPTokenizer.from_pretrained(a.source,local_files_only=True)
inputs=tokenizer([x['prompt'] for x in labels],return_tensors='pt',padding='max_length',max_length=16,truncation=True)
example=torch.zeros(1,3,a.size,a.size)
with torch.inference_mode():
 reference=model(pixel_values=example,**inputs,interpolate_pos_encoding=True)
 queries=reference.text_embeds.detach()
class FixedVocabulary(torch.nn.Module):
 def __init__(self):
  super().__init__();self.detector=model;self.register_buffer('queries',queries)
 def forward(self,pixel_values):
  feature,_=self.detector.image_embedder(pixel_values,interpolate_pos_encoding=True)
  features=feature.reshape(1,-1,feature.shape[-1])
  logits,_=self.detector.class_predictor(features,self.queries)
  boxes=self.detector.box_predictor(features,feature,interpolate_pos_encoding=True)
  return torch.sigmoid(logits),boxes
fixed=FixedVocabulary().eval()
with torch.inference_mode():
 scores,boxes=fixed(example)
 assert torch.allclose(scores,torch.sigmoid(reference.logits),atol=1e-5)
 assert torch.allclose(boxes,reference.pred_boxes,atol=1e-5)
a.output.mkdir(parents=True,exist_ok=True)
fp=a.output/'urban-fp32.onnx'; q=a.output/'urban-int8.onnx'
torch.onnx.export(fixed,example,fp,input_names=['pixels'],output_names=['scores','boxes'],opset_version=17,do_constant_folding=True,dynamo=False)
quantize_dynamic(fp,q,weight_type=QuantType.QInt8,op_types_to_quantize=['MatMul'],per_channel=True)
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
session=ort.InferenceSession(str(q),sess_options=opts,providers=['CPUExecutionProvider'])
assert len(session.get_inputs())==1 and session.get_inputs()[0].shape==[1,3,a.size,a.size]
xs=np.zeros((1,3,a.size,a.size),np.float32); samples=[]
for _ in range(4):
 start=time.perf_counter(); predicted=session.run(None,{'pixels':xs});samples.append(round((time.perf_counter()-start)*1000,2))
assert predicted[0].shape==tuple(scores.shape) and predicted[1].shape==tuple(boxes.shape)
assert all(np.isfinite(x).all() for x in predicted)
report={'source':'google/owlvit-base-patch32','revision':UPSTREAM,'source_weights_sha256':WEIGHTS_SHA,'license':'Apache-2.0','file':q.name,'sha256':hashlib.sha256(q.read_bytes()).hexdigest(),'bytes':q.stat().st_size,'input_size':a.size,'classes':len(labels),'patches':(a.size//32)**2,'mean':[0.48145466,0.4578275,0.40821073],'std':[0.26862954,0.26130258,0.27577711],'resize':'stretch square bilinear on Android','desktop_zero_input_ms':samples,'zero_input_score_max_error':float(np.abs(predicted[0]-scores.numpy()).max()),'zero_input_box_max_error':float(np.abs(predicted[1]-boxes.numpy()).max()),'modifications':'fixed text embeddings, positional interpolation, MatMul dynamic int8; experimental zero-shot classes, no task fine-tuning'}
(a.output/'urban-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
