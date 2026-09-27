# Foundation and main integration

Main retains Expo Router, the light UI, Supabase accounts and noise grids, UW search, Google walking routes, route recalculation, GPS filtering, audit logging, and shared voice/haptic output. Foundation brings preview-first camera startup, Android local model loading and CPU/XNNPACK processing, bounded hazard tracking and preview overlays, and request-body/authentication limits and noise expiry fixes.

The foundation API changes are applied to app/foundation.py, where main had previously moved that API; app/main.py retains the existing navigation backend. Both API suites are tested. This does not introduce the separate backend-storage Supabase repository.

Production CameraProvider starts analysis on the native preview-start event and retains preview if analysis fails. Hazard warnings use shared voice and vibration priorities, with freshness checks before queued speech starts. Object observations are not verified distance, collision probability, stairs, or VPS.

CameraSmokeApp.tsx and index.smoke.ts preserve the camera-only emulator harness. Only the Android camera smoke workflow selects that entry; normal builds retain expo-router/entry. Native compilation, full navigation/camera interaction, latency, heat, battery, and VoiceOver/TalkBack require device testing. Historical branch build reports in README1.md refer to the standalone camera app, not this integrated build.

## Navigation and feedback corrections

Turn progress requires three distinct reliable observations over at least 1.5 seconds near the waypoint or along the next segment, rather than an impossible three-metre GPS accuracy sum. Rejected jumps preserve the actual accepted timestamp and are marked untrusted; three consistent accurate GPS fixes over two seconds allow reacquisition. Google per-step polylines are returned by the backend and used for curved-path distances, limited to nearby steps; older whole-route geometry remains a compatibility fallback.

Screen-reader announcements retain pending items, use iOS completion events and OS queue options, and use a text-length fallback on Android where completion is unavailable. Completion never automatically activates speech recognition. Real-device timing still needs VoiceOver/TalkBack validation. Hazard speech reserves a bounded pending candidate, commits cooldown on TTS start or screen-reader dispatch, and releases undelivered candidates on expiry/cancellation. Camera warnings are revalidated against the current tracked object before speech starts.
