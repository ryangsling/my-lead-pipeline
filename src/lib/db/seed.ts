import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { client, db } from "@/lib/db/client";
import { assistants, calendars, embeds, services, workspaces } from "@/lib/db/schema";

const SLUG = "bloom";

/** Creates the Bloom test workspace once. Re-running is a no-op. */
async function seedBloom() {
  const existing = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, SLUG) });
  if (existing) {
    console.log(`workspace "${SLUG}" already exists, nothing to do`);
    return;
  }

  await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({
        slug: SLUG,
        name: "Bloom Salon",
        niche: "salon",
        country: "GB",
        timezone: "Europe/London",
        phoneDisplay: null,
        businessInfo: { address: "", serviceArea: "", faq: [], policies: "" },
        webhookSecretEncrypted: encrypt(randomBytes(32).toString("hex")),
      })
      .returning();

    await tx.insert(services).values([
      { workspaceId: ws.id, name: "Cut and finish", durationMin: 45, bufferMin: 5, priceText: "from £30" },
      { workspaceId: ws.id, name: "Colour", durationMin: 90, bufferMin: 10, priceText: "from £65" },
      { workspaceId: ws.id, name: "Blow dry", durationMin: 30, bufferMin: 5, priceText: "from £20" },
    ]);

    await tx.insert(calendars).values({
      workspaceId: ws.id,
      workingHours: {
        mon: { open: "09:00", close: "17:30" },
        tue: { open: "09:00", close: "17:30" },
        wed: { open: "09:00", close: "17:30" },
        thu: { open: "09:00", close: "17:30" },
        fri: { open: "09:00", close: "17:30" },
        sat: { open: "09:00", close: "16:00" },
        sun: null,
      },
    });

    await tx.insert(assistants).values({
      workspaceId: ws.id,
      personaName: "Bloom Receptionist",
      firstMessage:
        "Hi, you're speaking with Bloom's AI assistant. This call may be recorded. How can I help you today?",
      systemPrompt:
        "You are the receptionist for {{business_name}}. Today is {{today}}. Opening hours: {{hours}}. Services: {{services}}. Timezone: {{timezone}}. Book appointments only with the tools provided.",
    });

    await tx.insert(embeds).values({
      workspaceId: ws.id,
      publicKey: `pk_${randomBytes(16).toString("hex")}`,
      allowedOrigins: [],
    });
  });

  console.log(`seeded workspace "${SLUG}"`);
}

seedBloom()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
