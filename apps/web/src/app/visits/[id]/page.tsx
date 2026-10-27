import { getVisitActor } from "@/lib/visits/access";
import { VisitNav } from "@/components/visits/visit-nav";
import { VisitDetail } from "@/components/visits/visit-detail";

export const dynamic = "force-dynamic";

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getVisitActor();
  const { id } = await params;
  return <main className="visit-shell"><VisitNav legacyHome={actor.role !== "visit_sales"} />
    <div className="visit-content"><VisitDetail id={id} actor={{
      id: actor.id, isAdmin: actor.isAdmin, canManageAssigned: actor.canManageAssigned
    }} /></div></main>;
}
