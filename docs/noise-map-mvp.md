# Crowdsourced noise map MVP

## Apply the schema

After migrations `001` and `002`, run
`backend/migrations/003_crowdsourced_noise_map.sql` once in the Supabase SQL
Editor. It creates:

- `noise_collection_consents`: versioned, revocable foreground-only consent.
- `noise_measurements`: private numeric readings owned by the contributor.
- `noise_grid_hourly`: automatically refreshed hourly grid aggregates.

Raw audio is never stored or uploaded. The app aggregates five seconds of the
already-running in-memory live meter, converts the exact location to a roughly
30–45 metre cell on-device, and uploads numeric data only.

The aggregate table is readable only for cells with at least three distinct
contributors. A signed-in user can delete all of their own measurements from
Settings; aggregate rows are recalculated by a database trigger.

## Collection behavior

- Collection is off by default and requires a signed-in user.
- An in-app disclosure appears before the OS microphone permission prompt.
- Sampling occurs only during active foreground navigation, for five seconds at
  most once every 30 seconds.
- Samples are discarded if spoken guidance plays, the app backgrounds, location
  accuracy exceeds 30 metres, or fewer than three valid metering points exist.
- Database policy limits one accepted upload per user per 20 seconds and 1,000
  accepted uploads per day.
- The MVP accepts only coarse grid centers inside the UW–Madison campus bounds.

## Interpretation

The uploaded value is relative sound derived from dBFS. It is not calibrated dBA
or sound-pressure level. The UI uses qualitative labels and must not display it
as a certified decibel measurement. Sound level does not prove crowd presence or
route safety.

Routes are scored only when recent k-anonymous aggregate cells overlap their
polylines. Without coverage, route order falls back to duration and the UI says
that noise coverage is unavailable.

## Development build required

The Expo audio plugin changes native microphone configuration. Rebuild the iOS
or Android development client after pulling this change:

```bash
cd mobile
npx expo run:ios --device
# or: npx expo run:android --device
```

Then use `npx expo start --dev-client --clear`. Expo Go is not sufficient for the
project's custom native dependencies.

## Useful verification queries

```sql
select * from public.noise_collection_consents order by updated_at desc;
select * from public.noise_measurements order by measured_at desc limit 50;
select * from public.noise_grid_hourly order by hour_bucket desc limit 50;
```

The SQL Editor runs with elevated database privileges and can see raw rows. The
mobile client remains restricted by Row Level Security.
