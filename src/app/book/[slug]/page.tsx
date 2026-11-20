import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { BookingWidget } from "@/components/booking-widget";
import { db } from "@/lib/db/client";
import { embeds, services } from "@/lib/db/schema";
import { getWorkspaceBySlug } from "@/lib/workspaces";

/** Public booking page. No login; only the business name, service names and prices are shown. */
export default async function BookPage({ params }: PageProps<"/book/[slug]">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w || w.status !== "active") notFound();
  const [embed] = await db.select({ publicKey: embeds.publicKey }).from(embeds).where(eq(embeds.workspaceId, w.id));
  const list = await db
    .select({ id: services.id, name: services.name, durationMin: services.durationMin, priceText: services.priceText })
    .from(services)
    .where(and(eq(services.workspaceId, w.id), eq(services.active, true)))
    .orderBy(services.name);

  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-medium">Book with {w.name}</h1>
      {embed && list.length ? (
        <BookingWidget publicKey={embed.publicKey} timezone={w.timezone} services={list} />
      ) : (
        <p className="text-sm">Online booking is not available yet.</p>
      )}
    </main>
  );
}
