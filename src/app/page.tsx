import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/server/session";

export default async function Home() {
  const u = await getCurrentUser();
  redirect(u ? homeFor(u.role) : "/login");
}
