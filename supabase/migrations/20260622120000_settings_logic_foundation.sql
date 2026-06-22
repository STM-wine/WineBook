-- Settings foundation for versioned ordering logic, buyer requests, and capabilities.

create table if not exists public.app_profile_permissions (
    profile_id uuid not null references public.app_profiles(id) on delete cascade,
    permission text not null
        check (permission in (
            'view_settings',
            'view_logic_settings',
            'request_logic_change',
            'draft_logic_changes',
            'publish_logic_changes',
            'manage_user_access',
            'manage_supplier_settings',
            'view_settings_history'
        )),
    granted_by uuid references public.app_profiles(id),
    granted_at timestamptz not null default now(),
    primary key (profile_id, permission)
);

create table if not exists public.configuration_versions (
    id uuid primary key default gen_random_uuid(),
    domain text not null check (domain in ('ordering_logic')),
    schema_version integer not null default 1,
    version_number integer not null,
    status text not null
        check (status in ('draft', 'pending_approval', 'published', 'rejected', 'archived')),
    values jsonb not null,
    based_on_version_id uuid references public.configuration_versions(id),
    proposal_summary text,
    change_reason text,
    created_by uuid references public.app_profiles(id),
    submitted_by uuid references public.app_profiles(id),
    approved_by uuid references public.app_profiles(id),
    published_by uuid references public.app_profiles(id),
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    published_at timestamptz,
    effective_at timestamptz,
    unique (domain, version_number)
);

create unique index if not exists configuration_versions_one_published_per_domain
    on public.configuration_versions(domain)
    where status = 'published';

create table if not exists public.settings_change_requests (
    id uuid primary key default gen_random_uuid(),
    domain text not null check (domain in ('ordering_logic')),
    requested_changes jsonb not null default '{}'::jsonb,
    explanation text not null,
    status text not null default 'open'
        check (status in ('open', 'accepted', 'declined', 'implemented')),
    requested_by uuid not null references public.app_profiles(id),
    assigned_to uuid references public.app_profiles(id),
    resulting_version_id uuid references public.configuration_versions(id),
    admin_response text,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

alter table public.report_runs
    add column if not exists configuration_version_id uuid references public.configuration_versions(id),
    add column if not exists configuration_snapshot jsonb;

create index if not exists idx_app_profile_permissions_permission on public.app_profile_permissions(permission);
create index if not exists idx_configuration_versions_domain_status on public.configuration_versions(domain, status);
create index if not exists idx_settings_change_requests_domain_status on public.settings_change_requests(domain, status);

alter table public.app_profile_permissions enable row level security;
alter table public.configuration_versions enable row level security;
alter table public.settings_change_requests enable row level security;

create policy "profiles can read own permissions"
    on public.app_profile_permissions for select
    to authenticated
    using (profile_id = (select auth.uid()));

create policy "admins can read profile permissions"
    on public.app_profile_permissions for select
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role = 'admin'
        )
    );

create policy "settings users can read configuration versions"
    on public.configuration_versions for select
    to authenticated
    using (
        exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('view_settings', 'view_logic_settings', 'view_settings_history', 'draft_logic_changes')
        )
    );

create policy "requesters and admins can read settings change requests"
    on public.settings_change_requests for select
    to authenticated
    using (
        requested_by = (select auth.uid())
        or exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission in ('draft_logic_changes', 'view_settings_history')
        )
    );

create policy "buyers can create settings change requests"
    on public.settings_change_requests for insert
    to authenticated
    with check (
        requested_by = (select auth.uid())
        and exists (
            select 1
            from public.app_profile_permissions permission
            where permission.profile_id = (select auth.uid())
              and permission.permission = 'request_logic_change'
        )
    );

grant select on table public.app_profile_permissions to authenticated;
grant select on table public.configuration_versions to authenticated;
grant select, insert on table public.settings_change_requests to authenticated;
grant select, insert, update, delete on table public.app_profile_permissions to service_role;
grant select, insert, update, delete on table public.configuration_versions to service_role;
grant select, insert, update, delete on table public.settings_change_requests to service_role;

