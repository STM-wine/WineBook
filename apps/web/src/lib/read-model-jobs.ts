import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export class CalculationPending extends Error {
  constructor(public stage: string) { super(stage); }
}

export async function completedReadModel<T>(supabase: SupabaseClient, kind: string, key: string, formula: string, request: unknown): Promise<T> {
  const { data: response, error } = await supabase.rpc("request_read_model", {
    p_kind: kind, p_key: key, p_formula: formula, p_request: request
  });
  const data = Array.isArray(response) ? response[0] : response;
  if (error) throw new Error(`Calculation storage unavailable: ${error.message}`);
  if (data?.status === "failed") throw new Error(data.error || "Calculation failed. Retry shortly.");
  if (data?.status !== "completed") throw new CalculationPending(data?.status === "running"
    ? "Calculating margins from source lines" : "Waiting for the shared calculation worker");
  return data.result as T;
}

export async function readSourceVersion(supabase: SupabaseClient, kind: string): Promise<number> {
  const { data, error } = await supabase.from("read_model_versions").select("version").eq("kind", kind).single();
  if (error) throw new Error(error.message);
  return data.version;
}
