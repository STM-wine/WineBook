import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("stem_password_recovery", "", {
    httpOnly: true,
    maxAge: 0,
    path: "/auth/reset-password",
    sameSite: "lax"
  });
  return response;
}
