# 공개 객체 탐지 모델

TensorFlow의 **EfficientDet Lite0 V1**, uint8 RGB 320×320, NMS 후처리가 포함된 TFLite 모델을 사용합니다. 다운로드 URL, 파일 크기, SHA-256은 [manifest.json](manifest.json)에 고정했습니다.

`npm run models:download`로 개발/빌드 시 다운로드합니다. 실행 중 모델을 내려받거나 사용자의 영상을 전송하지 않습니다. 큰 바이너리는 Git에서 제외하고 빌드된 앱에 포함합니다.

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
