import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// This protects service-role-backed legacy routes as well as pages. The
// visit_sales database role separately protects direct Data API access.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies: Array<{ name: string; value: string; options?: CookieOptions }>) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return response;
  const { data: profile, error } = await supabase.from("app_profiles")
    .select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (error) return new NextResponse("Account access could not be checked.", { status: 503 });
  if (profile?.role !== "visit_sales") return response;

  const path = request.nextUrl.pathname;
  const allowed = path === "/" || path === "/login" || path.startsWith("/auth/") ||
    path === "/visits" || path.startsWith("/visits/") ||
    path === "/api/visits" || path.startsWith("/api/visits/");
  if (!allowed || (request.method !== "GET" && request.method !== "HEAD" &&
      !path.startsWith("/api/visits/") && path !== "/api/visits")) {
    return path.startsWith("/api/")
      ? NextResponse.json({ error: "Visit-only account." }, { status: 403 })
      : new NextResponse("Visit-only account.", { status: 403 });
  }
  return response;
}

export const config = {
  // Connector and scheduled ingestion routes authenticate independently.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|api/integrations/|api/ordering-runs/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)).*)"]
};
