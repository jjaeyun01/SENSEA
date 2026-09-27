# 공개 객체 탐지 모델

TensorFlow의 **EfficientDet Lite0 V1**, uint8 RGB 320×320, NMS 후처리가 포함된 TFLite 모델을 사용합니다. 다운로드 URL, 파일 크기, SHA-256은 [manifest.json](manifest.json)에 고정했습니다.

`npm run models:download`로 개발/빌드 시 다운로드합니다. 실행 중 모델을 내려받거나 사용자의 영상을 전송하지 않습니다. 기본 TFLite 바이너리는 Git에서 제외하고 빌드된 앱에 포함합니다. 확장 ONNX는 아래 설명처럼 저장소에 포함합니다.

- [공식 모델 설명](https://github.com/tensorflow/tfhub.dev/blob/master/assets/docs/tensorflow/models/efficientdet/lite0/detection/metadata/lite/1.md)
- 배포 파일 내부 `TFLITE_METADATA`: author **TensorFlow**, license **Apache License. Version 2.0 http://www.apache.org/licenses/LICENSE-2.0.**
- 원본 가중치를 수정하지 않았습니다. `labels.json`은 원본 파일에 포함된 `labelmap.txt`의 90개 항목을 순서 그대로 JSON으로 옮겼습니다.
- [Apache-2.0 전문](LICENSE.txt)을 소스와 앱 내 오픈소스 안내에 포함합니다.
- 출력 순서: 위치 [1,25,4], 클래스 [1,25], 점수 [1,25], 개수 [1]. 같은 이름의 다른 EfficientDet 배포본은 출력 형식이 다를 수 있으므로 해시 확인을 생략하지 않습니다.

모델은 사물 분류용입니다. 차도/인도 분할·거리 추정·신호 색 판정·모든 위험물 탐지를 제공하지 않습니다. 고정 임계값 0.55는 초기 설정으로, 사용자 촬영 장면에서 별도 평가가 필요합니다.

직접 의존 라이브러리의 고지는 `scripts/generate-notices.mjs`로 생성합니다. npm 배포에 LICENSE가 없는 MIT 패키지는 원본 저장소의 배포 커밋에서 가져와 `mobile/licenses/`에 보관했습니다.

| 파일 | 원본 저장소 / 커밋 |
| --- | --- |
| vision-camera-LICENSE.txt | mrousavy/react-native-vision-camera / a4acf4d4f2083cf639699796d38d687e1f4bd49e |
| nitro-LICENSE.txt | mrousavy/nitro / 605017127c16f9d502f527097ffed77439d8ce6c |
| nitro-image-LICENSE.txt | mrousavy/react-native-nitro-image / 67397064eeb0fb53307dda1811efbf4bc210976a |

회사 프로젝트의 코드·자료·사진·모델 가중치를 사용하지 않았습니다.

## Android 확장 모델 (v0.4.7)

[Google OWL-ViT](https://huggingface.co/google/owlvit-base-patch32) Apache-2.0 공개 가중치를 사용합니다. 고정 revision, 원본/변환 파일 SHA-256, 입력 계약은 `urban-manifest.json`, 29개 질의와 한국어 이름은 `urban-labels.json`입니다. 회사 리소스와 사용자의 촬영 자료는 사용하지 않았습니다.

SENSEA 변경 사항: 텍스트 임베딩 사전 계산, 384×384 위치 임베딩 보간, ONNX opset 17 변환, MatMul INT8 동적 양자화. 추가 학습은 하지 않았습니다. 출력은 scores [1,144,29], boxes [1,144,4] 정규화 cx/cy/w/h입니다. Android에서 RGB bilinear 정사각형 변환 후 manifest의 CLIP 평균/표준편차를 사용합니다.

`urban-int8.onnx`는 99,257,966바이트로 저장소와 APK에 포함되어 실행 중 다운로드하지 않습니다. 해시 검증 후 앱 내부에 모델 파일 한 개를 풀며 영상 파일은 만들지 않습니다. ONNX Runtime Android 1.22.0(MIT), ML Kit Latin Text Recognition 16.0.1(Google API/ML Kit 약관)을 사용합니다. 라이선스/수정 고지를 앱의 오픈소스 안내에 포함했습니다. ML Kit 입력과 결과는 기기에서 처리하지만 SDK 성능·사용 통계는 Google에 전송될 수 있습니다. [공식 개인정보 설명](https://developers.google.com/ml-kit/terms)

재변환 시 Python 환경에 torch 2.7.1(CPU), transformers 4.53.3, onnx 1.18.0, onnxruntime 1.22.1을 설치하고 고정 revision의 safetensors/config/tokenizer 파일을 별도 캐시에 받습니다. `python scripts/export-urban-model.py --source <cache> --output <output>`으로 변환하며 원본 safetensors 해시가 다르면 중단합니다. pickle 가중치는 로드하지 않습니다. 변환 결과와 manifest는 함께 교체하고 기기/클래스별 검증을 다시 수행해야 합니다.

공개 dog 예제 한 장에서 FP32/INT8의 주요 상자 좌표 차이는 최대 0.012였지만 점수는 약 0.505→0.280으로 달라졌습니다. 이 확인은 변환 후 출력 존재를 확인하는 제한적 검사이며 보도 시설물·신호의 정확도나 재현율을 입증하지 않습니다. 0.16~0.35 임계값은 시험용 설정입니다. OWL-ViT는 연구용 zero-shot 모델이고, 특히 작은 신호 숫자·저두상 위험·맨홀 깊이를 신뢰성 있게 식별한다고 보장하지 않습니다.
