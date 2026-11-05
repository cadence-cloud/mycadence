import { requirePageUser } from "@/server/session";
import { StaffShell } from "@/components/staff-shell";

export const dynamic = "force-dynamic";

export default async function PtLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(["pt"]);
  return (
    <StaffShell
      user={user}
      nav={[
        { href: "/pt", label: "Patients" },
        { href: "/pt/library", label: "Exercise library" },
        { href: "/pt/templates", label: "Templates" },
      ]}
    >
      {children}
    </StaffShell>
  );
}
