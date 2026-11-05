"use server";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { isDemo } from "@/lib/env";
import { verifyPassword } from "@/server/passwords";
import { createSession, destroySession, homeFor } from "@/server/session";
import { audit } from "@/server/audit";

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const db = await getDb();
  const [u] = await db.select().from(users).where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deactivatedAt))).limit(1);
  const ok = await verifyPassword(password, u?.passwordHash ?? null);
  // Same message whether or not the account exists.
  if (!u || !ok) {
    await audit(db, { actorId: null, action: "auth.login_failed", entityType: "user" });
    return { error: "That email and password don't match our records." };
  }
  if (!isDemo() && u.isDemo) return { error: "Demo accounts can't sign in to the live environment." };
  await createSession(u.id, u.role);
  await audit(db, { actorId: u.id, action: "auth.login", entityType: "user", entityId: u.id });
  redirect(homeFor(u.role));
}

/** Demo-only role switch. Hard-disabled outside APP_ENV=demo and for non-demo accounts. */
export async function demoSwitchAction(form: FormData) {
  if (!isDemo()) redirect("/login");
  const userId = String(form.get("userId") ?? "");
  const db = await getDb();
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.isDemo, true), isNull(users.deactivatedAt))).limit(1);
  if (!u) redirect("/demo");
  await destroySession();
  await createSession(u.id, u.role, true);
  await audit(db, { actorId: u.id, action: "auth.demo_switch", entityType: "user", entityId: u.id });
  redirect(homeFor(u.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
