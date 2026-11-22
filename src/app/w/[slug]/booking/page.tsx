import { notFound } from "next/navigation";
import { BookingForm } from "@/components/booking-form";
import { getBookingSettings, listServices } from "@/lib/booking/settings";
import { getExactIntegration } from "@/lib/integrations/store";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function BookingPage({ params, searchParams }: PageProps<"/w/[slug]/booking">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  const connectedNow = query.connected === "1";

  const [settings, services, google] = await Promise.all([
    getBookingSettings(w.id),
    listServices(w.id),
    getExactIntegration("google", w.id),
  ]);

  return (
    <>
      <h1 className="mb-4 text-xl font-medium">Booking for {w.name}</h1>
      <BookingForm
        workspaceId={w.id}
        notice={error || (connectedNow ? "Google Calendar connected. Choose a calendar and save." : "")}
        initial={{
          connected: Boolean(google?.creds.refreshToken),
          googleCalendarId: settings?.googleCalendarId ?? null,
          workingHours: (settings?.workingHours ?? {}) as Record<string, { open: string; close: string }>,
          slotStepMin: settings?.slotStepMin ?? 30,
          minNoticeHours: settings?.minNoticeHours ?? 2,
          maxDaysAhead: settings?.maxDaysAhead ?? 30,
          publicBookingRequestOnly: settings?.publicBookingRequestOnly ?? false,
          services: services.map((s) => ({
            id: s.id,
            name: s.name,
            visitKind: s.visitKind,
            durationMin: s.durationMin,
            bufferMin: s.bufferMin,
            priceText: s.priceText ?? "",
            active: s.active,
          })),
        }}
      />
    </>
  );
}
