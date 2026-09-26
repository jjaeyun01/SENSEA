# Windows에서 iPhone 카메라 테스트

이 경로는 Mac과 유료 Apple Developer 멤버십이 없는 개인 기기 테스트용입니다. 일반 Apple 계정과 USB로 연결한 iPhone, Windows용 서명 도구가 필요합니다. 개발자가 만든 자체 앱을 개인 계정으로 서명해서 설치하며, 무료 계정으로 설치한 앱은 7일마다 다시 서명해야 합니다.

## 설치 파일

GitHub Actions의 **SENSEA iPhone test package** 워크플로는 모바일 코드 또는 해당 워크플로 변경을 푸시하면 자동 실행됩니다. `feat/backend-foundation` 브랜치의 성공 실행을 엽니다. 완료 후 `sensea-iphone-unsigned` 아티팩트를 받아 ZIP을 풀면 `SENSEA-iphone-unsigned.ipa`가 나옵니다.

이 파일은 실제 iPhone용으로 컴파일한 **미서명** 앱입니다. 파일을 누르거나 Safari에서 내려받는 것만으로 설치되지 않습니다. 기존 `sensea-ios-simulator` 아티팩트는 Mac 시뮬레이터용이라 이 용도로 사용할 수 없습니다.

워크플로는 Apple 계정·인증서 없이 빌드하고 실제 기기 플랫폼, 로컬 모델 해시, 오프라인 JS 번들을 확인합니다. 개인 기기 서명은 아래 단계에서 본인 PC에서 진행합니다.

## 설치 순서

1. [Sideloadly 공식 사이트](https://sideloadly.io/)에서 Windows 버전을 설치합니다. 해당 도구는 Windows에서 Apple 웹 배포판 iTunes/iCloud를 요구합니다. 기존 설치와 충돌하면 공식 안내를 확인하고, 사용 중인 Apple 프로그램을 임의로 삭제하지 마세요.
2. iPhone을 USB로 연결하고 잠금을 해제한 뒤 **이 컴퓨터를 신뢰**합니다.
3. Sideloadly에서 연결된 iPhone을 선택하고 `SENSEA-iphone-unsigned.ipa`를 넣습니다.
4. 본인 Apple 계정으로 로그인하고 설치를 시작합니다. 비밀번호와 인증 코드는 본인 PC의 도구에 직접 입력하며 채팅·저장소·GitHub Actions에 넣지 않습니다. 이 과정에는 제3자 서명 도구를 통한 Apple 계정 인증이 필요합니다.
5. iPhone에서 개발자 신뢰 또는 개발자 모드를 요구하면 Apple 안내에 따라 설정합니다. 개발자 모드는 재시작을 요구할 수 있습니다.
6. SENSEA를 실행하고 **카메라 켜기 → 카메라 권한 허용**을 선택합니다. 앱에 모델이 포함되어 있어 Metro 개발 서버나 백엔드 서버 없이 로컬 사물 인식을 시험할 수 있습니다.

도구의 최소 iOS 지원 버전과 앱의 최소 iOS 버전은 다릅니다. 앱의 실제 최소 버전은 빌드 로그의 `Minimum iOS` 또는 IPA 내부 `Info.plist`로 확인합니다. 모델·프레임 처리의 실기기 성능은 별도 확인해야 합니다.

## 처음 확인할 동작

- 밝은 실내에서 사람·의자 등 카메라에 보이는 사물의 표시와 음성 안내.
- 카메라 끄기, 음성 안내 끄기, 다시 듣기.
- 다른 앱으로 이동했을 때 카메라·음성이 중지되는지.
- 다시 돌아와 카메라를 켤 수 있는지.
- 10분 정도 실행하며 반응 지연·발열·종료 여부 확인.

현재는 사물 인식 프로토타입입니다. 차도/인도 분할, 거리 계산, 실제 길안내 UI는 아직 연결하지 않았습니다.

공식 참고: [Sideloadly의 Windows/무료 계정 지원과 7일 갱신](https://sideloadly.io/), [Apple의 개인 개발 계정 제한](https://developer.apple.com/help/account/basics/about-your-developer-account), [개발자 모드](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
