# SENSEA three-minute demo

Before starting, run the backend and mobile app, set `EXPO_PUBLIC_API_URL` to the backend address reachable by the phone, and prepare a printed “Memorial Library” sign.

1. Open SENSEA. Hear “Where would you like to go?”
2. Type **Memorial Library**. (The microphone control explains the manual fallback because STT is not configured.)
3. Search, hear the recognized destination, and press **Confirm destination**.
4. Hear and compare the shortest route and longer lower-measured-noise route. Explain that the values are deterministic demo relative-noise indexes, not dB or crowd counts.
5. Select **Lower measured noise route**, then press **Start navigation**.
6. If location permission is denied or accuracy is poor, note the clear demo-simulation fallback.
7. Advance one waypoint and hear its verified-graph instruction.
8. Press **Repeat instruction**.
9. Press **Pause navigation**, verify Next is disabled, then **Resume navigation**.
10. Stop walking at the prepared sign and press **Describe surroundings**.
11. Grant camera permission, capture one still JPEG, and hear the uncertainty-aware, explicitly mock description.
12. Return to navigation, then press **Stop navigation**.

Close by stating that the routes, coordinates, noise observations, simulation, and vision response are demo data. SENSEA is an experimental information aid, not a mobility or obstacle-avoidance system.
