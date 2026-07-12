# Play Store Release Checklist

Status as of this checklist being written. Check items off as you complete them.

## Done (this session)

- [x] Fixed hardcoded JWT secret -- now reads `JWT_SECRET_KEY` from the
      environment with a safe random fallback for local dev (see README's
      Backend Deployment section for the Render setting).
- [x] Added `DELETE /auth/me` account deletion (endpoint + "Delete Account"
      button in the sidebar menu) -- Google Play requires this for any app
      that supports account creation.
- [x] Added a PWA manifest, service worker (via `vite-plugin-pwa`), and a
      full icon set (`public/icons/`) -- this is the prerequisite for
      wrapping the site as an Android app.
- [x] Drafted `PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` -- **placeholders
      inside still need filling in and a lawyer's eyes before this is real.**
- [x] Added a placeholder `public/.well-known/assetlinks.json` -- needs the
      real values filled in during the TWA step below.

## What's left, in order

### 1. Deploy the updated frontend and backend

The PWA manifest/service worker only matter once they're live on your real
domain. Push these changes, redeploy the frontend (GitHub Pages) and backend
(Render), and set the `JWT_SECRET_KEY` environment variable on Render.

Verify after deploying: visit the live site, open DevTools -> Application ->
Manifest, and confirm it loads with no errors. Chrome should offer an
"Install" icon in the address bar.

### 2. Host the Privacy Policy and Terms of Service publicly

Play Console requires a **URL**, not a file in your repo. Options:
- Add them as routes/pages in the deployed site (simplest if you want one
  less moving part), or
- Publish the two markdown files as their own GitHub Pages content.

Fill in every `[BRACKETED]` placeholder in both files first, and get a
lawyer's review given this app handles financial data and gives investment
recommendations -- that combination draws more scrutiny than a typical app.

### 3. Decide on real subscription billing

Right now "Premium" is a manual flag flip (`POST /auth/upgrade`), fine for a
demo but not for real users. If you want real subscriptions distributed
through the Play Store, Google **requires** using Google Play Billing for
digital subscriptions -- you can't just charge cards directly via Stripe for
content unlocked inside a Play Store app. Decide:
- Use Google Play Billing (needed if selling subscriptions through Play), or
- Keep it web-only / manual for this first release and revisit later.

Either way, update the Terms of Service section 4 with real billing terms
before launch.

### 4. Wrap the PWA as a Trusted Web Activity (TWA)

This is what actually produces the Android app. Once the site is deployed
live with the manifest/service worker from step 1:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest="https://your-deployed-url/Finance-Calculator/manifest.webmanifest"
```

Bubblewrap will ask a few questions (package name like
`com.yourname.financebacktester`, app name, signing key) and generate a
full Android Studio project in a new folder -- this is a separate project
from this repo, not something that lives inside it.

```bash
bubblewrap build
```

This produces a signed `.aab` file (or `.apk` for testing) plus prints the
**SHA256 fingerprint** of your signing key.

### 5. Fill in the real Digital Asset Links

Take the package name and SHA256 fingerprint from step 4 and put them into
`public/.well-known/assetlinks.json` (replacing the placeholders), then
redeploy the frontend. This file is what proves to Android that your app and
your website are the same entity -- without it, the TWA shows a browser
address bar instead of looking like a native app.

Verify with Google's tool:
`https://developers.google.com/digital-asset-links/tools/generator`

### 6. Google Play Console setup (your account, not something I can do)

- Register a Play Console developer account ($25 one-time fee, identity
  verification required -- can take a few days).
- Create a new app listing.
- Fill in the **Data Safety** section accurately based on
  `PRIVACY_POLICY.md` -- what's collected (email, hashed password, watchlist
  symbols, subscription tier), whether it's shared with third parties (no),
  and link your hosted privacy policy.
- Upload store listing assets: screenshots (phone + optionally tablet),
  feature graphic, app icon (already generated at
  `public/icons/icon-512.png`), short and full description.
- Set the app category -- likely **Finance**. Finance-category apps
  sometimes get extra review scrutiny; the in-app disclaimers ("Educational
  information only, not financial advice") already present throughout the
  app help here, but expect a possibly longer review than average.
- Upload the signed `.aab` from step 4 to an internal testing track first,
  test on a real device, then promote to production when ready.

## Also worth doing before a real public launch (not blocking submission)

- **Rate limiting / abuse protection.** The recommendations engine runs ~22
  live market screens plus ~100+ ticker lookups per cache miss; nothing
  currently stops one user from hammering it. Consider basic rate limiting
  (e.g. `slowapi`) before this is public.
- **Error monitoring.** No production error tracking (e.g. Sentry) is wired
  up -- you'll be flying blind on crashes/exceptions after launch.
- **Automated tests.** There's no test suite yet. Not a Play Store
  requirement, but worth having before you're iterating against real users.
- **Hosting reliability.** Confirm the Render backend plan doesn't spin down
  on inactivity -- a cold start on first launch is a bad first impression.
