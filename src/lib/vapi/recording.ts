import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";

export function recordingApproved(workspaceId: string) {
  return env.VAPI_VERIFIED_RECORDING_WORKSPACE_IDS?.split(",").some((id) => id.trim() === workspaceId) ?? false;
}

export async function recordingEnabledFor(workspaceId: string) {
  if (!recordingApproved(workspaceId)) return false;
  const [workspace] = await db.select({ enabled: workspaces.recordingEnabled }).from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return workspace?.enabled === true;
}

const compliance = z.object({ recordingConsent: z.unknown().optional() }).nullish();
const timestamp = z.iso.datetime({ offset: true });
const consentSource = z.object({
  compliance,
  createdAt: timestamp.nullish(),
  endedAt: timestamp.nullish(),
});
const reportCompliance = consentSource.extend({ call: consentSource.optional() });
const verbalConsent = z.object({ type: z.literal("verbal"), grantedAt: timestamp });

/** The provider can include the result on the report, the call, or both. */
export function recordingConsentAt(payload: unknown): Date | null {
  const parsed = reportCompliance.safeParse(payload);
  if (!parsed.success) return null;
  const evidence = [parsed.data.compliance?.recordingConsent, parsed.data.call?.compliance?.recordingConsent]
    .filter((value) => value !== undefined);
  if (!evidence.length) return null;
  const times = evidence.map((value) => verbalConsent.safeParse(value));
  const first = times[0];
  if (!first.success) return null;
  const grant = Date.parse(first.data.grantedAt);
  if (!Number.isFinite(grant) || times.some((time) => !time.success || Date.parse(time.data.grantedAt) !== grant)) return null;
  for (const source of [parsed.data, parsed.data.call]) {
    if (source?.createdAt && grant < Date.parse(source.createdAt)) return null;
    if (source?.endedAt && grant > Date.parse(source.endedAt)) return null;
  }
  return new Date(grant);
}

const recordingFields = new Set([
  "recording", "recordingUrl", "stereoRecordingUrl", "presignedMonoUrl", "presignedStereoUrl",
  "presignedAssistantUrl", "presignedCustomerUrl",
]);
const captureFields = new Set([
  "monitor", "listenUrl", "controlUrl", "pcapUrl", "presignedPcapUrl",
  "videoRecordingUrl", "videoRecordingStartDelaySeconds", "presignedVideoUrl", "videoUrl",
]);

/** Remove provider playback fields before persisting an authenticated webhook. */
export function stripVapiCaptureLinks(value: unknown, hasConsent: boolean) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => stripVapiCaptureLinks(item, hasConsent));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (captureFields.has(key) || (!hasConsent && recordingFields.has(key))) delete record[key];
    else stripVapiCaptureLinks(nested, hasConsent);
  }
}
