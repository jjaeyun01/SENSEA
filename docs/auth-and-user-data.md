# Authentication and per-user data setup

SENSEA supports email/password and Google OAuth through Supabase Auth. Passwords
are hashed and managed by Supabase Auth and are deliberately absent from the
`public.profiles` table.

## 1. Apply the database migrations

Run these files in order in the Supabase SQL editor:

1. `backend/migrations/001_initial.sql`
2. `backend/migrations/002_user_accounts.sql`
3. `backend/migrations/003_crowdsourced_noise_map.sql`

The second migration creates `profiles`, `user_preferences`, `user_places`, and
`route_history`. Row Level Security restricts every row to its authenticated
owner. It also creates profile and preference rows whenever Auth creates a user.
The third migration adds revocable noise-map consent, private coarse-grid
measurements, and k-anonymous hourly map aggregates.

## 2. Configure the mobile app

Copy `mobile/.env.example` to `mobile/.env`, then set:

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not put the Supabase service-role key or a Google client secret in the mobile
app. Restart Expo after changing environment variables.

## 3. Enable authentication providers

In Supabase Dashboard:

- Authentication > Providers > Email: enable email/password. Decide whether the
  demo requires email confirmation.
- Authentication > Providers > Google: add the Google OAuth client ID and secret.
- In Google Cloud, add Supabase's callback URL:
  `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
- In Supabase Authentication > URL Configuration > Redirect URLs, allow
  `sensea://auth/callback` for development builds and the deployed web callback
  URL for web builds.

Google OAuth in a native build uses the `sensea` app scheme. Expo Go cannot
reliably own a custom URL scheme, so test Google sign-in with a development build
(`npx expo run:ios` / `npx expo run:android` or an EAS development build).

## Data behavior

- Selecting a destination updates that user's recent places.
- The account page can mark places as saved or favorite.
- Starting navigation adds a route-history row with the route settings used.
- Route preferences include time, stairs, mixed vehicle/pedestrian roads,
  crosswalks, and construction avoidance.
- From 07:00–19:00 in the profile timezone the app requests the quieter-route
  policy. From 19:00–07:00 it requests the more active-sounding-route policy.

Noise is a relative sound measurement, not proof of crowd presence or safety.
This policy must never override verified pedestrian-path constraints, closures,
or emergency instructions.
