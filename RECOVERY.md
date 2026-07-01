# Infinite CRM — Recovery Runbook

If your laptop dies, is stolen, or you need to hand this off to someone else, follow
this document top-to-bottom. Estimated time on new hardware: **~90 minutes**.

The CRM keeps running for all agents throughout — this is only about restoring your
ability to develop and deploy code changes.

---

## What survives, what dies

| Lives where | Survives laptop death? |
|-------------|:----------------------:|
| Source code (GitHub `origin/main`) | ✅ |
| Frontend build (Vercel) | ✅ |
| Database + Auth (Supabase) | ✅ |
| Email routing + Worker (Cloudflare) | ✅ |
| OAuth clients (Google Cloud) | ✅ |
| **Unpushed local commits** | ❌ |
| **`.env.local` file** | ❌ |
| Browser bookmarks (bookmarklets) | ❌ (re-drag from Settings) |

**Rule:** always push after committing. `cd ~/Downloads/infinite-crm && git push origin main`

---

## Service inventory — everything you need to know exists

### GitHub
- **URL:** https://github.com/murrayhealthadvising/infinite-crm
- **Owner:** murrayhealthadvising
- **Login:** murrayhealthadvising@gmail.com

### Vercel
- **URL:** https://vercel.com/dashboard
- **Project:** `infinite-crm` (deployed at https://infinite-crm.vercel.app)
- **Deployment:** auto-deploys on push to `main`
- **Env vars live here:** Project → Settings → Environment Variables

### Supabase
- **URL:** https://supabase.com/dashboard
- **Project:** the Infinite CRM database
- Holds: `leads`, `activities`, `tags`, `profiles`, `pitchprfct_keys`, `pitchprfct_queue`,
  `reminders`, `commission_entries`, `lead_import_errors`

### Cloudflare
- **URL:** https://dash.cloudflare.com
- **Account:** `df7ad085b96ef146f4283e22e38ceca7`
- **Worker:** `infinite-crm-webhook` (deploy via dashboard paste — no wrangler)
- **Worker URL:** https://infinite-crm-webhook.murrayhealthadvising.workers.dev
- **Email Routing:** custom addresses `{agent}-leads@infinite-crm.net` route to the worker
- **Cron Trigger:** `* * * * *` runs `scheduled()` for the PitchPrfct delay queue

### Google Cloud Console
- **URL:** https://console.cloud.google.com
- **Project ID:** `185313675930`
- OAuth client for Gmail/Calendar. If Gmail send stops working, check
  APIs & Services → Enable APIs → **Gmail API** is enabled on this project.

### Domain
- **`infinite-crm.net`** — used for lead-import email addresses
- Managed via Cloudflare (Email Routing set up under this domain)

### PitchPrfct
- **Per-agent API keys** stored in Supabase `pitchprfct_keys` table
- Each agent enters their own key in CRM Settings → PitchPrfct Automation
- The worker reads keys with the service role, so RLS doesn't block it

---

## Env vars checklist

Recreate `.env.local` at the repo root with these keys:

```
VITE_SUPABASE_URL=<from Supabase project settings → API>
VITE_SUPABASE_ANON_KEY=<from Supabase project settings → API>
VITE_GOOGLE_CLIENT_ID=<from Google Cloud → Credentials → OAuth 2.0 Client IDs>
VITE_CRM_WORKER_URL=https://infinite-crm-webhook.murrayhealthadvising.workers.dev
```

The Worker also has secrets set in the Cloudflare dashboard (not in `.env.local`):
```
SUPABASE_URL       (same as VITE_SUPABASE_URL)
SUPABASE_SERVICE_KEY   (from Supabase project settings → API → service_role)
```
Set at: Cloudflare → Workers → `infinite-crm-webhook` → Settings → Variables.

**The Vercel dashboard already has these values.** Fastest way to recover: log into
Vercel → Project → Settings → Environment Variables → view/copy each one.

---

## Recovery: step-by-step on new hardware

Assuming a fresh macOS install.

### 1. Install Node + git
```
# Install Homebrew if needed:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node git
```

### 2. Log in to GitHub in Chrome/Safari
Then either use SSH or HTTPS auth to clone:
```
mkdir -p ~/Downloads && cd ~/Downloads
git clone https://github.com/murrayhealthadvising/infinite-crm.git
cd infinite-crm
npm install
```

### 3. Recreate `.env.local`
Copy the values from Vercel Project Settings (see checklist above). Save at repo root
as `.env.local`. This file is `.gitignore`d — never commit it.

### 4. Verify local dev works
```
npm run dev
```
Should open at http://localhost:5173. Log in as `murrayhealthadvising@gmail.com`.

### 5. Deploy path check
- **Frontend:** `git push origin main` → Vercel auto-deploys within ~60s.
- **Worker:** open `cloudflare-worker/worker-v4.js` → copy contents → paste into
  Cloudflare dashboard → Workers → `infinite-crm-webhook` → Edit code → Save and Deploy.
- **Version check:** `curl https://infinite-crm-webhook.murrayhealthadvising.workers.dev/version`

---

## What to do BEFORE the laptop dies

1. **Push regularly.** `git status` should be clean; `git log origin/main..HEAD` should
   be empty. A cron/reminder to push nightly is not a bad idea.

2. **Store 2FA recovery codes** for GitHub, Vercel, Cloudflare, Supabase, and Google
   Cloud in a password manager (1Password / Bitwarden / iCloud Keychain). If your
   phone dies simultaneously and you don't have these, you're locked out of every
   service.

3. **Copy this file + a service-list note to Google Drive.** Both survive account/
   device loss and are searchable.

4. **Optional but recommended:** add a second admin to each service org so a teammate
   (Anthony? Palma?) can get in if you're incapacitated:
   - GitHub: repo settings → Collaborators
   - Vercel: Team settings → Members
   - Cloudflare: Account members
   - Supabase: Project → Settings → Team

---

## Common recovery scenarios

**"I lost my laptop and I'm at a coworking space with a Chromebook."**
You can push commits from any browser via github.com's web editor. Not comfortable for
big changes but fine for a quick fix. All other services are also browser-manageable.

**"My laptop is fine but I can't remember what the deployed worker version is."**
```
curl https://infinite-crm-webhook.murrayhealthadvising.workers.dev/version
```

**"USHA leads stopped arriving."**
Cloudflare Email Routing hit a snag. Check: Cloudflare → Email → Email Routing →
Custom addresses → all `*-leads@infinite-crm.net` addresses show "Active".

**"Gmail send is broken."**
Check https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=185313675930
— Gmail API needs to be enabled.

**"An agent says leads aren't auto-enrolling."**
The `pitchprfct_queue` cron runs every minute. Check the Cloudflare Worker logs
`Observability → Events`, filter for `[pp]` or the lead's UUID. Also check
Supabase `pitchprfct_queue` for stuck rows.

**"I want to check what's in the DB right now."**
Supabase dashboard → Table Editor → pick the table. Or SQL Editor for queries.

---

*Last updated: keep this doc current whenever a new service is added or a URL changes.*
