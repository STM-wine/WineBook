# Stem Intelligence Web App

This is the production Next.js app for the ordering dashboard. The Python ingestion/calculation
pipeline stays in the repo and continues writing completed report runs to Supabase; this app reads
those persisted snapshots through Supabase Auth and the public Data API.

Production URL: `https://stmhq.com`

Render service URL: `https://winebook.onrender.com`

## Local Setup

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

Never put `SUPABASE_SERVICE_ROLE_KEY` in this app. Service-role access belongs only in trusted
Python workers, migrations, and server-side maintenance scripts.

## Auth Model

Supabase Auth is the login provider. For the first release, add each allowed employee in Supabase
Auth and create a matching `public.app_profiles` row:

```sql
insert into public.app_profiles (id, email, full_name, role)
values ('auth-user-uuid', 'buyer@stemwinecompany.com', 'Buyer Name', 'buyer');
```

The web app signs users in, then requires an `app_profiles` row before showing ordering data.

The starter allowlist lives at `../../supabase/seed_app_profiles.sql` and currently includes:

- Junaid Dawud, `jdawud@gmail.com`
- Stem Wine Company, `stm@stemwinecompany.com`

Create or invite those users in Supabase Auth first, then run the seed SQL.

Buyer/admin profiles can autosave recommendation approvals after applying the
`recommendation_buyer_update_policy` migration.

## Render

Current Render settings:

- Root directory: `apps/web`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Runtime: Node
- Node version: `20`

Production environment variables:

- `NODE_VERSION=20`
- `NEXT_PUBLIC_SITE_URL=https://stmhq.com`
- `NEXT_PUBLIC_SUPABASE_URL=https://hpnvlxvnzpojpfepcerl.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>`

Required Supabase Auth redirect URLs:

- `https://stmhq.com/auth/callback`
- `https://www.stmhq.com/auth/callback`
- `https://winebook.onrender.com/auth/callback`
- `http://localhost:3000/auth/callback`
