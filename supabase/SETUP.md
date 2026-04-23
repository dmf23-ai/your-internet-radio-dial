# Supabase setup — M4.1

No code to run yet. This whole milestone happens in the Supabase web dashboard plus one file you keep on your machine. After this, M4.2 will wire the app to the project you just created.

---

## 1. Create a Supabase project

1. Go to **https://supabase.com** and sign in (GitHub login is fastest).
2. Click **New project**.
3. Fill in:
   - **Name:** `your-internet-radio-dial` (anything works, this is just for you)
   - **Database password:** click **Generate**, then copy it somewhere safe — **you won't be asked to use it for M4**, but if you lose it you'd have to reset it later.
   - **Region:** pick whichever is closest to you physically.
   - **Plan:** Free.
4. Click **Create new project**. It takes ~1 minute to provision.

---

## 2. Run the schema

1. In the left sidebar, click the **SQL Editor** icon (looks like `>_`).
2. Click **+ New query**.
3. Open `supabase/schema.sql` from this repo, copy the entire file, paste it into the editor.
4. Click **Run** (or Ctrl/Cmd+Enter).
5. You should see **"Success. No rows returned."** at the bottom.

Verify by clicking **Table Editor** in the sidebar. You should see four tables:
- `stations`
- `groups`
- `memberships`
- `user_settings`

Each should have a green **RLS enabled** badge.

---

## 3. Enable anonymous sign-ins

We want users to land on the app and immediately have a real (anonymous) Supabase user, so their library syncs without a sign-up gate.

1. Sidebar → **Authentication** → **Sign In / Up** (or **Providers**, depending on UI version).
2. Find **Anonymous Sign-Ins** and toggle it **ON**. Save.

> Some Supabase UIs put this under **Authentication → Policies → Anonymous sign-ins**. If you can't find it, just search "anonymous" inside the Authentication page.

---

## 4. Grab your project keys

1. Sidebar → **Project Settings** (gear icon) → **API**.
2. Copy these two values — paste them into a note somewhere on your machine, we'll plug them into the app in M4.2:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long `eyJ...` string — **the `anon` one, NOT the `service_role` one**)

> The `service_role` key bypasses RLS. Never paste it into the frontend, never commit it anywhere. The `anon` key is safe to ship to the browser because RLS still enforces per-user access.

---

## 5. Configure email redirect URLs (for M4.4)

M4.4 lets a guest claim their library by adding an email address. Supabase sends a confirmation link; when clicked, the link has to land back on our app. You need to tell Supabase which URLs are allowed destinations.

1. Sidebar → **Authentication** → **URL Configuration**.
2. **Site URL:** set to the URL you use for dev (e.g. `http://localhost:3000`). This is the default destination for confirmation links.
3. **Redirect URLs:** add any other origins you'll test from. Good starter set:
   - `http://localhost:3000`
   - `http://localhost:3000/**` (wildcard — any path)
   - Any deployed preview URL you plan to use (e.g. a Vercel URL)
4. Save.

> If the Site URL is wrong, clicking the email link will bounce the user to a Supabase-hosted page instead of your app, and the session upgrade won't complete in-browser. Easiest symptom to diagnose: the email arrives, but clicking the link doesn't flip the AccountDrawer from "Guest" to "Signed in".

---

## 6. Done — report back

When you've finished steps 1–5, tell me:
- **"Supabase set up"**, plus
- your **Project URL** and **anon key** pasted in chat.

(These are safe to share with me. The anon key is public-by-design; I need them to wire the client in M4.2.)

Then we'll move on to M4.2:
- Install `@supabase/supabase-js` + `@supabase/ssr`
- Add `.env.local` with your keys
- Create a tiny client wrapper (`src/lib/supabase/client.ts`)
- Auto-sign-in as anonymous on first load, so `auth.uid()` exists and the sync layer has somewhere to write.

No store / audio / UI code changes in M4.2 either — just plumbing so the *next* milestone (M4.3) can actually dual-write to the cloud.
