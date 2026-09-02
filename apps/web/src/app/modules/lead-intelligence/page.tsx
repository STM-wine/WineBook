import { AppTopbar } from "@/components/app-topbar";
import { LeadIntelligenceView, type LeadIntelligenceLead, type LeadIntelligenceRep } from "@/components/lead-intelligence-view";
import { AccountPending, getAppContext, hasPermission } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AccountOpeningLeadRow = {
  id: string;
  display_name: string;
  opening_date: string | null;
  license_series: number | null;
  license_number: string | null;
  license_type_label: string | null;
  latest_signal_type: string | null;
  priority: "hot" | "watch" | "low" | "noise";
  account_channel: "on_premise" | "off_premise" | "hybrid" | "production" | "wholesale" | "event" | "unknown";
  license_bucket: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  target_team: string | null;
  latest_source_key: string | null;
  latest_source_url: string | null;
  suggested_rep_list_id: string | null;
  suggested_rep_reason: string | null;
  assigned_rep_list_id: string | null;
  filter_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

type LeadSourceRow = {
  source_key: string;
  display_name: string;
};

type QuickBooksSalesRepRow = {
  list_id: string;
  initial: string | null;
  full_name: string | null;
  entity_full_name: string | null;
};

export default async function LeadIntelligencePage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) {
    return <AccountPending email={context.pendingEmail} />;
  }

  const data = await loadLeadIntelligenceData();

  return (
    <main className="app-shell module-page">
      <AppTopbar activeModule="lead-intelligence" canViewSettings={hasPermission(context.permissions, "view_settings")} />

      <section className="module-header">
        <p className="eyebrow">Modules</p>
        <h1>Lead Intelligence</h1>
        <p className="muted">Track new account signals, sort on-premise and off-premise opportunities, and assign reps quickly.</p>
      </section>

      <LeadIntelligenceView
        leads={data.leads}
        reps={data.reps}
        sourceUnavailableReason={data.sourceUnavailableReason}
        canAssign={context.profile.role === "admin" || context.profile.role === "buyer"}
      />
    </main>
  );
}

async function loadLeadIntelligenceData(): Promise<{
  leads: LeadIntelligenceLead[];
  reps: LeadIntelligenceRep[];
  sourceUnavailableReason: string | null;
}> {
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    return {
      leads: previewLeads(),
      reps: [],
      sourceUnavailableReason: error instanceof Error ? error.message : "Lead Intelligence is not configured yet."
    };
  }

  const reps = await loadReps(supabase);
  const sourcesByKey = await loadSourcesByKey(supabase);

  const { data, error } = await supabase
    .from("account_opening_leads")
    .select(`
      id,
      display_name,
      opening_date,
      license_series,
      license_number,
      license_type_label,
      latest_signal_type,
      priority,
      account_channel,
      license_bucket,
      address_line1,
      city,
      state,
      postal_code,
      target_team,
      latest_source_key,
      latest_source_url,
      suggested_rep_list_id,
      suggested_rep_reason,
      assigned_rep_list_id,
      filter_reason,
      first_seen_at,
      last_seen_at
    `)
    .gte("last_seen_at", ninetyDaysAgo())
    .order("last_seen_at", { ascending: false })
    .limit(100)
    .returns<AccountOpeningLeadRow[]>();

  if (error) {
    return {
      leads: previewLeads(),
      reps,
      sourceUnavailableReason: `Preview data shown. Apply the Lead Intelligence migration to load live leads: ${error.message}`
    };
  }

  const leads = (data || []).map((row) => mapLeadRow(row, sourcesByKey));

  return {
    leads: leads.length ? leads : previewLeads(),
    reps,
    sourceUnavailableReason: leads.length ? null : "No live account-opening leads yet. Showing preview rows for layout."
  };
}

async function loadReps(supabase: ReturnType<typeof createServiceRoleClient>): Promise<LeadIntelligenceRep[]> {
  const { data } = await supabase
    .from("quickbooks_sales_reps")
    .select("list_id,initial,full_name,entity_full_name")
    .order("full_name", { ascending: true })
    .returns<QuickBooksSalesRepRow[]>();

  return (data || []).map((row) => ({
    id: row.list_id,
    label: row.full_name || row.entity_full_name || row.initial || row.list_id,
    initials: row.initial || null
  }));
}

