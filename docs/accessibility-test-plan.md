# Accessibility test plan

Test on physical iOS and Android devices with the backend both available and unavailable. Do not use blindfolded testing as a substitute for review by blind or low-vision users.

## VoiceOver (iOS)

- Enable VoiceOver before launch. Verify focus starts with meaningful SENSEA/home content and follows visual order.
- Enter “Memorial Library,” search, review the spoken/visible confirmation, edit it, then confirm it.
- Confirm each route is announced with label, distance, relative-noise status, freshness, and longer-route difference.
- Select a route and start simulation without interacting with a map.
- Verify current waypoint changes are announced once; Repeat, Pause, Resume, Describe surroundings, and Stop are reachable and clearly labelled.
- Deny location, microphone, and camera permissions separately. Confirm manual/demo controls remain usable and messages are announced.
- Trigger camera assistance, hear the stop-walking prompt, capture one still, hear uncertainty, retry, and return to navigation.

## TalkBack (Android)

- Repeat the entire VoiceOver critical path using swipe navigation and activation.
- Verify large action buttons expose the button role, disabled/busy state, label, and useful hint.
- Check that camera preview is hidden from the accessibility tree while camera actions remain discoverable.
- Check dynamic messages do not create announcement loops or overlap app speech.

## Failure and fallback matrix

- Empty destination: “Please enter or say a destination.”
- Unknown destination: supported-location explanation; focus stays on a recoverable control.
- Backend unavailable: network message and Try again/Back actions; no silent fabricated response.
- Speech provider unavailable: typed destination and all manual buttons remain available.
- Location denied or accuracy above 30 m: explicitly identify Demo simulation; do not announce a precise live turn.
- Camera denied: explain unavailability and provide Return to navigation.
- Unknown/stale noise: announce Unknown or Stale; never present missing data as zero.
- Uncertain vision: say uncertainty or “I cannot tell”; never make safety/accessibility claims.

Record device, OS, screen-reader version, result, focus issue, duplicate announcement, permission outcome, and tester notes for each run.
