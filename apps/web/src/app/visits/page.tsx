import { getVisitActor } from "@/lib/visits/access";
import { VisitNav } from "@/components/visits/visit-nav";
import { VisitHome } from "@/components/visits/visit-home";

export const dynamic = "force-dynamic";

export default async function VisitsPage() {
  const actor = await getVisitActor();
  return <main className="visit-shell">
    <VisitNav legacyHome={actor.role !== "visit_sales"} />
    <VisitHome actor={{ id: actor.id, name: actor.name, isAdmin: actor.isAdmin }} />
  </main>;
}
