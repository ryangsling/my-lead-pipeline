import type { CSSProperties } from "react";
import { BookingBrand } from "@/components/booking-brand";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { BookingWidget } from "@/components/booking-widget";
import { db } from "@/lib/db/client";
import { calendars, embeds, services } from "@/lib/db/schema";
import { getWorkspaceBySlug } from "@/lib/workspaces";

function accentStyle(color: string | null) {
  const accent = color && /^#[a-f0-9]{6}$/i.test(color) ? color : "#275df5";
  const [r, g, b] = accent.slice(1).match(/../g)!.map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { "--booking-accent": accent, "--booking-on-accent": light > 0.179 ? "#000000" : "#ffffff" } as CSSProperties;
}

/** Public booking page. No login; only the business name, service names and prices are shown. */
export default async function BookPage({ params }: PageProps<"/book/[slug]">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w || w.status !== "active") notFound();
  const [embed] = await db.select({ publicKey: embeds.publicKey, requestOnly: calendars.publicBookingRequestOnly })
    .from(embeds).leftJoin(calendars, eq(calendars.workspaceId, embeds.workspaceId)).where(eq(embeds.workspaceId, w.id));
  const list = await db
    .select({ id: services.id, name: services.name, durationMin: services.durationMin, visitKind: services.visitKind, priceText: services.priceText })
    .from(services)
    .where(and(eq(services.workspaceId, w.id), eq(services.active, true)))
    .orderBy(services.name);

  return (
    <main className="booking-page" style={accentStyle(w.accentColor)}>
      <div className="booking-card">
        <BookingBrand name={w.name} logoUrl={w.logoUrl} />
        {embed && list.length ? (
          <BookingWidget businessName={w.name} publicKey={embed.publicKey} timezone={w.timezone} services={list}
            requestOnly={Boolean(embed.requestOnly)} restricted={Boolean(w.serviceZips.length || w.serviceCities.length)} />
        ) : (
          <p className="text-sm">Online booking is not available yet.</p>
        )}
      </div>
    </main>
  );
}
