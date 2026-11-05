import { shownName } from "@/server/names";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { randomToken, sha256 } from "./passwords";
import type { AuthUser, Role } from "./authz";

const COOKIE = "cadence_session";
const STAFF_TTL_H = 12;
const PATIENT_TTL_H = 24 * 14;

export async function createSession(userId: string, role: Role, viaDemoSwitch = false) {
  const db = await getDb();
  const token = randomToken();
  const ttl = role === "patient" ? PATIENT_TTL_H : STAFF_TTL_H;
  const expiresAt = new Date(Date.now() + ttl * 3600_000);
  await db.insert(sessions).values({ id: newId(), tokenHash: sha256(token), userId, expiresAt, viaDemoSwitch });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id, name: shownName, fullName: users.name, email: users.email, role: users.role, credentials: users.credentials, isDemo: users.isDemo })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), isNull(users.deactivatedAt)))
    .limit(1);
  return row ?? null;
}

export function homeFor(role: Role) {
  return role === "patient" ? "/me" : role === "pt" ? "/pt" : "/admin";
}

/** For pages: redirect to login (or the user's own home) rather than throwing. */
export async function requirePageUser(roles?: Role[]): Promise<AuthUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}

/** For API routes / actions: null means respond 401/403. */
export async function requireApiUser(roles?: Role[]): Promise<AuthUser | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  if (roles && !roles.includes(u.role)) return null;
  return u;
}
