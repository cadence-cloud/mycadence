
export type AppEnv = "demo" | "live";

export function appEnv(): AppEnv {
  const v = (process.env.APP_ENV ?? "demo").toLowerCase();
  if (v !== "demo" && v !== "live") throw new Error(`APP_ENV must be "demo" or "live" (got "${v}")`);
  return v;
}

export const isDemo = () => appEnv() === "demo";

export function assertLiveConfig() {
  if (appEnv() !== "live") return;
  if (!process.env.DATABASE_URL) throw new Error("APP_ENV=live requires DATABASE_URL (Postgres). Embedded PGlite is demo-only.");
  if ((process.env.SESSION_SECRET ?? "").length < 32) throw new Error("APP_ENV=live requires SESSION_SECRET (32+ chars).");
}
