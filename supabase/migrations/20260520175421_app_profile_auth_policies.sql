-- Allow the hosted app to use app_profiles as a simple employee allowlist.
-- Users can read their own profile after Supabase Auth signs them in.

drop policy if exists "authenticated users can read own app profile" on public.app_profiles;

create policy "authenticated users can read own app profile"
    on public.app_profiles for select
    to authenticated
    using (id = auth.uid());
