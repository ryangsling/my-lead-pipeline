import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePhone } from "@/lib/crm/contacts";
import { db } from "@/lib/db/client";
import { assistants, assistantSyncs, phoneNumberChanges, phoneNumbers, workspaces } from "@/lib/db/schema";
import { resolveVapiAccount, type VapiAccount } from "./account";
import { VapiError, vapiFetch } from "./client";

const vapiNumberSchema = z.object({
  id: z.string(),
  number: z.string().nullish(),
  status: z.string().nullish(),
  assistantId: z.string().nullish(),
  squadId: z.string().nullish(),
  workflowId: z.string().nullish(),
  serverUrl: z.string().nullish(),
  server: z.object({ url: z.string().nullish() }).nullish(),
  fallbackDestination: z.object({}).nullish(),
  hooks: z.array(z.unknown()).nullish(),
});

type VapiNumber = z.infer<typeof vapiNumberSchema>;
type PhoneNumberChange = typeof phoneNumberChanges.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type NumberRequest = { vapiPhoneNumberId: string; sourceWorkspaceId: string | null; operationId: string };
type Completed = { status: "completed"; phoneNumber: typeof phoneNumbers.$inferSelect };
type NumberResult =
  | Completed
  | { status: "pending"; operationId: string; error: string | null }
  | { status: "rejected"; error: string };

export class PhoneNumberError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const conflict = (message: string) => new PhoneNumberError(409, message);
const isActive = inArray(phoneNumberChanges.status, ["pending", "applying"]);
const lockReservations = sql`select pg_advisory_xact_lock(1387414901)`;
const participants = (workspaceIds: string[]) =>
  or(inArray(phoneNumberChanges.workspaceId, workspaceIds), inArray(phoneNumberChanges.sourceWorkspaceId, workspaceIds));
const phonePath = (id: string) => `/phone-number/${encodeURIComponent(id)}`;
const isCallable = (number: VapiNumber) => !number.status || number.status === "active";
const hasOtherRouting = (number: VapiNumber) =>
  Boolean(number.squadId || number.workflowId || number.server?.url || number.serverUrl ||
    number.fallbackDestination || number.hooks?.length);

function e164(value: string | null | undefined) {
  const international = value?.trim();
  return international?.startsWith("+") ? normalizePhone(international, "") : null;
}

async function readNumber(privateKey: string, id: string, signal: AbortSignal) {
  try {
    const number = vapiNumberSchema.parse(await vapiFetch(privateKey, phonePath(id), { signal }));
    if (number.id !== id) throw new Error("Unexpected Vapi phone number ID");
    return number;
  } catch (error) {
    if (error instanceof VapiError && error.status === 404) {
      throw conflict("The number is no longer accessible in this Vapi account.");
    }
    throw error;
  }
}

async function fetchNumbers(workspaceId: string) {
  const { privateKey } = await resolveVapiAccount(workspaceId);
  return vapiNumberSchema.array().parse(await vapiFetch(privateKey, "/phone-number", {
    signal: AbortSignal.timeout(7_000),
  }));
}

