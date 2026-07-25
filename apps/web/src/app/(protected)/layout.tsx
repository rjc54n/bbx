import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { requireOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireOwner();
  return <AppShell>{children}</AppShell>;
}
