"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

/** Opens the global QuickViewDrawer for a work item by setting ?quickView=<id> on the current URL. */
export function QuickViewLink({ workItemId, className, children }: { workItemId: string; className?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set("quickView", workItemId);

  return (
    <Link href={`${pathname}?${params.toString()}`} scroll={false} className={className}>
      {children}
    </Link>
  );
}
