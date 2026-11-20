import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("migrations", () => {
  it("apply to an empty database twice without error", async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);

    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });

    expect(await db.select().from(workspaces)).toEqual([]);
  });
});
