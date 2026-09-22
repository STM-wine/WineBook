-- Allow buyers to pause automatic recommendations for any automatically
-- replenished policy. Suppression remains item-code-specific, so replacement
-- vintages inherit the family policy without inheriting the old item's pause.

alter table public.ordering_item_markers
    drop constraint if exists ordering_item_markers_suppression_policy_check,
    add constraint ordering_item_markers_suppression_policy_check
        check (
            not recommendations_suppressed
            or replenishment_policy in ('Core', 'Limited Core', 'Limited')
        );

notify pgrst, 'reload schema';
