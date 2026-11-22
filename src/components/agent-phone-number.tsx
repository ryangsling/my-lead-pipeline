"use client";

import { useEffect, useRef, useState } from "react";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type NumberOption = { id: string; number: string };
type TransferOption = NumberOption & { workspaceId: string; workspaceName: string };
type Change = { status: "pending" | "applying" | "completed" | "rejected"; error: string | null };
type Inventory = { numbers: NumberOption[]; assigned: NumberOption | null; change: Change | null; operation?: Change | null; providerError?: string | null };

export function AgentPhoneNumber({ workspaceId, assigned, synced }: {
  workspaceId: string;
  assigned: NumberOption | null;
  synced: boolean;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/phone-numbers`;
  const [inventory, setInventory] = useState<Inventory>({ numbers: [], assigned, change: null });
  const [revision, setRevision] = useState(0);
  const [operationId, setOperationId] = useState("");
  const [selected, setSelected] = useState("");
  const [transfers, setTransfers] = useState<TransferOption[] | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loadError, setLoadError] = useState("");
  const retry = useRef<{ numberId: string; source: string | null; id: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const query = operationId ? `?operationId=${operationId}` : "";
        const response = await fetch(endpoint + query, { signal: controller.signal });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error);
        const next = body as Inventory;
        setInventory(next);
        if (next.operation) setFeedback("");
        setLoadError("");
        setSelected(current => next.numbers.some(number => number.id === current) ? current : "");
        if (next.change) timer = setTimeout(load, 5_000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Could not load phone numbers.");
        if (operationId) timer = setTimeout(load, 5_000);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint, operationId, revision]);

  async function loadTransfers() {
    setLoading(true);
    setFeedback("");
    try {
      const response = await fetch(`${endpoint}/reassign`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setTransfers(body.transfers);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load numbers for reassignment.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(numberId: string, sourceWorkspaceId: string | null) {
    setLoading(true);
    setConfirmTransfer(false);
    setFeedback("");
    setOperationId("");
    setInventory(current => ({ ...current, operation: null }));
    if (retry.current?.numberId !== numberId || retry.current.source !== sourceWorkspaceId) {
      retry.current = { numberId, source: sourceWorkspaceId, id: crypto.randomUUID() };
    }
    const id = retry.current.id;
    try {
      const response = await fetch(sourceWorkspaceId ? `${endpoint}/reassign` : endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vapiPhoneNumberId: numberId, operationId: id, ...(sourceWorkspaceId && { sourceWorkspaceId }),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) retry.current = null;
        throw new Error(body.error);
      }
      setOperationId(id);
      setTransfers(null);
      setSelectedTransfer("");
      setSelected("");
      setInventory(current => response.status === 202
        ? { ...current, change: { status: "pending", error: body.error }, operation: null }
        : { ...current, assigned: { id: body.phoneNumber.vapiPhoneNumberId, number: body.phoneNumber.e164 } });
      retry.current = null;
    } catch (error) {
      if (retry.current) setOperationId(id);
      setFeedback(error instanceof Error ? error.message : "Could not confirm the change. Retry to check its status.");
    } finally {
      setRevision(current => current + 1);
      setLoading(false);
    }
  }

  const transfer = transfers?.find(number => number.id === selectedTransfer);
  const disabled = loading || Boolean(inventory.change) || !synced;
  const status = inventory.change
    ? inventory.change.error ?? "Vapi is confirming the phone routing."
    : inventory.operation?.status === "rejected"
      ? inventory.operation.error
      : inventory.operation?.status === "completed" ? "Phone routing confirmed." : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone number</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {inventory.assigned && (
          <p className="text-sm">{inventory.change ? "Last confirmed number" : "Assigned number"} {inventory.assigned.number}</p>
        )}
        <div className="flex gap-2">
          <FormSelect label="Available Vapi phone numbers" value={selected} onChange={setSelected} choices={[
            { value: "", label: "Choose an available number" },
            ...inventory.numbers.map(number => ({ value: number.id, label: number.number })),
          ]} />
          <Button type="button" variant="outline" onClick={() => submit(selected, null)} disabled={disabled || !selected}>
            {inventory.assigned ? "Replace" : "Assign"}
          </Button>
        </div>
        {transfers === null ? (
          <Button type="button" variant="ghost" onClick={loadTransfers} disabled={disabled}>Reassign a workspace number</Button>
        ) : (
          <div className="flex gap-2">
            <FormSelect label="Phone numbers eligible for reassignment" value={selectedTransfer} onChange={setSelectedTransfer} choices={[
              { value: "", label: transfers.length ? "Choose a number to move" : "No numbers eligible for reassignment" },
              ...transfers.map(number => ({ value: number.id, label: `${number.number} · ${number.workspaceName}` })),
            ]} />
            <Button type="button" variant="outline" onClick={() => setConfirmTransfer(true)} disabled={disabled || !transfer}>
              Review reassignment
            </Button>
          </div>
        )}
        {!synced && <p className="text-sm text-muted-foreground">Sync the agent to assign a number.</p>}
        <p role="status" className="text-sm break-words">{feedback || status || loadError || inventory.providerError}</p>
        <Dialog open={confirmTransfer} onOpenChange={setConfirmTransfer}>
          {transfer && (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reassign {transfer.number}</DialogTitle>
                <DialogDescription>
                  Calls to this number will move from {transfer.workspaceName} to this workspace.
                  {inventory.assigned && ` The current number ${inventory.assigned.number} will be detached.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button type="button" disabled={disabled} onClick={() => submit(transfer.id, transfer.workspaceId)}>Reassign number</Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
      </CardContent>
    </Card>
  );
}
