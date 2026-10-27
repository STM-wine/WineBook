-- Winery Visit Requests. This migration is deliberately inert for sales logins
-- until the Custom Access Token hook below is enabled and verified in Supabase.
-- Existing authenticated users retain their current database privileges.

alter table public.app_profiles drop constraint if exists app_profiles_role_check;
alter table public.app_profiles add constraint app_profiles_role_check
  check (role in ('viewer', 'buyer', 'admin', 'visit_sales'));

alter table public.app_profile_permissions drop constraint if exists app_profile_permissions_permission_check;
alter table public.app_profile_permissions add constraint app_profile_permissions_permission_check
  check (permission in (
    'view_settings', 'view_logic_settings', 'request_logic_change',
    'draft_logic_changes', 'publish_logic_changes', 'manage_user_access',
    'manage_supplier_settings', 'view_settings_history', 'visit_access',
    'visit_manage_assigned'
  ));

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'visit_sales') then
    create role visit_sales nologin noinherit;
  end if;
end $$;
grant visit_sales to authenticator;
grant usage on schema public to visit_sales;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. Preserve access for
-- the existing Supabase roles while removing inherited EXECUTE from the new,
-- isolated visit_sales database role. Repeat this audit for future migrations.
do $$
declare f record;
begin
  for f in
    select p.oid, format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)) as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f.signature);
    execute format('revoke execute on function %s from public', f.signature);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- Custom DB roles cannot call auth.uid() on hosted Supabase. Read only the
-- signed JWT subject from PostgREST's request setting instead.
create function public.visit_request_user_id() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
revoke all on function public.visit_request_user_id() from public;
grant execute on function public.visit_request_user_id() to visit_sales;
grant select on public.app_profiles, public.app_profile_permissions to visit_sales;
create policy "visit sales can read own profile" on public.app_profiles
  for select to visit_sales using (id = public.visit_request_user_id());
create policy "visit sales can read own permissions" on public.app_profile_permissions
  for select to visit_sales using (profile_id = public.visit_request_user_id());

-- Enable this hook under Authentication > Hooks only after verifying the role
-- isolation and direct Data API denial with a synthetic sales account.
create function public.stem_visit_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  select role into v_role from public.app_profiles
    where id = (event ->> 'user_id')::uuid;
  -- Unknown/pending profiles also receive the isolated role. This closes the
  -- interval between Auth invitation creation and app profile insertion.
  if v_role = 'visit_sales' or v_role is null then
    return jsonb_set(event, '{claims,role}', '"visit_sales"'::jsonb, true);
  end if;
  return event;
end $$;
revoke all on function public.stem_visit_access_token_hook(jsonb) from public;
grant execute on function public.stem_visit_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

create sequence public.visit_request_number_seq;

create table public.visit_producers (
  id uuid primary key default gen_random_uuid(),
  source_name text not null unique,
  normalized_name text not null unique,
  display_name text not null,
  timezone text,
  manager_user_id uuid references public.app_profiles(id),
  active boolean not null default true,
  updated_by uuid references public.app_profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.visit_producers(source_name, normalized_name, display_name)
select distinct on (lower(btrim(name))) btrim(name), lower(btrim(name)), btrim(name)
from (
  select producer_name as name from public.vinosmith_wines
  union all
  select producer as name from public.supplier_catalog_wines
) source
where nullif(btrim(name), '') is not null
order by lower(btrim(name)), btrim(name)
on conflict (normalized_name) do nothing;

create table public.visit_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text unique,
  requester_id uuid not null references public.app_profiles(id),
  requester_name text not null,
  requester_email text not null,
  producer_id uuid references public.visit_producers(id),
  producer_name text,
  producer_needs_review boolean not null default false,
  manager_user_id uuid references public.app_profiles(id),
  winery_timezone text,
  account_id text,
  account_name text,
  account_needs_review boolean not null default false,
  visitor_type text check (visitor_type in ('trade', 'consumer')),
  requested_start_date date,
  requested_end_date date,
  date_flexible boolean,
  alternate_dates text,
  requested_start_time time,
  requested_end_time time,
  time_flexible boolean,
  experience text check (experience in ('tasting','tour','tasting_and_tour','meal','other')),
  simpler_alternative_ok boolean,
  party_size integer check (party_size between 1 and 50),
  trip_reference text,
  status text not null default 'Draft' check (status in (
    'Draft','Submitted','Needs Information','In Progress','Awaiting Winery',
    'Confirmed','Declined','Cancelled','Completed'
  )),
  confirmed_date date,
  confirmed_start_time time,
  confirmed_end_time time,
  confirmed_location text,
  winery_confirmation text,
  confirmed_fee_conditions text,
  confirmed_by uuid references public.app_profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  lock_version bigint not null default 1,
  check (requested_end_date is null or requested_start_date is null or requested_end_date >= requested_start_date),
  check (status <> 'Confirmed' or (
    winery_confirmation is not null and confirmed_date is not null and
    confirmed_start_time is not null and confirmed_location is not null and
    confirmed_by is not null and confirmed_at is not null
  ))
);
create index visit_requests_requester_idx on public.visit_requests(requester_id, updated_at desc);
create index visit_requests_manager_idx on public.visit_requests(manager_user_id, status, updated_at desc);
create index visit_requests_status_idx on public.visit_requests(status, requested_start_date);

