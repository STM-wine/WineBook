-- Initial WineBook app profile allowlist.
--
-- Run this after creating/inviting the matching users in Supabase Auth.
-- It does not create auth users; it attaches app roles to existing Auth users
-- by email so the hosted app can allow them through.

insert into public.app_profiles (id, email, full_name, role)
select id, email, 'Junaid Dawud', 'admin'
from auth.users
where lower(email) = 'jdawud@gmail.com'
on conflict (id) do update
set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();

insert into public.app_profiles (id, email, full_name, role)
select id, email, 'Stem Wine Company', 'admin'
from auth.users
where lower(email) = 'stm@stemwinecompany.com'
on conflict (id) do update
set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();