insert into public.configuration_versions (
    domain,
    schema_version,
    version_number,
    status,
    values,
    proposal_summary,
    change_reason,
    published_at,
    effective_at
)
values (
    'ordering_logic',
    1,
    1,
    'published',
    '{
      "schema_version": 1,
      "standard_target_days": 15,
      "core_target_days": 30,
      "btg_target_days": 45,
      "monthly_mode_enabled": true,
      "monthly_multipliers": {
        "1": {"mode": "Aggressive", "multiplier": 1.15},
        "2": {"mode": "Aggressive", "multiplier": 1.15},
        "3": {"mode": "Aggressive", "multiplier": 1.15},
        "4": {"mode": "Neutral", "multiplier": 1.0},
        "5": {"mode": "Defensive", "multiplier": 0.75},
        "6": {"mode": "Defensive", "multiplier": 0.75},
        "7": {"mode": "Defensive", "multiplier": 0.75},
        "8": {"mode": "Defensive", "multiplier": 0.75},
        "9": {"mode": "Rebuild", "multiplier": 1.0},
        "10": {"mode": "Growth", "multiplier": 1.1},
        "11": {"mode": "Growth", "multiplier": 1.1},
        "12": {"mode": "Growth", "multiplier": 1.1}
      },
      "minimum_multiplier": 0.5,
      "maximum_multiplier": 1.5,
      "default_pack_size": 12,
      "standard_minimum_packs": 1,
      "core_round_sub_case_to_one_pack": true,
      "btg_round_sub_case_to_one_pack": true,
      "rounding_method": "ceil_pack",
      "urgent_weeks_threshold": 4.0,
      "high_risk_coverage_threshold": 0.5,
      "medium_risk_coverage_threshold": 1.0,
      "supplier_eta_warning_buffer_days": 7,
      "high_volume_flag_threshold": 480,
      "recommendation_default_status": "rejected"
    }'::jsonb,
    'Initial ordering logic settings',
    'Seed current production recommendation behavior.',
    now(),
    now()
)
on conflict (domain, version_number) do nothing;

insert into public.app_profile_permissions (profile_id, permission)
select profile.id, permission.permission
from public.app_profiles profile
cross join (
    values
        ('view_settings'),
        ('view_logic_settings'),
        ('request_logic_change'),
        ('view_settings_history')
) as permission(permission)
where profile.role in ('buyer', 'admin')
on conflict (profile_id, permission) do nothing;

insert into public.app_profile_permissions (profile_id, permission)
select profile.id, permission.permission
from public.app_profiles profile
cross join (
    values
        ('draft_logic_changes'),
        ('manage_user_access'),
        ('manage_supplier_settings')
) as permission(permission)
where profile.role = 'admin'
on conflict (profile_id, permission) do nothing;

insert into public.app_profile_permissions (profile_id, permission)
select profile.id, 'publish_logic_changes'
from public.app_profiles profile
where lower(profile.email) in ('mark@stemwinecompany.com', 'stm@stemwinecompany.com')
on conflict (profile_id, permission) do nothing;

create or replace function public.publish_configuration_version(
    p_version_id uuid,
    p_actor_id uuid,
    p_reason text
)
returns public.configuration_versions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_version public.configuration_versions%rowtype;
begin
    select *
    into v_version
    from public.configuration_versions
    where id = p_version_id
      and domain = 'ordering_logic'
      and status in ('draft', 'pending_approval')
    for update;

    if not found then
        raise exception 'Publishable configuration version not found.';
    end if;

    update public.configuration_versions
    set status = 'archived'
    where domain = v_version.domain
      and status = 'published';

    update public.configuration_versions
    set status = 'published',
        approved_by = p_actor_id,
        published_by = p_actor_id,
        published_at = now(),
        effective_at = now(),
        change_reason = coalesce(nullif(p_reason, ''), change_reason)
    where id = p_version_id
    returning * into v_version;

    insert into public.audit_events (
        actor_id,
        event_type,
        entity_type,
        entity_id,
        details
    )
    values (
        p_actor_id,
        'configuration.published',
        'configuration_version',
        p_version_id,
        jsonb_build_object(
            'domain', v_version.domain,
            'version_number', v_version.version_number,
            'reason', p_reason,
            'values', v_version.values
        )
    );

    return v_version;
end;
$$;

revoke all on function public.publish_configuration_version(uuid, uuid, text) from public;
revoke all on function public.publish_configuration_version(uuid, uuid, text) from anon;
revoke all on function public.publish_configuration_version(uuid, uuid, text) from authenticated;
grant execute on function public.publish_configuration_version(uuid, uuid, text) to service_role;
