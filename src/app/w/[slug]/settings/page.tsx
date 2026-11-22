import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkspaceForm } from "@/components/workspace-form";
import { DeletionHistory } from "@/components/deletion-history";
import { getWorkspaceBySlug, readBusinessInfo } from "@/lib/workspaces";
import { recordingApproved } from "@/lib/vapi/recording";

export default async function WorkspaceSettingsPage({ params, searchParams }: PageProps<"/w/[slug]/settings">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const deletion = z.uuid().safeParse((await searchParams).deletion);
  return (
    <>
      <h1 className="mb-6">Settings</h1>
      <WorkspaceForm
        id={w.id}
        recordingApproved={recordingApproved(w.id)}
        initial={{
          name: w.name,
          slug: w.slug,
          niche: w.niche ?? "",
          country: w.country,
          timezone: w.timezone,
          phoneDisplay: w.phoneDisplay ?? "",
          transferEnabled: w.transferEnabled,
          callbackMinutes: w.callbackMinutes,
          onCallNumber: w.onCallNumber,
          backupNumber: w.backupNumber,
          escalationTriggers: w.escalationTriggers,
          serviceZips: w.serviceZips,
          serviceCities: w.serviceCities,
          logoUrl: w.logoUrl ?? "",
          accentColor: w.accentColor ?? "",
          recordingEnabled: w.recordingEnabled,
          retentionDays: w.retentionDays,
          vapiMode: w.vapiMode as "own" | "pool",
          businessInfo: readBusinessInfo(w.businessInfo),
        }}
      />
      <DeletionHistory workspaceId={w.id} timezone={w.timezone} requestId={deletion.data} />
    </>
  );
}