export async function listPhoneNumbers(workspaceId: string, includeTransfers = false, operationId?: string) {
  const numbers = await fetchNumbers(workspaceId).catch(() => null);
  const ids = (numbers ?? []).map(number => number.id);
  const { rows, changes, operation } = await db.transaction(async tx => {
    const rows = await tx.select({
      workspaceId: phoneNumbers.workspaceId,
      id: phoneNumbers.vapiPhoneNumberId,
      number: phoneNumbers.e164,
      workspaceName: workspaces.name,
      vapiAssistantId: assistantSyncs.vapiAssistantId,
    }).from(phoneNumbers)
      .innerJoin(workspaces, eq(workspaces.id, phoneNumbers.workspaceId))
      .leftJoin(assistants, and(eq(assistants.id, phoneNumbers.assistantId), eq(assistants.workspaceId, phoneNumbers.workspaceId)))
      .leftJoin(assistantSyncs, and(eq(assistantSyncs.workspaceId, assistants.workspaceId), eq(assistantSyncs.assistantId, assistants.id),
        isNull(assistantSyncs.vapiAccountId), isNull(phoneNumbers.vapiAccountId)))
      .where(or(eq(phoneNumbers.workspaceId, workspaceId), inArray(phoneNumbers.vapiPhoneNumberId, ids)));
    const changes = await tx.select().from(phoneNumberChanges).where(and(isActive, or(
      participants([workspaceId, ...rows.map(row => row.workspaceId)]),
      inArray(phoneNumberChanges.vapiPhoneNumberId, ids),
      inArray(phoneNumberChanges.replacedVapiPhoneNumberId, ids),
    )));
    const [operation] = operationId ? await tx.select().from(phoneNumberChanges).where(and(
      eq(phoneNumberChanges.id, operationId), eq(phoneNumberChanges.workspaceId, workspaceId),
    )) : [];
    return { rows, changes, operation };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const byNumber = new Map(rows.map(row => [row.id, row]));
  const current = rows.find(row => row.workspaceId === workspaceId);
  const change = changes.find(row => row.workspaceId === workspaceId || row.sourceWorkspaceId === workspaceId);
  const reserved = new Set(changes.flatMap(row => [row.vapiPhoneNumberId, row.replacedVapiPhoneNumberId]));
  const busy = new Set(changes.flatMap(row => [row.workspaceId, row.sourceWorkspaceId]));
  const available = [];
  const transfers = [];
  for (const remote of numbers ?? []) {
    const number = e164(remote.number);
    if (!number || !isCallable(remote) || hasOtherRouting(remote) || reserved.has(remote.id)) continue;
    const owner = byNumber.get(remote.id);
    if (!owner && !remote.assistantId) available.push({ id: remote.id, number });
    if (includeTransfers && owner && owner.workspaceId !== workspaceId && !busy.has(owner.workspaceId) &&
      owner.vapiAssistantId && owner.vapiAssistantId === remote.assistantId && e164(owner.number) === number) {
      transfers.push({ id: remote.id, number, workspaceId: owner.workspaceId, workspaceName: owner.workspaceName });
    }
  }
  return {
    numbers: available,
    assigned: current ? { id: current.id, number: current.number } : null,
    change: change ? { status: change.status, error: change.error } : null,
    operation: operation ? { status: operation.status, error: operation.error } : null,
    transfers,
    providerError: numbers ? null : "Could not load phone numbers from Vapi. Check the Vapi connection in settings.",
  };
}

async function syncedAssistant(tx: Transaction, workspaceId: string) {
  const [binding] = await tx.select({
    id: assistants.id, vapiId: assistantSyncs.vapiAssistantId, replacementId: assistantSyncs.replacementVapiAssistantId,
  })
    .from(assistants)
    .innerJoin(assistantSyncs, and(eq(assistantSyncs.workspaceId, assistants.workspaceId),
      eq(assistantSyncs.assistantId, assistants.id), isNull(assistantSyncs.vapiAccountId)))
    .where(eq(assistants.workspaceId, workspaceId));
  return binding?.vapiId ? { ...binding, vapiId: binding.vapiId } : null;
}

/** The caller publishes the replacement assistant in the same transaction as this verification. */
export async function rebindAssistantPhone(tx: Transaction, input: {
  workspaceId: string;
  assistantId: string;
  account: VapiAccount;
  previousId: string;
  replacementId: string;
  signal: AbortSignal;
}) {
  const { workspaceId, assistantId, account, previousId, replacementId, signal } = input;
  await tx.execute(lockReservations);
  const [active] = await tx.select({ id: phoneNumberChanges.id }).from(phoneNumberChanges)
    .where(and(isActive, participants([workspaceId])));
  if (active) throw conflict("A phone number change is awaiting confirmation. Retry the assistant sync after it completes.");

  const assignments = await tx.select().from(phoneNumbers).where(and(
    eq(phoneNumbers.workspaceId, workspaceId),
    account.accountId ? eq(phoneNumbers.vapiAccountId, account.accountId) : isNull(phoneNumbers.vapiAccountId),
  ));
  if (!assignments.length) return;
  const [assignment] = assignments;
  if (assignments.length !== 1 || assignment.assistantId !== assistantId) {
    throw conflict("Review this workspace's current phone assignment before replacing the assistant.");
  }
  const [workspace] = await tx.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (workspace?.status !== "active") throw conflict("The workspace must be active to update its phone routing.");

  const { vapiPhoneNumberId } = assignment;
  const read = async () => {
    const number = await readNumber(account.privateKey, vapiPhoneNumberId, signal);
    if (e164(number.number) !== assignment.e164 || !isCallable(number) || hasOtherRouting(number) ||
      (number.assistantId && ![previousId, replacementId].includes(number.assistantId))) {
      throw conflict("This number has different routing in Vapi. Review its current binding before retrying the assistant sync.");
    }
    return number.assistantId;
  };
  if (await read() === replacementId) return;
  await vapiFetch(account.privateKey, phonePath(vapiPhoneNumberId), {
    method: "PATCH", body: { assistantId: replacementId }, signal,
  });
  if (await read() !== replacementId) throw conflict("Vapi has not confirmed the replacement assistant's phone binding.");
}

function sameRequest(change: PhoneNumberChange, request: NumberRequest) {
  return change.vapiPhoneNumberId === request.vapiPhoneNumberId && change.sourceWorkspaceId === request.sourceWorkspaceId;
}

async function reserveChange(workspaceId: string, request: NumberRequest) {
  const { sourceWorkspaceId, vapiPhoneNumberId } = request;
  return db.transaction(async tx => {
    // Serializes brief ownership checks and reservations across route instances sharing Vapi.
    await tx.execute(lockReservations);
    const [existing] = await tx.select().from(phoneNumberChanges).where(and(
      eq(phoneNumberChanges.id, request.operationId), eq(phoneNumberChanges.workspaceId, workspaceId),
    ));
    if (existing) {
      if (!sameRequest(existing, request)) throw conflict("That operation ID is already in use.");
      return existing;
    }
    const scope = sourceWorkspaceId ? [workspaceId, sourceWorkspaceId] : [workspaceId];
    const [active] = await tx.select().from(phoneNumberChanges).where(and(isActive, or(
      participants(scope),
      eq(phoneNumberChanges.vapiPhoneNumberId, vapiPhoneNumberId),
      eq(phoneNumberChanges.replacedVapiPhoneNumberId, vapiPhoneNumberId),
    )));
    if (active) throw conflict("A phone number change is already awaiting confirmation.");

    const [workspace] = await tx.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (workspace?.status !== "active") throw conflict("Choose an active destination workspace.");
    const rows = await tx.select().from(phoneNumbers).where(or(
      inArray(phoneNumbers.workspaceId, scope), eq(phoneNumbers.vapiPhoneNumberId, vapiPhoneNumberId),
    ));
    const own = rows.filter(row => row.workspaceId === workspaceId);
    if (own.length > 1) throw conflict("This workspace has multiple phone numbers. Review its current assignments first.");
    const current = own[0];
    const selected = rows.find(row => row.vapiPhoneNumberId === vapiPhoneNumberId);
    if (sourceWorkspaceId) {
      if (sourceWorkspaceId === workspaceId || selected?.workspaceId !== sourceWorkspaceId) {
        throw conflict("The selected number is no longer assigned to the source workspace.");
      }
    } else if (selected && selected.workspaceId !== workspaceId) {
      throw conflict("This number is assigned to another workspace. Use Reassign to move it.");
    }

    const destination = await syncedAssistant(tx, workspaceId);
    if (!destination) throw new PhoneNumberError(422, "Sync the agent before assigning a number.");
    if (destination.replacementId) throw conflict("Finish the assistant sync before changing this number.");
    if (current && (current.assistantId !== destination.id || current.vapiAccountId !== null)) {
      throw conflict("Review this workspace's current phone assignment before replacing it.");
    }
    const source = sourceWorkspaceId ? await syncedAssistant(tx, sourceWorkspaceId) : null;
    if (source?.replacementId) throw conflict("Finish the source workspace's assistant sync before moving this number.");
    if (sourceWorkspaceId && (!source || source.vapiId === destination.vapiId ||
      selected?.assistantId !== source.id || selected.vapiAccountId !== null)) {
      throw conflict("Review the source workspace's current phone assignment before moving it.");
    }
    const [change] = await tx.insert(phoneNumberChanges).values({
      id: request.operationId,
      workspaceId,
      sourceWorkspaceId,
      vapiPhoneNumberId,
      replacedVapiPhoneNumberId: current && current.id !== selected?.id ? current.vapiPhoneNumberId : null,
      phoneNumberId: selected?.id ?? crypto.randomUUID(),
      assistantId: destination.id,
      vapiAssistantId: destination.vapiId,
      expectedVapiAssistantId: source?.vapiId ?? (selected ? destination.vapiId : null),
    }).onConflictDoNothing().returning();
    if (!change) throw conflict("That operation ID is already in use.");
    return change;
  });
}

function checkSelected(change: PhoneNumberChange, number: VapiNumber) {
  const international = e164(number.number);
  if (!international || !isCallable(number) || (change.e164 && change.e164 !== international)) {
    throw conflict("Vapi did not return the expected active E.164 number.");
  }
  const boundTo = number.assistantId ?? null;
  const expected = boundTo === change.expectedVapiAssistantId || (change.sourceWorkspaceId === null && boundTo === null);
  const applied = change.status === "applying" && boundTo === change.vapiAssistantId;
  if (hasOtherRouting(number) || (!expected && !applied)) {
    throw conflict("This number has different routing in Vapi. Review its current binding.");
  }
  return international;
}

function checkReplaced(change: PhoneNumberChange, number: VapiNumber, expected: string | null) {
  if (!expected || e164(number.number) !== expected) {
    throw conflict("The previous number no longer matches its saved assignment. Review the number in Vapi.");
  }
  if (hasOtherRouting(number) || (number.assistantId && number.assistantId !== change.vapiAssistantId)) {
    throw conflict("The workspace's previous number has different routing in Vapi. Review its current binding.");
  }
}

const pending = (change: PhoneNumberChange, error = change.error): NumberResult =>
  ({ status: "pending", operationId: change.id, error });
const key = (change: PhoneNumberChange) =>
  and(eq(phoneNumberChanges.id, change.id), eq(phoneNumberChanges.workspaceId, change.workspaceId));

function completed(change: PhoneNumberChange): Completed {
  return { status: "completed", phoneNumber: {
    id: change.phoneNumberId,
    workspaceId: change.workspaceId,
    vapiPhoneNumberId: change.vapiPhoneNumberId,
    e164: change.e164!,
    assistantId: change.assistantId,
    vapiAccountId: null,
  } };
}

async function applyChange(change: PhoneNumberChange, privateKey: string, signal: AbortSignal) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(phoneNumberChanges).where(key(change)).for("update", { skipLocked: true });
    if (!current) return pending(change);
    if (current.status === "completed") return completed(current);
    if (current.status === "rejected") return { status: "rejected", error: current.error! } as const;

    const { vapiPhoneNumberId, replacedVapiPhoneNumberId, vapiAssistantId, workspaceId } = current;
    const read = (id: string) => readNumber(privateKey, id, signal);
    const readMappedE164 = async (id: string, ownerWorkspaceId: string) => {
      const [mapping] = await tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(and(
        eq(phoneNumbers.workspaceId, ownerWorkspaceId), eq(phoneNumbers.vapiPhoneNumberId, id),
      ));
      return e164(mapping?.e164);
    };
    const patch = (id: string, assistantId: string | null) =>
      vapiFetch(privateKey, phonePath(id), { method: "PATCH", body: { assistantId }, signal });

    try {
      const destination = await syncedAssistant(tx, workspaceId);
      const [workspace] = await tx.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, workspaceId));
      if (workspace?.status !== "active" || destination?.id !== current.assistantId || destination.vapiId !== vapiAssistantId) {
        throw conflict("The destination workspace or its synced agent changed. Review the phone routing.");
      }
      const [selected, replaced, selectedE164, replacedE164] = await Promise.all([
        read(vapiPhoneNumberId), replacedVapiPhoneNumberId ? read(replacedVapiPhoneNumberId) : null,
        current.expectedVapiAssistantId ? readMappedE164(vapiPhoneNumberId, current.sourceWorkspaceId ?? workspaceId) : null,
        replacedVapiPhoneNumberId ? readMappedE164(replacedVapiPhoneNumberId, workspaceId) : null,
      ]);
      const international = checkSelected(current, selected);
      if (current.expectedVapiAssistantId && selectedE164 !== international) {
        throw conflict("The selected number no longer matches its saved assignment. Review the number in Vapi.");
      }
      if (replaced) checkReplaced(current, replaced, replacedE164);

      if (current.status === "pending") {
        // Commit the verified intent before issuing either remote write.
        await tx.update(phoneNumberChanges).set({ status: "applying", e164: international }).where(key(current));
        return "apply" as const;
      }

      if (selected.assistantId !== vapiAssistantId) {
        await patch(vapiPhoneNumberId, vapiAssistantId);
        const verified = await read(vapiPhoneNumberId);
        checkSelected(current, verified);
        if (verified.assistantId !== vapiAssistantId) throw conflict("Vapi has not confirmed the new binding.");
      }
      if (replacedVapiPhoneNumberId) {
        const old = await read(replacedVapiPhoneNumberId);
        checkReplaced(current, old, replacedE164);
        if (old.assistantId) {
          await patch(replacedVapiPhoneNumberId, null);
          const verified = await read(replacedVapiPhoneNumberId);
          checkReplaced(current, verified, replacedE164);
          if (verified.assistantId) throw conflict("Vapi has not confirmed that the previous number was detached.");
        }
        const verified = await read(vapiPhoneNumberId);
        checkSelected(current, verified);
        if (verified.assistantId !== vapiAssistantId) throw conflict("Vapi has not confirmed the new binding.");
      }
    } catch (error) {
      if (!(error instanceof PhoneNumberError) || current.status !== "pending") throw error;
      await tx.update(phoneNumberChanges).set({ status: "rejected", error: error.message, reconcileAt: null }).where(key(current));
      return { status: "rejected", error: error.message } as const;
    }

    await tx.execute(lockReservations);
    const result = completed(current);
    const ownerScope = current.sourceWorkspaceId ?? workspaceId;
    const [saved] = await tx.update(phoneNumbers).set(result.phoneNumber).where(and(
      eq(phoneNumbers.id, current.phoneNumberId), eq(phoneNumbers.workspaceId, ownerScope),
      eq(phoneNumbers.vapiPhoneNumberId, vapiPhoneNumberId),
    )).returning();
    if (!saved) {
      if (current.expectedVapiAssistantId) throw conflict("The local assignment changed during reconciliation.");
      await tx.insert(phoneNumbers).values(result.phoneNumber);
    }
    if (replacedVapiPhoneNumberId) {
      await tx.delete(phoneNumbers).where(and(
        eq(phoneNumbers.workspaceId, workspaceId), eq(phoneNumbers.vapiPhoneNumberId, replacedVapiPhoneNumberId),
      ));
    }
    await tx.update(phoneNumberChanges).set({ status: "completed", error: null, reconcileAt: null }).where(key(current));
    return result;
  });
}