create table public.visit_request_details (
  request_id uuid primary key references public.visit_requests(id) on delete cascade,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  contact_role text,
  visitor_relationship text,
  experience_other text,
  support_status text check (support_status in ('none','unknown','details')),
  support_details text,
  purpose text,
  adult_count integer check (adult_count between 1 and 50),
  child_count integer check (child_count between 0 and 49),
  adult_guests jsonb not null default '[]'::jsonb,
  child_ages jsonb not null default '[]'::jsonb,
  dietary_status text check (dietary_status in ('none','details')),
  dietary_details text,
  accessibility_needs text,
  transportation_help boolean,
  lodging text,
  fee_expectations text,
  expected_payer text,
  language_requirements text,
  travel_constraints text,
  winery_notes text,
  internal_context text,
  internal_assessment text,
  itinerary_path text
);

create table public.visit_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_requests(id) on delete cascade,
  actor_id uuid references public.app_profiles(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index visit_request_events_request_idx on public.visit_request_events(request_id, created_at);

create table public.visit_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_requests(id) on delete cascade,
  recipient_user_id uuid references public.app_profiles(id),
  recipient_email text not null,
  kind text not null check (kind in ('submitted','information_updated','status_updated')),
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','unknown')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index visit_notification_outbox_status_idx on public.visit_notification_outbox(status, created_at);

alter table public.visit_producers enable row level security;
alter table public.visit_requests enable row level security;
alter table public.visit_request_details enable row level security;
alter table public.visit_request_events enable row level security;
alter table public.visit_notification_outbox enable row level security;
revoke all on public.visit_producers, public.visit_requests,
  public.visit_request_details, public.visit_request_events,
  public.visit_notification_outbox from anon, authenticated, visit_sales;
grant all on public.visit_producers, public.visit_requests,
  public.visit_request_details, public.visit_request_events,
  public.visit_notification_outbox to service_role;
grant usage, select on sequence public.visit_request_number_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-itineraries', 'visit-itineraries', false, 10485760,
  array['application/pdf','image/png','image/jpeg'])
on conflict (id) do nothing;

-- Service-role API calls use this function so submission, numbering, audit and
-- the single internal handoff are one database transaction.
create function public.submit_visit_request(p_request_id uuid, p_actor_id uuid, p_version bigint)
returns public.visit_requests
language plpgsql security definer set search_path = '' as $$
declare v public.visit_requests; d public.visit_request_details; recipient_email text;
begin
  select * into v from public.visit_requests where id = p_request_id for update;
  if not found or v.requester_id <> p_actor_id then raise exception 'Request not found or forbidden'; end if;
  if v.status <> 'Draft' then return v; end if;
  if v.lock_version <> p_version then raise exception 'Request changed; reload before submitting'; end if;
  select * into d from public.visit_request_details where request_id = p_request_id;
  if v.producer_name is null or v.winery_timezone is null or v.requested_start_date is null
     or v.date_flexible is null or v.requested_start_time is null or v.time_flexible is null
     or v.experience is null or v.simpler_alternative_ok is null or v.visitor_type is null
     or v.party_size is null or d.primary_contact_name is null or d.primary_contact_email is null
     or d.primary_contact_phone is null or d.purpose is null or d.support_status is null
     or d.dietary_status is null or d.adult_count is null or d.child_count is null
     or d.adult_count + d.child_count <> v.party_size
     or (v.visitor_type = 'trade' and v.account_id is null and not v.account_needs_review)
  then raise exception 'Request is incomplete'; end if;
  update public.visit_requests set
    request_number = 'WV-' || to_char(current_date, 'YYYY') || '-' ||
      lpad(nextval('public.visit_request_number_seq')::text, 6, '0'),
    status = 'Submitted', submitted_at = now(), updated_at = now(),
    lock_version = lock_version + 1
  where id = p_request_id returning * into v;
  insert into public.visit_request_events(request_id, actor_id, event_type)
    values (p_request_id, p_actor_id, 'submitted');
  if v.manager_user_id is not null then
    select email into recipient_email from public.app_profiles where id = v.manager_user_id;
    if recipient_email is not null then
      insert into public.visit_notification_outbox
        (request_id, recipient_user_id, recipient_email, kind, payload, idempotency_key)
      values (v.id, v.manager_user_id, recipient_email, 'submitted',
        jsonb_build_object('request_number', v.request_number,
          'requester', v.requester_name, 'producer', v.producer_name,
          'requested_date', v.requested_start_date, 'party_size', v.party_size),
        'visit-submitted-' || v.id::text);
    end if;
  end if;
  return v;