async function loadSourcesByKey(supabase: ReturnType<typeof createServiceRoleClient>) {
  const { data } = await supabase.from("lead_sources").select("source_key,display_name").returns<LeadSourceRow[]>();
  return new Map((data || []).map((source) => [source.source_key, source.display_name]));
}

function mapLeadRow(row: AccountOpeningLeadRow, sourcesByKey: Map<string, string>): LeadIntelligenceLead {
  return {
    id: row.id,
    name: row.display_name,
    date: row.opening_date || row.first_seen_at?.slice(0, 10) || null,
    type: row.license_type_label || formatSignal(row.latest_signal_type),
    licenseSeries: row.license_series,
    licenseNumber: row.license_number,
    address: formatAddress(row),
    hot: row.priority === "hot",
    priority: row.priority,
    premise: formatPremise(row.account_channel),
    channel: row.account_channel,
    bucket: row.license_bucket || "unknown",
    team: row.target_team || null,
    sourceName: row.latest_source_key ? sourcesByKey.get(row.latest_source_key) || formatSourceKey(row.latest_source_key) : "Manual",
    sourceUrl: row.latest_source_url,
    suggestedRepId: row.suggested_rep_list_id,
    suggestedRepReason: row.suggested_rep_reason,
    assignedRepId: row.assigned_rep_list_id,
    filterReason: row.filter_reason,
    isPreview: false
  };
}

