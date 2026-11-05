import * as schema from "./schema";
import { createDb, type Db } from "./client";
import { assertLiveConfig } from "@/lib/env";

const g = globalThis as unknown as { __cadenceDb?: Promise<Db> };

/** Lazily-initialised singleton (survives dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!g.__cadenceDb) {
    assertLiveConfig();
    g.__cadenceDb = createDb();
  }
  return g.__cadenceDb;
}

export { schema };
export type { Db };
