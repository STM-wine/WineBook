-- Lead Intelligence foundation for early account-opening signals.
--
-- Stem owns the lead workflow, assignment state, source confidence, and
-- source-hit history. External publications, public records, and social APIs
-- remain evidence sources rather than sources of truth.

create table if not exists public.lead_sources (
    source_key text primary key,
    display_name text not null,
    source_kind text not null
        check (source_kind in (
            'official_record',
            'publication',
            'social_api',
            'social_watchlist',
            'website_monitor',
            'manual'
        )),
    source_url text not null,
    feed_url text,
    access_model text not null default 'public'
        check (access_model in (
            'public',
            'subscription',
            'mixed_public_subscription',
            'official_api',
            'manual_review',
            'unknown'
        )),
    polling_strategy text not null default 'html'
        check (polling_strategy in ('rss', 'html', 'api', 'email', 'manual')),
    poll_interval_minutes integer not null default 60
        check (poll_interval_minutes >= 5),
    enabled boolean not null default true,
    priority integer not null default 100
        check (priority >= 1),
    notes text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_license_classification_rules (
    license_series integer primary key
        check (license_series > 0),
    license_type_label text not null,
    account_channel text not null
        check (account_channel in (
            'on_premise',
            'off_premise',
            'hybrid',
            'production',
            'wholesale',
            'event',
            'unknown'
        )),
    license_bucket text not null
        check (license_bucket in (
            'series_12_restaurant',
            'series_6_bar',
            'series_7_beer_wine_bar',
            'series_10_beer_wine_store',
            'series_9_liquor_store',
            'series_11_hotel_motel',
            'producer',
            'wholesale',
            'event',
            'known_chain_or_convenience',
            'unknown'
        )),
    default_priority text not null
        check (default_priority in ('hot', 'watch', 'low', 'noise')),
    target_team text not null default 'general',
    notify_by_default boolean not null default false,
    suppress_by_default boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_suppression_rules (
    id uuid primary key default gen_random_uuid(),
    rule_key text not null unique,
    rule_type text not null
        check (rule_type in ('business_name_exact', 'business_name_keyword', 'business_name_regex')),
    pattern text not null,
    action text not null default 'suppress'
        check (action in ('suppress', 'review', 'route')),
    priority_override text
        check (priority_override is null or priority_override in ('hot', 'watch', 'low', 'noise')),
    target_team text,
    reason text not null,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.account_opening_leads (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    canonical_name text not null,
    account_channel text not null default 'unknown'
        check (account_channel in (
            'on_premise',
            'off_premise',
            'hybrid',
            'production',
            'wholesale',
            'event',
            'unknown'
        )),
    license_series integer
        check (license_series is null or license_series > 0),
    license_number text,
    license_type_label text,
    license_bucket text not null default 'unknown'
        check (license_bucket in (
            'series_12_restaurant',
            'series_6_bar',
            'series_7_beer_wine_bar',
            'series_10_beer_wine_store',
            'series_9_liquor_store',
            'series_11_hotel_motel',
            'producer',
            'wholesale',
            'event',
            'known_chain_or_convenience',
            'unknown'
        )),
    address_line1 text,
    city text,
    state text not null default 'AZ',
    postal_code text,
    normalized_location_key text,
    opening_status text not null default 'new_signal'
        check (opening_status in (
            'new_signal',
            'researching',
            'qualified',
            'assigned',
            'visited',
            'converted',
            'dismissed'
        )),
    opening_date date,
    latest_signal_type text not null default 'unknown'
        check (latest_signal_type in (
            'liquor_license_application',
            'coming_soon',
            'new_opening',
            'opening_date',
            'new_bar',
            'permit',
            'social_post',
            'manual',
            'unknown'
        )),
    latest_source_key text references public.lead_sources(source_key),
    latest_source_url text,
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    lead_score numeric(6, 2) not null default 0
        check (lead_score >= 0),
    priority text not null default 'watch'
        check (priority in ('hot', 'watch', 'low', 'noise')),
    target_team text,
    territory_hint text,
    suggested_rep_list_id text references public.quickbooks_sales_reps(list_id),
    suggested_rep_reason text,
    assigned_rep_list_id text references public.quickbooks_sales_reps(list_id),
    assigned_by uuid references public.app_profiles(id),
    assigned_at timestamptz,
    dismissed_reason text,
    filter_reason text,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_source_hits (
    id uuid primary key default gen_random_uuid(),
    source_key text not null references public.lead_sources(source_key),
    account_opening_lead_id uuid references public.account_opening_leads(id) on delete set null,
    external_id text,
    canonical_url text,
    title text not null,
    summary text,
    signal_type text not null default 'unknown'
        check (signal_type in (
            'liquor_license_application',
            'coming_soon',
            'new_opening',
            'opening_date',
            'new_bar',
            'permit',
            'social_post',
            'manual',
            'unknown'
        )),
    published_at timestamptz,
    fetched_at timestamptz not null default now(),
    observed_at timestamptz not null default now(),
    content_hash text,
    extraction_status text not null default 'pending'
        check (extraction_status in ('pending', 'extracted', 'ignored', 'failed')),
    extraction_error text,
    paywall_limited boolean not null default false,
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    extracted_facts jsonb not null default '{}'::jsonb,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, canonical_url)
);

create table if not exists public.account_lead_rep_suggestions (
    id uuid primary key default gen_random_uuid(),
    account_opening_lead_id uuid not null references public.account_opening_leads(id) on delete cascade,
    suggested_rep_list_id text references public.quickbooks_sales_reps(list_id),
    confidence numeric(5, 4) not null default 0
        check (confidence >= 0 and confidence <= 1),
    suggestion_reason text not null,
    inputs jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create unique index if not exists idx_lead_source_hits_external_id
    on public.lead_source_hits(source_key, external_id)
    where external_id is not null;

create index if not exists idx_lead_license_classification_rules_channel
    on public.lead_license_classification_rules(account_channel, default_priority, target_team);

create index if not exists idx_lead_suppression_rules_enabled_type
    on public.lead_suppression_rules(enabled, rule_type);

create index if not exists idx_account_opening_leads_status
    on public.account_opening_leads(opening_status, priority, last_seen_at desc);

create index if not exists idx_account_opening_leads_rep
    on public.account_opening_leads(assigned_rep_list_id, opening_status);

create index if not exists idx_account_opening_leads_suggested_rep
    on public.account_opening_leads(suggested_rep_list_id, priority);

create index if not exists idx_account_opening_leads_location
    on public.account_opening_leads(city, postal_code, normalized_location_key);

create index if not exists idx_account_opening_leads_channel_bucket
    on public.account_opening_leads(account_channel, license_bucket, priority);

create index if not exists idx_lead_source_hits_source_fetched
    on public.lead_source_hits(source_key, fetched_at desc);

create index if not exists idx_lead_source_hits_signal
    on public.lead_source_hits(signal_type, published_at desc);

create or replace function public.touch_lead_intelligence_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists lead_sources_touch
    on public.lead_sources;

create trigger lead_sources_touch
    before update on public.lead_sources
    for each row
    execute function public.touch_lead_intelligence_updated_at();

drop trigger if exists lead_license_classification_rules_touch
    on public.lead_license_classification_rules;

create trigger lead_license_classification_rules_touch
    before update on public.lead_license_classification_rules
    for each row
    execute function public.touch_lead_intelligence_updated_at();

drop trigger if exists lead_suppression_rules_touch
    on public.lead_suppression_rules;

create trigger lead_suppression_rules_touch
    before update on public.lead_suppression_rules
    for each row
    execute function public.touch_lead_intelligence_updated_at();

drop trigger if exists account_opening_leads_touch
    on public.account_opening_leads;

create trigger account_opening_leads_touch
    before update on public.account_opening_leads
    for each row
    execute function public.touch_lead_intelligence_updated_at();

drop trigger if exists lead_source_hits_touch
    on public.lead_source_hits;

create trigger lead_source_hits_touch
    before update on public.lead_source_hits
    for each row
    execute function public.touch_lead_intelligence_updated_at();

alter table public.lead_sources enable row level security;
alter table public.lead_license_classification_rules enable row level security;
alter table public.lead_suppression_rules enable row level security;
alter table public.account_opening_leads enable row level security;
alter table public.lead_source_hits enable row level security;
alter table public.account_lead_rep_suggestions enable row level security;

drop policy if exists "authenticated users can read lead sources"
    on public.lead_sources;

create policy "authenticated users can read lead sources"
    on public.lead_sources for select
    to authenticated
    using (true);

drop policy if exists "authenticated users can read lead license classification rules"
    on public.lead_license_classification_rules;

create policy "authenticated users can read lead license classification rules"
    on public.lead_license_classification_rules for select
    to authenticated
    using (true);

drop policy if exists "authenticated users can read lead suppression rules"
    on public.lead_suppression_rules;

create policy "authenticated users can read lead suppression rules"
    on public.lead_suppression_rules for select
    to authenticated
    using (true);

drop policy if exists "authenticated users can read account opening leads"
    on public.account_opening_leads;

create policy "authenticated users can read account opening leads"
    on public.account_opening_leads for select
    to authenticated
    using (true);

drop policy if exists "buyers and admins can update account opening leads"
    on public.account_opening_leads;

create policy "buyers and admins can update account opening leads"
    on public.account_opening_leads for update
    to authenticated
    using (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    )
    with check (
        exists (
            select 1
            from public.app_profiles profile
            where profile.id = (select auth.uid())
              and profile.role in ('buyer', 'admin')
        )
    );

drop policy if exists "authenticated users can read lead source hits"
    on public.lead_source_hits;

create policy "authenticated users can read lead source hits"
    on public.lead_source_hits for select
    to authenticated
    using (true);

drop policy if exists "authenticated users can read account lead rep suggestions"
    on public.account_lead_rep_suggestions;

create policy "authenticated users can read account lead rep suggestions"
    on public.account_lead_rep_suggestions for select
    to authenticated
    using (true);

grant select on table public.lead_sources to authenticated;
grant select on table public.lead_license_classification_rules to authenticated;
grant select on table public.lead_suppression_rules to authenticated;
grant select, update on table public.account_opening_leads to authenticated;
grant select on table public.lead_source_hits to authenticated;
grant select on table public.account_lead_rep_suggestions to authenticated;

grant select, insert, update, delete on table public.lead_sources to service_role;
grant select, insert, update, delete on table public.lead_license_classification_rules to service_role;
grant select, insert, update, delete on table public.lead_suppression_rules to service_role;
grant select, insert, update, delete on table public.account_opening_leads to service_role;
grant select, insert, update, delete on table public.lead_source_hits to service_role;
grant select, insert, update, delete on table public.account_lead_rep_suggestions to service_role;

insert into public.lead_license_classification_rules (
    license_series,
    license_type_label,
    account_channel,
    license_bucket,
    default_priority,
    target_team,
    notify_by_default,
    suppress_by_default,
    notes
)
values
    (6, 'Bar', 'on_premise', 'series_6_bar', 'hot', 'on_premise', true, false, 'Full on-premise bar opportunity.'),
    (7, 'Beer and Wine Bar', 'on_premise', 'series_7_beer_wine_bar', 'watch', 'on_premise', false, false, 'Beer/wine only on-premise account. Elevate when concept looks wine-relevant.'),
    (9, 'Liquor Store', 'off_premise', 'series_9_liquor_store', 'watch', 'off_premise', false, false, 'Off-premise liquor-store lane. Keep separate from restaurants and bars.'),
    (10, 'Beer and Wine Store', 'off_premise', 'series_10_beer_wine_store', 'hot', 'off_premise', true, false, 'Hot off-premise prospect unless suppressed by known-chain or convenience-store rules.'),
    (11, 'Hotel/Motel', 'hybrid', 'series_11_hotel_motel', 'watch', 'on_premise', false, false, 'Review for hotel restaurant, bar, resort, banquet, or chain context.'),
    (12, 'Restaurant', 'on_premise', 'series_12_restaurant', 'hot', 'on_premise', true, false, 'Core on-premise restaurant opening signal.'),
    (1, 'In-State Producer', 'production', 'producer', 'low', 'general', false, false, 'Producer/tasting-room signal; usually not a standard account-opening alert.'),
    (3, 'Microbrewery', 'production', 'producer', 'low', 'general', false, false, 'Brewery/taproom signal; review only if it looks like a wine-list or restaurant opportunity.'),
    (4, 'Wholesaler', 'wholesale', 'wholesale', 'noise', 'general', false, true, 'Not a retail account lead for reps.'),
    (13, 'Farm Winery', 'production', 'producer', 'low', 'general', false, false, 'Producer/tasting-room signal; usually not a standard account-opening alert.'),
    (15, 'Special Event', 'event', 'event', 'noise', 'general', false, true, 'Temporary event license.'),
    (16, 'Craft Producer Festival', 'event', 'event', 'noise', 'general', false, true, 'Temporary festival license.'),
    (18, 'Craft Distillery', 'production', 'producer', 'low', 'general', false, false, 'Producer/tasting-room signal; review only if account fit is strong.'),
    (19, 'Remote Tasting Room', 'hybrid', 'producer', 'low', 'general', false, false, 'Producer remote tasting-room signal; usually lower priority than retail/on-premise leads.')
on conflict (license_series) do update
set
    license_type_label = excluded.license_type_label,
    account_channel = excluded.account_channel,
    license_bucket = excluded.license_bucket,
    default_priority = excluded.default_priority,
    target_team = excluded.target_team,
    notify_by_default = excluded.notify_by_default,
    suppress_by_default = excluded.suppress_by_default,
    notes = excluded.notes,
    updated_at = now();

insert into public.lead_suppression_rules (
    rule_key,
    rule_type,
    pattern,
    action,
    priority_override,
    target_team,
    reason
)
values
    ('known_chain_circle_k', 'business_name_keyword', 'circle k', 'suppress', 'noise', null, 'Known convenience-store chain.'),
    ('known_chain_quiktrip', 'business_name_keyword', 'quiktrip', 'suppress', 'noise', null, 'Known convenience-store chain.'),
    ('known_chain_qt', 'business_name_exact', 'qt', 'suppress', 'noise', null, 'Known convenience-store chain shorthand.'),
    ('known_chain_7_eleven', 'business_name_keyword', '7-eleven', 'suppress', 'noise', null, 'Known convenience-store chain.'),
    ('known_chain_walmart', 'business_name_keyword', 'walmart', 'suppress', 'noise', null, 'Known national retail chain.'),
    ('known_chain_target', 'business_name_keyword', 'target', 'suppress', 'noise', null, 'Known national retail chain.'),
    ('known_chain_walgreens', 'business_name_keyword', 'walgreens', 'suppress', 'noise', null, 'Known pharmacy chain.'),
    ('known_chain_cvs', 'business_name_keyword', 'cvs', 'suppress', 'noise', null, 'Known pharmacy chain.'),
    ('known_chain_costco', 'business_name_keyword', 'costco', 'suppress', 'noise', null, 'Known national warehouse chain.'),
    ('known_chain_sams_club', 'business_name_keyword', 'sam''s club', 'suppress', 'noise', null, 'Known national warehouse chain.'),
    ('known_chain_safeway', 'business_name_keyword', 'safeway', 'suppress', 'noise', null, 'Known grocery chain.'),
    ('known_chain_albertsons', 'business_name_keyword', 'albertsons', 'suppress', 'noise', null, 'Known grocery chain.'),
    ('known_chain_frys', 'business_name_keyword', 'fry''s', 'suppress', 'noise', null, 'Known grocery chain.'),
    ('known_chain_bashas', 'business_name_keyword', 'basha', 'suppress', 'noise', null, 'Known grocery chain.'),
    ('known_chain_shell', 'business_name_keyword', 'shell', 'suppress', 'noise', null, 'Known fuel/convenience-store chain.'),
    ('known_chain_chevron', 'business_name_keyword', 'chevron', 'suppress', 'noise', null, 'Known fuel/convenience-store chain.'),
    ('known_chain_arco', 'business_name_keyword', 'arco', 'suppress', 'noise', null, 'Known fuel/convenience-store chain.')
on conflict (rule_key) do update
set
    rule_type = excluded.rule_type,
    pattern = excluded.pattern,
    action = excluded.action,
    priority_override = excluded.priority_override,
    target_team = excluded.target_team,
    reason = excluded.reason,
    enabled = excluded.enabled,
    updated_at = now();

insert into public.lead_sources (
    source_key,
    display_name,
    source_kind,
    source_url,
    feed_url,
    access_model,
    polling_strategy,
    poll_interval_minutes,
    priority,
    notes,
    metadata
)
values
    (
        'city_phoenix_new_liquor_applications',
        'City of Phoenix Newly Received Liquor License Applications',
        'official_record',
        'https://www.phoenix.gov/administration/departments/cityclerk/programs-services/license-services/new-applications.html',
        null,
        'public',
        'html',
        15,
        1,
        'Highest-priority early signal for Phoenix locations. Page lists recently filed applications during the initial posting/comment period.',
        '{"city": "Phoenix", "state": "AZ", "signalTypes": ["liquor_license_application"], "leadTiming": "pre_opening"}'::jsonb
    ),
    (
        'az_dllc_license_search',
        'Arizona Department of Liquor Licenses and Control License Search',
        'official_record',
        'https://liquor.az.gov/license-search',
        null,
        'public',
        'html',
        60,
        2,
        'Use as validation/enrichment for license status, type, city, county, and applicant information.',
        '{"state": "AZ", "signalTypes": ["liquor_license_application"], "leadTiming": "validation"}'::jsonb
    ),
    (
        'mouth_by_southwest',
        'Mouth by Southwest',
        'publication',
        'https://mouthbysouthwest.com/',
        'https://mouthbysouthwest.com/feed/',
        'mixed_public_subscription',
        'rss',
        15,
        3,
        'High-signal Phoenix metro food and drink source. Public feed/headline metadata should be ingested; subscriber-only article bodies require legitimate subscription access.',
        '{
            "city": "Phoenix metro",
            "state": "AZ",
            "signalTypes": ["coming_soon", "new_opening", "new_bar"],
            "watchLabels": ["New Restaurant Alert", "Coming soon", "New bar alert", "For paid subscribers"],
            "candidateCategoryFeeds": [
                "https://mouthbysouthwest.com/category/new-restaurant-alert/feed/",
                "https://mouthbysouthwest.com/category/coming-soon/feed/"
            ],
            "leadTiming": "early_press"
        }'::jsonb
    ),
    (
        'phoenix_new_times_food_drink',
        'Phoenix New Times Food & Drink',
        'publication',
        'https://www.phoenixnewtimes.com/category/food-drink/',
        'https://www.phoenixnewtimes.com/index.rss',
        'public',
        'rss',
        30,
        4,
        'Local food and drink coverage with restaurant opening, closing, coming-soon, and bar/brewery signals.',
        '{"city": "Phoenix metro", "state": "AZ", "signalTypes": ["coming_soon", "new_opening", "opening_date", "new_bar"], "watchSections": ["Openings & Closings", "Restaurants", "Bars & Breweries"], "leadTiming": "press"}'::jsonb
    ),
    (
        'eater_phoenix',
        'Eater Phoenix',
        'publication',
        'https://phoenix.eater.com/',
        'https://phoenix.eater.com/rss/index.xml',
        'public',
        'rss',
        60,
        5,
        'Useful confirmation and trend source for notable Phoenix openings; usually less early than license and MxSW signals.',
        '{"city": "Phoenix metro", "state": "AZ", "signalTypes": ["new_opening", "coming_soon"], "leadTiming": "press"}'::jsonb
    ),
    (
        'manual_account_tip',
        'Manual Account Tip',
        'manual',
        'https://stmhq.com',
        null,
        'manual_review',
        'manual',
        1440,
        20,
        'Human-entered lead from rep, buyer, supplier, customer, or trade chatter.',
        '{"signalTypes": ["manual"], "leadTiming": "human_tip"}'::jsonb
    )
on conflict (source_key) do update
set
    display_name = excluded.display_name,
    source_kind = excluded.source_kind,
    source_url = excluded.source_url,
    feed_url = excluded.feed_url,
    access_model = excluded.access_model,
    polling_strategy = excluded.polling_strategy,
    poll_interval_minutes = excluded.poll_interval_minutes,
    enabled = excluded.enabled,
    priority = excluded.priority,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now();

comment on table public.lead_sources is
    'Stem-owned registry of public-record, publication, social API, website-monitor, and manual sources for account-opening intelligence.';

comment on table public.lead_license_classification_rules is
    'Editable default routing rules for license series, including Series 10 hot off-premise leads and a separate Series 9 liquor-store bucket.';

comment on table public.lead_suppression_rules is
    'Editable chain, keyword, and pattern rules that can suppress or reroute otherwise-hot license hits such as convenience-store chains.';

comment on table public.account_opening_leads is
    'Stem-owned account-opening lead cards with on-premise/off-premise routing, manual assignment, and suggested rep fields.';

comment on table public.lead_source_hits is
    'Raw and extracted evidence items from lead intelligence sources.';

comment on table public.account_lead_rep_suggestions is
    'History of Stem-generated rep suggestions based on current account runs, off-premise focus, territory hints, and source facts.';
