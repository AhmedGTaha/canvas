import type { ReactNode } from "react";
import { AppShell } from "@/components/navigation/app-shell";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthenticatedUser();
  return <AppShell user={user}>{children}</AppShell>;
}
