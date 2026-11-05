# Texa Fashions OS (Firebase demo)

Omnichannel retail ERP demo for Texa Fashions. See [CLAUDE.md](CLAUDE.md) for the overview and [docs/](docs/) for architecture, flows and migration notes.

The app talks to a **real Firebase project** (no emulators). Web and POS are Next.js apps (Vercel); the backend is Firebase (Auth, Firestore, Functions, Storage, RTDB).

## One-time Firebase setup
1. Create a project at https://console.firebase.google.com (e.g. `texafashions-demo`) and **upgrade to Blaze** (required for Cloud Functions; demo usage stays in the free quota).
2. Enable: **Authentication** (Email/Password), **Firestore** (location `asia-south1`, production mode), **Storage**, **Realtime Database**.
3. Project settings → Your apps → add a **Web app** and copy the SDK config.
4. Put your project id in `.firebaserc`, then:
   ```bash
   pnpm install
   npx firebase login
   pnpm deploy:backend          # builds + deploys functions and rules
   ```
5. Seed the data (needs a service account: Project settings → Service accounts → Generate key):
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
   export FIREBASE_PROJECT_ID=<project-id>
   pnpm seed
   ```
6. Optional: `functions/.secret.local` is emulator-only; for Claude features run `npx firebase functions:secrets:set ANTHROPIC_API_KEY`.

## Run locally
```bash
cp .env.example apps/web/.env.local   # fill in the Firebase web config
cp .env.example apps/pos/.env.local
pnpm dev                              # web http://localhost:3100 · pos http://localhost:3101
```
Pick a role on the login screen. Try: Buyer → edit a SKU price → switch to CFO → Approvals → approve.

## Deploy to Vercel (two projects from this one repo)
Push the repo to GitHub, then in Vercel create **two projects** from it:

| | Web (back-office) | POS |
|---|---|---|
| Root Directory | `apps/web` | `apps/pos` |
| Framework | Next.js | Next.js |
| Install Command | `cd ../.. && pnpm install` | same |
| Build Command | `cd ../.. && pnpm turbo run build --filter=@texafashions/web` | `... --filter=@texafashions/pos` |

Enable "Include source files outside of the Root Directory" in both. Add the `NEXT_PUBLIC_FIREBASE_*` variables from `.env.example` to each project (Settings → Environment Variables), then redeploy.
Finally, in Firebase Console → Authentication → Settings → **Authorized domains**, add both `*.vercel.app` hostnames (and any custom domain).

## Notes
- Demo login (role switcher) is on by default; set `ALLOW_DEMO_LOGIN=false` on the functions to disable it.
- "Reset demo data" in Admin cannot run on Vercel; re-run `pnpm seed` from your machine.
- Store Twin simulator: `pnpm twin:sim PUN-PMC MUM-PMC` (same service-account env vars).
- `pnpm test:rules` and `tests/smoke` are legacy emulator-based dev tests and are not part of the demo flow.
