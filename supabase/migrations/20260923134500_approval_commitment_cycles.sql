-- Scope PO commitments to the exact approval version that produced them.
--
-- An entered PO prevents the same saved approval from being drafted twice.
-- Clearing or editing that approval increments its lock version and starts a
-- fresh ordering cycle; prior commitments must not become negative corrections.

do $migration$
declare
    v_definition text;
    v_old text := 'and source_id = v_source_id;';
    v_new text := $new$and source_id = v_source_id
              and source_lock_version = (v_line->>'sourceLockVersion')::bigint;$new$;
begin
    select pg_get_functiondef(
        'public.create_purchase_order_drafts_atomic(uuid,uuid,text,jsonb,jsonb)'::regprocedure
    ) into v_definition;

    if position('and source_lock_version = (v_line->>''sourceLockVersion'')::bigint;' in v_definition) > 0 then
        return;
    end if;
    if position(v_old in v_definition) = 0 then
        raise exception 'Could not locate the approval commitment aggregation in create_purchase_order_drafts_atomic';
    end if;

    execute replace(v_definition, v_old, v_new);
end;
$migration$;

comment on table public.approval_commitments is
    'Immutable quantities entered from a specific approval lock version and PO draft revision.';
