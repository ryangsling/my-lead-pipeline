import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { appointments, workspaces } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const at = (hour: number) => new Date(Date.UTC(2027, 2, 1, hour));

async function makeWorkspace(slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ slug, name: slug, webhookSecretEncrypted: encrypt("secret") })
    .returning();
  return row.id;
}

function booking(workspaceId: string, startHour: number, endHour: number, status = "booked") {
  return db.insert(appointments).values({
    workspaceId,
    startAt: at(startHour),
    endAt: at(endHour),
    blockedUntil: at(endHour),
    status,
    source: "test",
  });
}

describe("appointment no-overlap constraint", () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await db.execute(sql`truncate workspaces cascade`);
  });

  it("rejects two overlapping active appointments with 23P01", async () => {
    const ws = await makeWorkspace("bloom");
    await booking(ws, 10, 11);
    await expect(booking(ws, 10, 11)).rejects.toMatchObject({ cause: { code: "23P01" } });
  });

  it("allows an overlap with a cancelled appointment", async () => {
    const ws = await makeWorkspace("bloom");
    await booking(ws, 10, 11, "cancelled");
    await expect(booking(ws, 10, 11)).resolves.not.toThrow();
  });

  it("allows touching ranges", async () => {
    const ws = await makeWorkspace("bloom");
    await booking(ws, 10, 11);
    await expect(booking(ws, 11, 12)).resolves.not.toThrow();
  });

  it("allows the same slot in a different workspace", async () => {
    const a = await makeWorkspace("bloom");
    const b = await makeWorkspace("roofer");
    await booking(a, 10, 11);
    await expect(booking(b, 10, 11)).resolves.not.toThrow();
  });
});
