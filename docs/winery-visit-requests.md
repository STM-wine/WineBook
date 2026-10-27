# Winery Visit Requests: implementation and rollout

This module is local source work. It is not deployed. No visit-only users have
been invited and visit notification email is disabled by default.

## Safety boundary

The existing `authenticated` database role has broad access to legacy tables
and functions. The new `visit_sales` Auth profile role must receive the separate
Postgres `visit_sales` JWT role from `stem_visit_access_token_hook`. That database
role can read only its own app profile and permission rows. All visit data is
served by checked server endpoints; direct Data API access to visit tables is
denied. Middleware blocks visit-only accounts from legacy pages and APIs.

The migration moves existing PUBLIC function execution grants to the original
Supabase roles and fails if the isolated role can access a legacy public
relation or function. The Auth hook must be configured in Supabase after the
migration. Keep `VISIT_SALES_ROLE_READY` unset until a synthetic account passes
the tests below. Existing authenticated accounts cannot be converted to
visit-only because their old JWT may retain broader rights until it expires.

## External setup still required

1. Apply `20261027120000_winery_visit_requests.sql` to a nonproduction copy.
2. Configure `public.stem_visit_access_token_hook` as the Supabase Custom Access
   Token hook. Verify its output `claims.role` is `visit_sales` for a synthetic
   visit profile and for a synthetic account with no profile, while an existing
   buyer remains `authenticated`.
3. Check direct REST select and RPC calls with each token. The visit token must
   receive permission denied for sales, finance, product, ordering, and lead
   data, as well as legacy `SECURITY DEFINER` functions. Also test private
   Storage buckets. Test direct app URLs and APIs with the same token.
4. Configure `RESEND_API_KEY`, `VISIT_EMAIL_FROM`, and `NEXT_PUBLIC_SITE_URL`.
   Set `VISIT_EMAIL_ENABLED=true` only after approval for live mail. Resend's
   idempotency key is valid for 24 hours; uncertain delivery outcomes are held
   in `unknown` for manual review rather than retried after that window.
5. After verification, set `VISIT_SALES_ROLE_READY=true` to enable new sales
   invitations. Do not convert existing active logins to the isolated role.

## Workflow

Drafts have a UUID and are visible to the requester and admins. Submission
atomically numbers the request, records an event, and inserts a manager handoff
into the notification outbox. A missing manager leaves the request visible in
the admin review queue. Requester edits while `Needs Information` queue a
manager update. Manager status changes atomically queue a requester update.
Confirmation requires explicit winery evidence, local date and start time,
location, fee conditions, confirming user, and timestamp. Requested and
confirmed schedules are stored separately.

Producer choices are seeded from current VinoSmith wine and supplier catalog
producer names into a visit-specific mapping table. New producer names require
an admin mapping; this never creates a producer master record. VinoSmith
accounts are searched server-side from the private cache. A typed unlisted
account is marked for admin review and never writes to VinoSmith.

## Remaining verification and gaps

- Run the migration against a nonproduction database and check its catalog
  assertions; local type checking cannot validate deployed Postgres grants.
- Add an automated source refresh for producer names added after migration.
- Exercise synthetic salesperson and brand-manager flows, email failure paths,
  cross-user edits, guest-count and timezone edge cases, and the full existing
  app test suite before rollout.
