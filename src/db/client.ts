import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/**
 * DATABASE_URL set  -> node-postgres (any shared/live environment).
 * DATABASE_URL empty -> embedded PGlite in ./.data/pglite (local demo only).
 * Both are real PostgreSQL, so the same migrations apply to each.
 */
export async function createDb(opts: { dataDir?: string; migrate?: boolean } = {}): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    if (opts.migrate) await migratePg(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = opts.dataDir ?? path.join(process.cwd(), ".data", "pglite");
  if (dataDir !== "memory://") fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  // Embedded demo DB: always bring schema up to date on boot.
  await migratePglite(db, { migrationsFolder });
  return db;
}
