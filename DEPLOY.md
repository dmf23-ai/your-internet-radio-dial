# Deployment walkthrough — Your Internet Radio Dial

End-to-end guide for first push to GitHub, deploy to Vercel, configure Supabase for production, and wire up suggestion-box email notifications.

Estimated total time: **45–75 minutes** (most of it sign-ups and waiting on builds).

---

## Part 1 — Local prep (5 min)

Run these from a terminal in the project folder.

### 1.1 — Verify the build is green

```bash
npm run build
```

Vercel uses `next build` under the hood, so anything that errors here will block the deploy. If you see warnings (eslint complaints, deprecated API notes) those are usually fine; *errors* must be fixed.

### 1.2 — Check `.env.local` is gitignored

PowerShell (Windows):

```powershell
Get-Content .gitignore | Select-String "env"
```

…or just `type .gitignore` to dump the whole short file.

bash / zsh (macOS, Linux, WSL, Git Bash):

```bash
cat .gitignore | grep env
```

You should see `.env*.local` (or similar) listed. If you don't, add a line `.env*.local` to `.gitignore` before committing — your Supabase URL/anon key live in `.env.local` and should NOT be pushed to GitHub.

(The anon key is technically safe to publish — Row Level Security protects the data — but it's still better hygiene to keep it out of the public repo.)

> **Note on shell**: This guide shows POSIX-style shell commands (`cat`, `grep`, etc.). On Windows you have a few options: PowerShell uses different verbs (`Get-Content`, `Select-String`); the legacy Command Prompt has `type` / `findstr`; or you can install **Git Bash** (which comes with Git for Windows) to get the POSIX commands. The `git` and `npm` commands themselves are identical on every shell.

### 1.3 — Initialize git + first commit

```bash
git init
git add .
git commit -m "Initial commit — through M13 + seed-band repair"
```

---

## Part 2 — Push to GitHub (5 min)

### 2.1 — Create a new GitHub repo

Go to <https://github.com/new>. Suggested settings:

- **Repository name**: `your-internet-radio-dial` (or whatever you like)
- **Visibility**: Private is fine — Vercel works with both. Public is fine too if you want others to see the code.
- **Initialize**: leave all the "add a README/.gitignore/license" boxes UNCHECKED. You're pushing existing code, so an empty remote is what you want.

Click **Create repository**.

### 2.2 — Push

GitHub will show you a "push existing repository" snippet. It looks like:

```bash
git remote add origin https://github.com/YOUR_USERNAME/your-internet-radio-dial.git
git branch -M main
git push -u origin main
```

Run those three lines. After the push completes, refresh the GitHub page — your code should be there.

---

## Part 3 — Deploy to Vercel (10 min)

### 3.1 — Sign in to Vercel with GitHub

Go to <https://vercel.com>. Click **Sign Up** (or **Log In**) and choose **Continue with GitHub**. Vercel will ask for permission to read your repos — say yes.

### 3.2 — Import the repo

On your Vercel dashboard, click **Add New… → Project**. You'll see a list of your GitHub repos. Find your radio-dial repo and click **Import**.

### 3.3 — Configure the project

Vercel will auto-detect that this is a Next.js project — leave **Framework Preset** as Next.js. Don't touch **Build & Development Settings**.

The important part: expand **Environment Variables** and add these two (copy them verbatim from your local `.env.local` file):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (long JWT) |

Click **Deploy**.

### 3.4 — Wait for the build

The build takes 2–4 minutes. Watch the live log if you like — common-error early-warning is the same set of `npm run build` errors you'd see locally.

When it's green, Vercel gives you a production URL: something like `https://your-internet-radio-dial.vercel.app`. **Copy this URL** — you need it for Part 4.

Click **Visit** to make sure the site loads. Don't worry that magic-link sign-in won't work yet — that's what Part 4 fixes.

---

## Part 4 — Supabase production config (5 min)

### 4.1 — Add the Vercel URL to allowed redirects

This is the step that makes magic-link sign-in work in production. Without it, the email confirmation link points at `localhost:3000` and breaks.

In your Supabase project dashboard:

1. **Authentication → URL Configuration** (sidebar)
2. **Site URL**: set to your Vercel production URL (e.g. `https://your-internet-radio-dial.vercel.app`). This becomes the default redirect for auth emails.
3. **Redirect URLs**: add an entry `https://your-internet-radio-dial.vercel.app/**` (note the trailing `/**` so any path under your domain is allowed).
4. Click **Save**.

You can leave `http://localhost:3000` and `http://localhost:3000/**` in the list — they're useful for local development.

### 4.2 — Verify the schema is applied

In Supabase, **Table Editor** (sidebar). You should see five tables:

- `stations`
- `groups`
- `memberships`
- `user_settings`
- `suggestions`

If `suggestions` is missing, open `supabase/schema.sql` in your project, copy the whole "Suggestions" section (lines 183-227), paste into Supabase **SQL Editor**, and click **Run**. The whole file is idempotent so you can also re-run all of it safely.

### 4.3 — Smoke test

Open your Vercel URL in an incognito window. Tune the dial, switch bands, open the Suggestion Box, drop a test suggestion, sign up with your email. The confirmation link should now open the production site, not localhost.

---

## Part 5 — Suggestion-box email notifications (20–40 min)

You'll wire up: **Suggestion Box (browser) → Supabase row inserted → Database Webhook → Supabase Edge Function → Resend → email to your inbox**.

### 5.1 — Sign up for Resend

Resend is the email-sending service. Free tier is 3,000 emails/month — way more than you'll ever need for personal suggestion-box traffic.

1. Go to <https://resend.com> and sign up (Continue with GitHub works).
2. After signing in, go to **API Keys** (sidebar) → **Create API Key**.
   - Name: `radio-dial-suggestions`
   - Permission: **Sending access** (default)
   - Domain: **All domains**
3. Copy the API key (starts with `re_`). **You only see it once** — paste it somewhere safe for the next step.

For the *from address*, you can either verify your own domain (more setup) or use Resend's default test address `onboarding@resend.dev`. Test address is fine for personal use; you can upgrade later.

### 5.2 — Create the Edge Function in Supabase

In your Supabase project:

1. **Edge Functions** (sidebar — under "Database" group, look for the lambda icon) → **Deploy a new function**.
2. **Function name**: `notify-suggestion`
3. **Code**: paste the contents of `supabase/functions/notify-suggestion/index.ts` (I created this file in your project — open it and copy everything).
4. Click **Deploy function**.

You can also deploy via the Supabase CLI if you prefer, but the dashboard's inline editor works fine for a one-off function like this.

### 5.3 — Add the Resend API key as a function secret

The Edge Function reads the API key from an environment variable so it isn't hardcoded.

In Supabase: **Edge Functions → Secrets** (or the "Manage secrets" link on the function detail page) → **Add new secret**.

Add three secrets:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | `re_...` (the key from step 5.1) |
| `NOTIFY_TO` | `dmf23@dawgranch.org` (or wherever you want the alerts) |
| `NOTIFY_FROM` | `onboarding@resend.dev` (or your verified domain address) |

Save. The function will pick these up automatically on next invocation.

### 5.4 — Create the Database Webhook

This is what fires the Edge Function on every new suggestion row.

In Supabase: **Database → Webhooks** (sidebar) → **Create a new webhook**.

Settings:

- **Name**: `notify-suggestion-on-insert`
- **Table**: `suggestions` (in `public` schema)
- **Events**: check **INSERT** only
- **Type**: **Supabase Edge Functions**
- **Edge Function**: `notify-suggestion` (the one you just deployed)
- **HTTP Method**: `POST`
- **HTTP Headers**: leave defaults — Supabase auto-includes the right auth header
- **HTTP Params**: leave empty
- **Timeout**: 1000ms is fine

Click **Create webhook**.

### 5.5 — End-to-end test

1. Open your Vercel production URL.
2. Click the brass **SUGGESTION BOX** plate in the upper-left of the cabinet.
3. Submit a test ("station nomination" tab — fill in name `Test Station`, URL `https://example.com/test.mp3`, hit submit).
4. Check your inbox at `dmf23@dawgranch.org`. The email should arrive within 5–10 seconds.
5. If it doesn't show: in Supabase, **Database → Webhooks → notify-suggestion-on-insert → Logs**. Each invocation has a status code. 200 = success; anything else has the error in the response body.
6. Common gotchas:
   - Wrong `RESEND_API_KEY` → 401 from Resend.
   - `NOTIFY_FROM` set to a domain you haven't verified → 403 from Resend.
   - Email goes to spam — check there. Add `onboarding@resend.dev` to your contacts to whitelist.

---

## Part 6 — Done. What to do next

- **Custom domain (optional)**: in Vercel, **Settings → Domains** → add your domain (e.g. `radio.dawgranch.org`). Vercel will tell you what DNS records to add. Once it's live, update Supabase **URL Configuration** to use the new domain instead of `*.vercel.app`.
- **Verify your own email domain in Resend (optional)**: lets you send from `suggestions@dawgranch.org` instead of `onboarding@resend.dev`. Resend has a 5-minute walkthrough.
- **Watch the Vercel logs** for the first few real users — `Vercel → Project → Logs` shows runtime errors from `/api/stream`, `/api/hls`, `/api/now-playing`. Stream-source flakiness is normal (some stations go down for hours at a time).

---

## Troubleshooting cheatsheet

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Vercel build fails on `next build` | TypeScript or eslint error | Fix locally first with `npm run build`. |
| Site loads but stations all show "Signal Lost" | Env vars not set on Vercel, or stream proxy hitting CORS | Verify env vars; check Vercel Logs for `/api/stream` errors. |
| Magic-link email opens localhost | Site URL not updated in Supabase | Part 4.1 — set Site URL to Vercel domain. |
| Suggestion box submits succeed but no email | Webhook misconfigured or Resend key wrong | Part 5.5 — check webhook logs in Supabase. |
| "Around the World" / "Exploratorium" still empty | New `restoreEmptySeedBands` repair didn't run yet | Hard-refresh the production site once. The repair runs on hydrate. |
