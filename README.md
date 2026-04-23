# Your Internet Radio Dial

A skeuomorphic antique-radio web app for tuning the world's internet radio stations. Walnut cabinet, brass-bezel dial, amber glow, a real VU meter driven by RMS of the audio graph, and a drum-style ticker when a band has more stations than fit on the arc.

Built with Next.js 14 (App Router), React, Zustand, IndexedDB, and Supabase for optional cloud sync.

## Running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Both are found in your Supabase project's **Settings → API** page. The app works entirely offline (anonymous-by-default, IndexedDB-backed) without these — they only enable email sign-up and cloud sync of your station library across devices.

## How it works

- **Audio engine** (`src/lib/audio.ts`) — two HTML5 audio elements: one CORS-enabled and routed through a Web Audio graph (for the VU meter), one fallback. Non-CORS origins route through `/api/stream` or `/api/hls` (same-origin proxies) so the graph stays untainted.
- **HLS manifest rewriting** (`src/app/api/hls/route.ts`) — rewrites segment URLs and every `URI="..."` attribute in the manifest so HLS can play from CORS-blocked origins.
- **Now-playing metadata** (`src/app/api/now-playing/route.ts`) — polls the station's Icecast/Shoutcast metadata and scrolls it across the dial as a marquee.
- **Station discovery** (`src/app/api/stations/route.ts`) — proxies radio-browser.info so the search overlay can add new stations.
- **Library sync** (`src/lib/supabase/sync.ts`) — write-through dual-sync: every mutation writes to IndexedDB always, and to Supabase if the user is signed in (anonymous or real). Cloud wins on load.

## Architecture details

Full handoff notes, known gotchas, and milestone history live in [`HANDOFF.md`](./HANDOFF.md).

## Deploy

The app is designed for Vercel. After `vercel deploy`, set both env vars in the project settings and add your production URL to Supabase → **Authentication → URL Configuration → Site URL + Redirect URLs** so email confirmation links don't point at localhost.
