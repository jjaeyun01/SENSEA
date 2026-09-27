# Integrated SENSEA demo (fr2 UI)

1. Open the app with VoiceOver/TalkBack as appropriate. Confirm the greeting, large voice orb and destination input.
2. Enable **Demo destination data** for an offline walkthrough. Search `Morgridge`, `도서관`, or `학생회관`.
3. Select the result. Hear the destination confirmation and press **Find routes** (or say `yes`).
4. Compare three explicitly simulated cards: flat, shortest (stairs), reviewed. Noise status is fresh/stale/unknown fixture data, not a live measurement.
5. Select an option and press **Start navigating**. No location or camera permission is required in this demo.
6. Exercise **Next simulated waypoint**, **Repeat**, **Pause/Resume**, and **Test priority alert (simulation)**. The last waypoint confirms a simulated arrival.
7. Open camera assistance while stopped, allow camera permission, and start the local model. Return to navigation. Actual descriptions require a supported native device; they do not infer distance or a clear path.
8. In Settings, check/delete interaction records and turn recording off. Voice/haptics are required; flat-route preference and live noise sensing are not available yet.
9. For live testing, disable demo mode, configure the server and Google keys, select a UW building, confirm its street address, request routes from the current position, prepare the camera, and start GPS guidance. Do this with a sighted tester.

## Failure rehearsal

- Unknown destination: no invented route; edit and retry.
- Offline backend: explicit search error; enable demo manually if desired.
- Missing Routes key/token: visible server error, no fallback to live-looking fixtures.
- Location denied or inaccurate: no precise live turn instruction; retry permissions/location.
- Camera denied: remain in-app, retry through system settings or return.
- App backgrounded: stop camera/location guidance and require explicit resume.
- Stale GPS: withhold turn cues. No assumption of arrival at an accessible entrance.
