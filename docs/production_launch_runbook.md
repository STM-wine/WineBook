# Production Launch Runbook

Last updated: 2026-05-21

Target production domain: `https://stmhq.com`

Current status: deployed on Render and reachable at `https://stmhq.com`. DNS is verified for both `stmhq.com` and `www.stmhq.com`; if Render still shows a certificate as pending, wait for certificate issuance to complete.

## 1. GitHub

The Next.js app has been merged into `main`.

Repository: `https://github.com/STM-wine/WineBook`

Important paths:

- Next.js app root: `apps/web`
- Render blueprint: `render.yaml`
- PO XLSX template: `apps/web/templates/po_draft_template_stm.xlsx`

## 2. Render Web Service

Create the hosted app as a Render Web Service, not a static site. The app uses Next.js server routes and Supabase SSR cookies.

Recommended setup:

- Source repo: `STM-wine/WineBook`
- Branch: `main`
- Runtime: `Node`
- Root directory: `apps/web`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Node version: `20`

Required environment variables:

```text
NODE_VERSION=20
NEXT_PUBLIC_SITE_URL=https://stmhq.com
NEXT_PUBLIC_SUPABASE_URL=https://hpnvlxvnzpojpfepcerl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>
```

Do not add `SUPABASE_SERVICE_ROLE_KEY` to the web service.

## 3. Render Custom Domain

The current Render service hostname is:

```text
winebook.onrender.com
```

After the service deploys successfully on its `*.onrender.com` URL:

1. Open the Render service.
2. Go to Settings -> Custom Domains.
3. Add `stmhq.com`.
4. Add or verify `www.stmhq.com` redirects to `stmhq.com`.
5. Keep the Render `onrender.com` subdomain enabled until the custom domain is verified and Supabase Auth is updated.

## 4. GoDaddy DNS

In GoDaddy DNS for `stmhq.com`:

1. Remove any old WebsiteBuilder or conflicting apex records.
2. Remove any `AAAA` records for the domain.
3. For the root/apex domain, use:
   - `A` record:
     - Host: `@`
     - Value: `216.24.57.1`
4. For `www`:
   - Type: `CNAME`
   - Host: `www`
   - Value: `winebook.onrender.com`

Current GoDaddy records should include:

```text
A      @     216.24.57.1
CNAME  www   winebook.onrender.com.
```

After DNS propagates, return to Render and click Verify for the custom domains.

## 5. Supabase Auth URL Configuration

In Supabase:

1. Go to Authentication -> URL Configuration.
2. Set Site URL:

```text
https://stmhq.com
```

3. Add Redirect URLs:

```text
https://stmhq.com/auth/callback
https://www.stmhq.com/auth/callback
https://winebook.onrender.com/auth/callback
http://localhost:3000/auth/callback
```

The app sends Google OAuth users to `/auth/callback`, so these exact callback URLs must be allowed.

## 6. Supabase Google Provider

If Google login is enabled through Supabase Auth, confirm the Google provider is still configured correctly in Supabase Authentication -> Providers.

If Google Cloud requires an authorized redirect URI, use the Supabase project callback URL shown in the Supabase Google provider settings, not the app callback URL.

## 7. Smoke Test

After deploy and DNS verification:

1. Open `https://stmhq.com`.
2. Confirm unauthenticated users are redirected to `/login`.
3. Log in as `jdawud@gmail.com`.
4. Confirm latest report data loads.
5. Confirm Order Review editing does not jump scroll position.
6. Approve one low-risk test line.
7. Create PO Drafts.
8. Open PO Drafts and confirm:
   - Line appears.
   - Laid-in cost appears.
   - Estimated cost includes wine plus laid-in cost.
   - XLSX download works.
9. Cancel or remove test draft/line if needed.

## 8. Known Deferred Items

- Supplier Hub catalog subtabs need persistent schema before they are useful in hosted Next.js.
- DI / Ant Moore logic remains post-migration.
- QuickBooks writeback remains post-V1.

## 9. Routine Deploys

Render is connected to `main` and auto-deploys on push. For a routine release:

1. Commit and push to `main`.
2. Watch the Render deploy log until the service is live.
3. Smoke test `https://stmhq.com/login`.
4. Confirm a buyer can load Order Review and the latest report run.
