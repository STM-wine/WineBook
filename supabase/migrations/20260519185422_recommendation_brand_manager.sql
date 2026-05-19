-- Persist the buyer-facing Brand Manager / TDM value from RB6 External ID 1
-- on each recommendation snapshot so Order Review filters can be populated
-- from the latest completed run.

alter table public.reorder_recommendations
    add column if not exists brand_manager text;
