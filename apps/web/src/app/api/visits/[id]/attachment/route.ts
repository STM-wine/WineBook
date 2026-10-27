import { randomUUID } from "node:crypto";
import { getVisitActor, visitDb, visitErrorResponse } from "@/lib/visits/access";

type Params = { params: Promise<{ id: string }> };
const TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg"
};

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await getVisitActor();
    const { id } = await params;
    const db = visitDb();
    const { data: visit } = await db.from("visit_requests")
      .select("requester_id,status").eq("id", id).maybeSingle();
    if (!visit || visit.requester_id !== actor.id || !["Draft", "Needs Information"].includes(visit.status)) {
      return Response.json({ error: "Attachment cannot be changed." }, { status: 403 });
    }
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !TYPES[file.type] || file.size > 10 * 1024 * 1024 || file.size === 0) {
      return Response.json({ error: "Upload a PDF, PNG or JPEG of 10 MB or less." }, { status: 400 });
    }
    const path = `${id}/${randomUUID()}.${TYPES[file.type]}`;
    const { error: uploadError } = await db.storage.from("visit-itineraries")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: old } = await db.from("visit_request_details")
      .select("itinerary_path").eq("request_id", id).maybeSingle();
    const { error } = await db.from("visit_request_details")
      .update({ itinerary_path: path }).eq("request_id", id);
    if (error) {
      await db.storage.from("visit-itineraries").remove([path]);
      throw error;
    }
    if (old?.itinerary_path) await db.storage.from("visit-itineraries").remove([old.itinerary_path]);
    await db.from("visit_request_events").insert({ request_id: id, actor_id: actor.id, event_type: "itinerary_uploaded" });
    return Response.json({ ok: true });
  } catch (error) { return visitErrorResponse(error); }
}