function previewLeads(): LeadIntelligenceLead[] {
  return [
    {
      id: "preview-series-12",
      name: "Cactus & Copper",
      date: "2026-09-02",
      type: "Restaurant",
      licenseSeries: 12,
      licenseNumber: "12345678",
      address: "922 N 7th St, Phoenix, AZ 85006",
      hot: true,
      priority: "hot",
      premise: "On-premise",
      channel: "on_premise",
      bucket: "series_12_restaurant",
      team: "on_premise",
      sourceName: "City of Phoenix Newly Received Liquor License Applications",
      sourceUrl: "https://www.phoenix.gov/administration/departments/cityclerk/programs-services/license-services/new-applications.html",
      suggestedRepId: null,
      suggestedRepReason: "Near current central Phoenix account run.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-series-10",
      name: "Desert Bottle Shop",
      date: "2026-09-02",
      type: "Beer and Wine Store",
      licenseSeries: 10,
      licenseNumber: "22345678",
      address: "4141 E Thomas Rd, Phoenix, AZ 85018",
      hot: true,
      priority: "hot",
      premise: "Off-premise",
      channel: "off_premise",
      bucket: "series_10_beer_wine_store",
      team: "off_premise",
      sourceName: "AZ DLLC License Search",
      sourceUrl: "https://liquor.az.gov/license-search",
      suggestedRepId: null,
      suggestedRepReason: "Series 10 is routed hot to the off-premise team.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-series-9",
      name: "Camelback Liquor",
      date: null,
      type: "Liquor Store",
      licenseSeries: 9,
      licenseNumber: "32345678",
      address: "5150 N 16th St, Phoenix, AZ 85016",
      hot: false,
      priority: "watch",
      premise: "Off-premise",
      channel: "off_premise",
      bucket: "series_9_liquor_store",
      team: "off_premise",
      sourceName: "AZ DLLC License Search",
      sourceUrl: "https://liquor.az.gov/license-search",
      suggestedRepId: null,
      suggestedRepReason: "Separate off-premise liquor-store bucket.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-circle-k",
      name: "Circle K #2741",
      date: "2026-09-01",
      type: "Beer and Wine Store",
      licenseSeries: 10,
      licenseNumber: "42345678",
      address: "1002 E Indian School Rd, Phoenix, AZ 85014",
      hot: false,
      priority: "noise",
      premise: "Off-premise",
      channel: "off_premise",
      bucket: "known_chain_or_convenience",
      team: null,
      sourceName: "City of Phoenix Newly Received Liquor License Applications",
      sourceUrl: "https://www.phoenix.gov/administration/departments/cityclerk/programs-services/license-services/new-applications.html",
      suggestedRepId: null,
      suggestedRepReason: null,
      assignedRepId: null,
      filterReason: "Known convenience-store chain.",
      isPreview: true
    },
    {
      id: "preview-mxsw",
      name: "Mesa Supper Club",
      date: "2026-08-27",
      type: "Coming Soon",
      licenseSeries: null,
      licenseNumber: null,
      address: "21 W Main St, Mesa, AZ 85201",
      hot: true,
      priority: "hot",
      premise: "On-premise",
      channel: "on_premise",
      bucket: "coming_soon",
      team: "on_premise",
      sourceName: "Mouth by Southwest",
      sourceUrl: "https://mouthbysouthwest.com/feed/",
      suggestedRepId: null,
      suggestedRepReason: "Opening-soon signal from a high-priority local source.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-hotel",
      name: "The Monroe Rooftop",
      date: "2026-08-21",
      type: "Hotel/Motel",
      licenseSeries: 11,
      licenseNumber: null,
      address: "101 N 1st Ave, Phoenix, AZ 85003",
      hot: false,
      priority: "watch",
      premise: "Hybrid",
      channel: "hybrid",
      bucket: "series_11_hotel_motel",
      team: "on_premise",
      sourceName: "Phoenix Licenses",
      sourceUrl: "https://www.phoenix.gov/administration/departments/cityclerk/programs-services/license-services/new-applications.html",
      suggestedRepId: null,
      suggestedRepReason: "Review for hotel restaurant or bar fit.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-pnt",
      name: "Roosevelt Raw Bar",
      date: "2026-08-15",
      type: "New Opening",
      licenseSeries: null,
      licenseNumber: null,
      address: "721 N 2nd St, Phoenix, AZ 85004",
      hot: true,
      priority: "hot",
      premise: "On-premise",
      channel: "on_premise",
      bucket: "new_opening",
      team: "on_premise",
      sourceName: "Phoenix New Times Food & Drink",
      sourceUrl: "https://www.phoenixnewtimes.com/category/food-drink/",
      suggestedRepId: null,
      suggestedRepReason: "Recent opening coverage within the 30-day alert window.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-series-7",
      name: "Little Valley Wine Bar",
      date: "2026-08-09",
      type: "Beer and Wine Bar",
      licenseSeries: 7,
      licenseNumber: "72345678",
      address: "3301 E Indian School Rd, Phoenix, AZ 85018",
      hot: false,
      priority: "watch",
      premise: "On-premise",
      channel: "on_premise",
      bucket: "series_7_beer_wine_bar",
      team: "on_premise",
      sourceName: "AZ DLLC License Search",
      sourceUrl: "https://liquor.az.gov/license-search",
      suggestedRepId: null,
      suggestedRepReason: "Beer/wine bar; elevate if the concept is wine-list focused.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-old-restaurant",
      name: "North Central Osteria",
      date: "2026-07-12",
      type: "Restaurant",
      licenseSeries: 12,
      licenseNumber: "82345678",
      address: "5812 N 7th St, Phoenix, AZ 85014",
      hot: true,
      priority: "hot",
      premise: "On-premise",
      channel: "on_premise",
      bucket: "series_12_restaurant",
      team: "on_premise",
      sourceName: "Phoenix Licenses",
      sourceUrl: "https://www.phoenix.gov/administration/departments/cityclerk/programs-services/license-services/new-applications.html",
      suggestedRepId: null,
      suggestedRepReason: "Older than 30 days, but visible in the 90-day history.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    },
    {
      id: "preview-old-series-10",
      name: "Arcadia Market",
      date: "2026-06-28",
      type: "Beer and Wine Store",
      licenseSeries: 10,
      licenseNumber: "92345678",
      address: "4325 E Indian School Rd, Phoenix, AZ 85018",
      hot: true,
      priority: "hot",
      premise: "Off-premise",
      channel: "off_premise",
      bucket: "series_10_beer_wine_store",
      team: "off_premise",
      sourceName: "AZ DLLC License Search",
      sourceUrl: "https://liquor.az.gov/license-search",
      suggestedRepId: null,
      suggestedRepReason: "Older Series 10 off-premise lead, retained for 90-day research.",
      assignedRepId: null,
      filterReason: null,
      isPreview: true
    }
  ];
}

function formatSignal(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPremise(value: AccountOpeningLeadRow["account_channel"]) {
  if (value === "on_premise") return "On-premise";
  if (value === "off_premise") return "Off-premise";
  return formatSignal(value);
}

function formatSourceKey(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAddress(row: Pick<AccountOpeningLeadRow, "address_line1" | "city" | "state" | "postal_code">) {
  const cityStateZip = [row.city, row.state, row.postal_code].filter(Boolean).join(" ");
  return [row.address_line1, cityStateZip].filter(Boolean).join(", ") || null;
}

function ninetyDaysAgo() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 90);
  return date.toISOString();
}
