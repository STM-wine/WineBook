import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // The handler must see the refreshed session on this request, and the
          // browser must receive the same session for its next request.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  // This verifies the token and refreshes it when needed. Authorization still
  // happens in each page, route handler, and server action.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Connector and scheduled ingestion routes authenticate separately and may
  // be called without browser cookies.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/integrations/|api/ordering-runs/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
