import { createDb } from "./client";

(async () => {
  await createDb({ migrate: true });
  console.log("Migrations applied.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
