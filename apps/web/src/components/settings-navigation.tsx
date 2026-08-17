"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

type SettingsNavItem = {
  href: string;
  label: string;
};

export function SettingsNavigation({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(false);
  }, [pathname]);

  function startLoading(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      pathname === href
    ) {
      return;
    }
    setIsLoading(true);
  }

  return (
    <>
      {isLoading ? <div className="settings-route-progress" aria-label="Loading settings page" role="status" /> : null}
      <nav>
        {items.map((item) => (
          <Link
            key={item.href}
            className={pathname === item.href ? "active" : undefined}
            href={item.href}
            onClick={(event) => startLoading(event, item.href)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
