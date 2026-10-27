"use client";

import Link from "next/link";
import { AppUserMenu } from "@/components/app-user-menu";

export function VisitNav({ legacyHome = false }: { legacyHome?: boolean }) {
  return <header className="visit-nav">
    <Link href="/visits" className="visit-brand">Stem Intelligence <span>Winery visits</span></Link>
    <nav aria-label="Winery visits">
      <Link href="/visits/new">Request a Winery Visit</Link>
      <Link href="/visits?mine=true">My Requests</Link>
      <Link href="/visits">All Visit Requests</Link>
      {legacyHome ? <Link href="/">Stem home</Link> : null}
    </nav>
    <AppUserMenu />
  </header>;
}
