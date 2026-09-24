-- Internal, append-only collaboration notes attached to a stable SKU identity
-- inside a PO draft. These notes are deliberately excluded from PO revisions
-- and export snapshots so internal discussion can never leak to a supplier.

create table if not exists public.purchase_order_line_notes (
    id uuid primary key default gen_random_uuid(),
    report_run_id uuid not null references public.report_runs(id) on delete cascade,
    purchase_order_draft_id uuid not null references public.purchase_order_drafts(id) on delete cascade,
    line_key text not null check (length(line_key) between 1 and 200),
    product_code_snapshot text,
    product_name_snapshot text,
    body text not null check (length(btrim(body)) between 1 and 2000),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now()
);

create index if not exists idx_po_line_notes_draft_line_created
    on public.purchase_order_line_notes(purchase_order_draft_id, line_key, created_at, id);

create index if not exists idx_po_line_notes_report_run
    on public.purchase_order_line_notes(report_run_id, created_at);

alter table public.purchase_order_line_notes enable row level security;

do $po_line_notes_policy$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'purchase_order_line_notes'
          and policyname = 'authenticated users can read PO line notes'
    ) then
        execute 'create policy "authenticated users can read PO line notes"
            on public.purchase_order_line_notes for select
            to authenticated
            using (true)';
    end if;
end $po_line_notes_policy$;

grant select on public.purchase_order_line_notes to authenticated;
revoke insert, update, delete on public.purchase_order_line_notes from authenticated;

do $po_line_notes_trigger$
begin
    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.purchase_order_line_notes'::regclass
          and tgname = 'trg_po_line_notes_immutable'
          and not tgisinternal
    ) then
        execute 'create trigger trg_po_line_notes_immutable
            before update or delete on public.purchase_order_line_notes
            for each row execute function public.prevent_immutable_business_event_change()';
    end if;
end $po_line_notes_trigger$;

create or replace function public.add_purchase_order_line_note(
    p_line_id uuid,
    p_body text
)
returns public.purchase_order_line_notes
language plpgsql
security definer
set search_path = public
as $add_po_line_note$
declare
    v_actor uuid := auth.uid();
    v_body text := btrim(coalesce(p_body, ''));
    v_draft_id uuid;
    v_report_run_id uuid;
    v_line public.purchase_order_lines%rowtype;
    v_draft public.purchase_order_drafts%rowtype;
    v_line_key text;
    v_note public.purchase_order_line_notes%rowtype;
begin
    if v_actor is null or not exists (
        select 1 from public.app_profiles where id = v_actor and role in ('buyer', 'admin')
    ) then
        raise exception 'Buyer or admin access required' using errcode = '42501';
    end if;
    if length(v_body) = 0 then
        raise exception 'Write a note before saving';
    end if;
    if length(v_body) > 2000 then
        raise exception 'PO line notes are limited to 2,000 characters';
    end if;

    select draft.id, draft.report_run_id
    into v_draft_id, v_report_run_id
    from public.purchase_order_lines line
    join public.purchase_order_drafts draft on draft.id = line.purchase_order_draft_id
    where line.id = p_line_id;
    if not found then
        raise exception 'PO line changed while the note was open. Refresh and try again.' using errcode = '40001';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_report_run_id::text, 9173));

    select * into v_line
    from public.purchase_order_lines
    where id = p_line_id;
    if not found then
        raise exception 'PO line changed while the note was open. Refresh and try again.' using errcode = '40001';
    end if;

    select * into v_draft
    from public.purchase_order_drafts
    where id = v_line.purchase_order_draft_id;
    if not found then
        raise exception 'PO draft not found';
    end if;
    if v_draft.status not in ('draft', 'ready_for_entry') then
        raise exception 'Notes can only be added to an active PO draft';
    end if;

    v_line_key := case
        when v_line.source_type is not null and v_line.source_id is not null
            then v_line.source_type || ':' || v_line.source_id::text
        when v_line.supplier_catalog_wine_id is not null
            then 'catalog_wine:' || v_line.supplier_catalog_wine_id::text
        when v_line.recommendation_id is not null
            then 'recommendation:' || v_line.recommendation_id::text
        when nullif(btrim(v_line.product_code), '') is not null
            then 'code:' || lower(btrim(v_line.product_code))
        when nullif(btrim(v_line.planning_sku), '') is not null
            then 'sku:' || lower(btrim(v_line.planning_sku))
        else 'line:' || v_line.id::text
    end;

    insert into public.purchase_order_line_notes (
        report_run_id,
        purchase_order_draft_id,
        line_key,
        product_code_snapshot,
        product_name_snapshot,
        body,
        created_by
    ) values (
        v_draft.report_run_id,
        v_draft.id,
        v_line_key,
        nullif(btrim(v_line.product_code), ''),
        nullif(btrim(v_line.product_name), ''),
        v_body,
        v_actor
    ) returning * into v_note;

    return v_note;
end;
$add_po_line_note$;

revoke all on function public.add_purchase_order_line_note(uuid, text) from public;
grant execute on function public.add_purchase_order_line_note(uuid, text) to authenticated;

do $po_line_notes_realtime$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'purchase_order_line_notes'
       ) then
        alter publication supabase_realtime add table public.purchase_order_line_notes;
    end if;
end $po_line_notes_realtime$;

notify pgrst, 'reload schema';
