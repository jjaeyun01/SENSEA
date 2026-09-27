# Main integration: fr2 design with be1, fr1 and fr_num2 features

The app now starts through Expo Router. The theme, branding, shared buttons and the home, route-card, navigation, camera and settings layouts are based on `fr2` (`7fc4b80`). Old `fr_num2` map/backdrop designs are not rendered. Its destination/scan entry points redirect into the integrated flow.

## Feature mapping

- **fr2:** MVP screen shell, new UI, route cards, settings layout, typed destination entry and voice-command tests.
- **be1:** UW live search and street-address confirmation, server-side Google Routes, in-app Google map, GPS cue engine, native on-device camera analysis, shared speech/haptics and local interaction records. Camera and navigation now live in shared providers so changing screens does not create two camera sessions.
- **fr1:** destination re-confirmation, manual demo steps, pause/repeat/end actions, explicit permission and unavailable-service messages, priority-alert demo, tests/demo workflow.
- **fr_num2:** three demo alternatives (flat, shortest, reviewed), stair/noise fixture labels, Morgridge destination/aliases, destination-specific final instructions. The alternative design is superseded by fr2 as requested.

The original branch commits remain ancestors of the integration commit. `fr1` is already an ancestor of `fr_num2`.

## Contracts

Live mobile navigation uses `/campus/places`, `/campus/places/{id}`, and `/campus/routes`, supplied by either backend entry point. Existing `/places` and `/routes` contracts stay available for the original be1 modules. The earlier fr1/fr_num2 `{destination}` route contract is explicitly namespaced under `/demo/routes`; it returns `simulation_only: true`.

The home **Demo destination data** switch enables local fixtures even without a server or GPS. Live API errors do not automatically turn into simulated routes. A single result remains selectable and every live building selection fetches its address before confirmation. Google route cards report unknown accessibility, not verified stairs/slopes. Noise fixtures are not uploaded as device measurements.

The camera page uses the existing on-device model rather than fr2's unconnected still-photo upload. Its visual framing is fr2's camera screen. Frames are not saved or sent to the backend. Voice and haptic feedback remain enabled as required; unsupported flat-route/noise settings are disabled with an explanation. Interaction recording preferences persist and records can be inspected by count or deleted.

## Running

Follow `mobile/.env.example` and `backend/.env.example`. Use npm and `mobile/package-lock.json` (the competing pnpm lockfile was removed). Rebuild the native app after adding these modules. Expo Go is not supported. The Routes key stays on the server; platform Maps SDK keys are configured separately. A native build and a device with the required permissions are needed for camera/GPS/STT verification.

Automated checks cover backend contracts, demo aliases/routes, guidance priorities, GPS precision gates, speech commands and existing camera buffer behavior. Native JS bundles are checked for iOS and Android. These checks do not constitute an on-campus mobility safety validation or a successful paid Google API request.


## 2026-09-27: user_setting and connect-back-front

Merged both branches after reading implementation-summary.md and change-summary-2026-09-27.md.
The light four-tab design remains. Profile now opens the real Supabase auth/account screens rather
than the old session-only login form. The Map tab renders Supabase noise aggregates, not fictional
zones; its live dBFS meter remains separate from opt-in, authenticated noise contribution.
The continuous meter is stopped during contribution capture and speech recognition. Only consented
coarse-grid measurements are uploaded. Duplicate expo-audio plugin configuration was removed.
Visible route cards and spoken option selection share the same route order.

Supabase migrations are included as source. This merge does not rerun SQL or reset the remote DB.
Actual login, RLS access, OAuth redirects, microphone handoffs and long-running device performance
still require a configured project and physical-device validation. Preferences tab options remain
session controls; synced profile and route settings are available under Manage account.

## 2026-09-27 backend-foundation v0.4.12

README1 작업 기록 및 변경 코드를 main에 병합했습니다. Expo Router 진입점·사용자 계정·경로 기능·앱 로고를 유지하고 근접 장애물 판정/영어 객체 안내를 통합했습니다. Android 내비게이션에는 ONNX/ML Kit 확장 분석 및 신호 안내 패널을 연결했습니다. 기존 iOS 카메라 정리 실패 후 재시도 처리도 유지했습니다. Android 모델은 약 99 MB이며 iOS JS 번들에는 포함하지 않습니다. 네이티브 플러그인 반영을 위해 Android 앱 재빌드가 필요합니다. README1의 단독 카메라 UI/APK 기록은 역사적 기록이며 현재 main 화면과 다릅니다. 신호 숫자 최종 E2E 검증은 미완료이므로 통과로 간주하지 않습니다.
