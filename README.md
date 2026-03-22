
# NCAA Auction Standings App

This build keeps the **auction ownership and team information as the primary system** and backs it with live ESPN scores.

## Included
- Auction ownership ledger from your board and sheet
- Official 2026 scoring rules: 3 / 3 / 4 / 4 / 5 / 6
- Automatic standings calculation from actual winners
- Quick bracket view
- Ownership board by fantasy team
- Analysis view
- Auction intel
- Admin summary
- Backend ESPN scoreboard endpoint with 15-second frontend refresh

## Run Local

### Backend
```bash
cd backend
npm install
node server.js
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Backend runs on `http://localhost:4000`
Frontend runs on the Vite local URL, usually `http://localhost:5173`

## Deploy As One Hosted App

This repo can now run as a single hosted service:
- build the React frontend
- serve `frontend/dist` from Express
- expose the API and UI from the same server

### One-command local production-style run
```bash
npm run build
npm --prefix backend install
npm start
```

Then open:
`http://localhost:4000`

### Required env vars for persistent chat

In production, use Supabase for comments:

Backend:
```bash
PORT=4000
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

Frontend build:
```bash
VITE_API_BASE_URL=
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Notes:
- Leave `VITE_API_BASE_URL` blank in production so the frontend uses the same host.
- Run [supabase/comments-schema.sql](/Users/Ariel/Downloads/ncaa-auction-standings-app/supabase/comments-schema.sql) in your Supabase project before deploy.

### Render

A starter [render.yaml](/Users/Ariel/Downloads/ncaa-auction-standings-app/render.yaml) is included.

Render setup:
1. Create a new Blueprint deploy from this repo.
2. Set `SUPABASE_URL`.
3. Set `SUPABASE_SERVICE_ROLE_KEY`.
4. Deploy.

After deploy, users can open the HTTPS URL and install it as a PWA.

## iPhone App

This repo can now be wrapped as a real iPhone app with Capacitor.

### One-time setup
```bash
npm install
```

### Build the web app into the iPhone wrapper

If you are testing in the iOS simulator on this Mac:
```bash
VITE_API_BASE_URL=http://localhost:4000 npm run ios:sync
```

If you are building for a real phone or TestFlight, use a deployed HTTPS backend instead:
```bash
VITE_API_BASE_URL=https://your-api.example.com npm run ios:sync
```

### Open in Xcode
```bash
npm run ios:open
```

Notes:
- To see it as a true installed iPhone app, yes, you open the generated iOS project in Xcode.
- The current PWA is enough for browser install, but Xcode is the next step for a real native app shell.
- `localhost` only makes sense for the iOS simulator on your Mac. A physical phone or TestFlight build needs a reachable hosted backend URL.

## Notes
- This build is centered on your auction standings, not just a score app.
- Live scores come from ESPN's public scoreboard endpoint.
- Standings update automatically as finals come in.
- Some ESPN team names may need more alias mappings for perfect ownership matching.
