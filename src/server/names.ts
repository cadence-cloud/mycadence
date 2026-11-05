import { sql } from "drizzle-orm";
import { users } from "@/db/schema";

/** How a person is shown in the app: display name ("Dr. Meg") if set, otherwise full name. */
export const shownName = sql<string>`coalesce(${users.displayName}, ${users.name})`;
