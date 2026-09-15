alter table public.app_profiles
    add column if not exists position text;

comment on column public.app_profiles.position is
    'User job title or organizational position; separate from the application access role.';
