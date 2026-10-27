import { getVisitActor } from "@/lib/visits/access";
import { VisitNav } from "@/components/visits/visit-nav";
import { VisitEditor } from "@/components/visits/visit-editor";

export default async function NewVisitPage() {
  const actor = await getVisitActor();
  return <main className="visit-shell"><VisitNav legacyHome={actor.role !== "visit_sales"} />
    <div className="visit-content"><VisitEditor /></div></main>;
}
