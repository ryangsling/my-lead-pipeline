"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ContactDelete({ workspaceId, contactId, slug }: { workspaceId: string; contactId: string; slug: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function erase() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ workspaceId, id: contactId });
      const response = await fetch(`/api/contacts?${params}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      const { deletionId } = await response.json() as { deletionId: string };
      router.push(`/w/${slug}/settings?deletion=${encodeURIComponent(deletionId)}#data-deletions`);
      router.refresh();
    } catch {
      setError("The contact could not be deleted. Check the contact and try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" />}>Delete contact</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this contact?</DialogTitle>
          <DialogDescription>The hub erases the contact and associated call and job details, keeps appointment times reserved, and queues provider cleanup. Track verification in Settings.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Keep contact</DialogClose>
          <Button type="button" variant="destructive" onClick={erase} disabled={busy}>{busy ? "Deleting…" : "Delete contact"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