end $$;
revoke all on function public.submit_visit_request(uuid,uuid,bigint) from public, anon, authenticated, visit_sales;
grant execute on function public.submit_visit_request(uuid,uuid,bigint) to service_role;

create function public.set_visit_request_status(
  p_request_id uuid, p_actor_id uuid, p_version bigint, p_status text,
  p_message text default null, p_confirmation jsonb default '{}'::jsonb
) returns public.visit_requests
language plpgsql security definer set search_path = '' as $$
declare v public.visit_requests; v_actor_role text; v_can_manage boolean;
begin
  select * into v from public.visit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  select role into v_actor_role from public.app_profiles where id = p_actor_id;
  select exists(select 1 from public.app_profile_permissions
    where profile_id = p_actor_id and permission = 'visit_manage_assigned') into v_can_manage;
  if v_actor_role <> 'admin' and not (v.manager_user_id = p_actor_id and v_can_manage)
    then raise exception 'Not assigned to coordinate this request'; end if;
  if v.lock_version <> p_version then raise exception 'Request changed; reload before updating'; end if;
  if v.status = 'Draft' or p_status not in
    ('Needs Information','In Progress','Awaiting Winery','Confirmed','Declined','Cancelled','Completed')
    then raise exception 'Invalid status transition'; end if;
  if v.status in ('Cancelled','Declined','Completed') then raise exception 'Request is closed'; end if;
  if p_status = 'Completed' and v.status <> 'Confirmed' then
    raise exception 'Only confirmed requests can be completed'; end if;
  if p_status = 'Needs Information' and nullif(btrim(coalesce(p_message,'')), '') is null then
    raise exception 'State what information is needed'; end if;
  if p_status = 'Confirmed' and (
    nullif(btrim(coalesce(p_confirmation->>'winery_confirmation','')), '') is null or
    nullif(btrim(coalesce(p_confirmation->>'date','')), '') is null or
    nullif(btrim(coalesce(p_confirmation->>'start_time','')), '') is null or
    nullif(btrim(coalesce(p_confirmation->>'location','')), '') is null or
    nullif(btrim(coalesce(p_confirmation->>'fee_conditions','')), '') is null
  ) then raise exception 'Winery confirmation, local date/time, location and fee conditions are required'; end if;
  update public.visit_requests set
    status = p_status,
    confirmed_date = case when p_status = 'Confirmed' then (p_confirmation->>'date')::date else confirmed_date end,
    confirmed_start_time = case when p_status = 'Confirmed' then (p_confirmation->>'start_time')::time else confirmed_start_time end,
    confirmed_end_time = case when p_status = 'Confirmed' then nullif(p_confirmation->>'end_time','')::time else confirmed_end_time end,
    confirmed_location = case when p_status = 'Confirmed' then p_confirmation->>'location' else confirmed_location end,
    winery_confirmation = case when p_status = 'Confirmed' then p_confirmation->>'winery_confirmation' else winery_confirmation end,
    confirmed_fee_conditions = case when p_status = 'Confirmed' then p_confirmation->>'fee_conditions' else confirmed_fee_conditions end,
    confirmed_by = case when p_status = 'Confirmed' then p_actor_id else confirmed_by end,
    confirmed_at = case when p_status = 'Confirmed' then now() else confirmed_at end,
    updated_at = now(), lock_version = lock_version + 1
  where id = p_request_id returning * into v;
  insert into public.visit_request_events(request_id, actor_id, event_type, details)
    values (p_request_id, p_actor_id, 'status_changed',
      jsonb_build_object('status', p_status, 'message', p_message));
  insert into public.visit_notification_outbox
    (request_id, recipient_user_id, recipient_email, kind, payload, idempotency_key)
    values (v.id, v.requester_id, v.requester_email, 'status_updated',
      jsonb_build_object('request_number', v.request_number, 'producer', v.producer_name,
        'status', p_status, 'message', p_message),
      'visit-status-' || v.id::text || '-' || v.lock_version::text)
    on conflict (idempotency_key) do nothing;
  return v;
end $$;
revoke all on function public.set_visit_request_status(uuid,uuid,bigint,text,text,jsonb)
  from public, anon, authenticated, visit_sales;
grant execute on function public.set_visit_request_status(uuid,uuid,bigint,text,text,jsonb) to service_role;

-- Fail the migration rather than activate a visit role with a legacy Data API
-- grant inherited through PUBLIC or an unexpected membership.
do $$
declare object_name text;
begin
  select format('%I.%I', n.nspname, c.relname) into object_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
    and c.relname not in ('app_profiles','app_profile_permissions')
    and has_table_privilege('visit_sales', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  limit 1;
  if object_name is not null then raise exception 'visit_sales can access legacy relation %', object_name; end if;
  select format('%I.%I', n.nspname, p.proname) into object_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'visit_request_user_id'
    and has_function_privilege('visit_sales', p.oid, 'EXECUTE')
  limit 1;
  if object_name is not null then raise exception 'visit_sales can execute legacy function %', object_name; end if;
end $$;
