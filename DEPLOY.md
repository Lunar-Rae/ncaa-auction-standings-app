# Hosted Deploy Checklist

This app is ready to deploy as one hosted service with:
- Express serving the built frontend
- Supabase backing persistent chat + realtime updates
- Render running the app continuously

## 1. Create Supabase project

In Supabase:
1. Create a new project.
2. Open the SQL editor.
3. Run [supabase/comments-schema.sql](/Users/Ariel/Downloads/ncaa-auction-standings-app/supabase/comments-schema.sql).

That creates:
- `public.comments`
- indexes
- realtime publication
- read policy for anon/authenticated clients

## 2. Gather Supabase values

From Supabase project settings, copy:
- `Project URL`
- `anon public key`
- `service_role secret key`

You will use them as:
- `VITE_SUPABASE_URL` = Project URL
- `VITE_SUPABASE_ANON_KEY` = anon public key
- `SUPABASE_URL` = Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = service_role secret key

## 3. Deploy on Render

This repo includes [render.yaml](/Users/Ariel/Downloads/ncaa-auction-standings-app/render.yaml).

In Render:
1. Create a new `Blueprint` deployment from this repo.
2. Confirm the service name and build/start commands.
3. Set these environment variables:

Required:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:
- `PORT`

Do not set `VITE_API_BASE_URL` in production unless you intentionally split the frontend and backend. This app is designed to use the same host in production.

## 4. Verify after deploy

Check:
- `/api/health`
- `/api/league-state`
- `/api/comments`
- main site loads at `/`

Then verify in the UI:
- Trash Talk loads with no seed/sample comments
- new comments persist after refresh
- editing your own comment works
- comments appear live on a second device/browser tab

## 5. Install as an app

Once the Render URL is live over HTTPS:
- iPhone Safari: `Share` -> `Add to Home Screen`
- Android Chrome: `Install app`

## 6. If you still want a native iPhone app later

After the hosted web app is live and stable:
1. set the backend URL to the hosted Render URL
2. run the Capacitor iOS sync
3. open the generated project in Xcode
4. distribute with TestFlight

That should come after the hosted deploy, not before it.