async function reconcileChange(change: PhoneNumberChange): Promise<NumberResult> {
  if (change.status === "completed") return completed(change);
  if (change.status === "rejected") return { status: "rejected", error: change.error! };
  try {
    const { privateKey } = await resolveVapiAccount(change.workspaceId);
    const signal = AbortSignal.timeout(7_000);
    const result = await applyChange(change, privateKey, signal);
    if (result !== "apply") return result;
    const applied = await applyChange(change, privateKey, signal);
    return applied === "apply" ? pending(change) : applied;
  } catch (error) {
    const message = error instanceof PhoneNumberError ? error.message : "Vapi routing is awaiting confirmation.";
    // The reservation remains active if the write was ambiguous or the local commit failed.
    await db.update(phoneNumberChanges).set({ error: message, reconcileAt: new Date(Date.now() + 60_000) })
      .where(and(key(change), isActive)).catch(() => {});
    return pending(change, message);
  }
}

export async function changePhoneNumber(workspaceId: string, request: NumberRequest) {
  return reconcileChange(await reserveChange(workspaceId, request));
}

export async function sweepPhoneNumbers() {
  const changes = await db.select().from(phoneNumberChanges)
    .where(and(isActive, lte(phoneNumberChanges.reconcileAt, new Date())))
    .orderBy(asc(phoneNumberChanges.reconcileAt)).limit(20);
  let examined = 0;
  let waiting = 0;
  const until = Date.now() + 40_000;
  for (const change of changes) {
    if (Date.now() >= until) break;
    const result = await reconcileChange(change);
    examined++;
    if (result.status === "pending") waiting++;
  }
  return { examined, pending: waiting };
}
