"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const actions = [
  ["confirmed", "Confirm"],
  ["no_show", "No-show"],
  ["cancelled", "Cancel"],
] as const;

export function AppointmentActions({ workspaceId, id, status }: { workspaceId: string; id: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function set(next: string) {
    setError("");
    const res = await fetch("/api/appointments", {
      method: "PATCH",
      body: JSON.stringify({ workspaceId, id, status: next }),
    });
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Update failed");
  }

  if (status === "cancelled" || status === "no_show") return null;
  return (
    <div className="flex items-center gap-1">
      {actions
        .filter(([value]) => value !== status)
        .map(([value, label]) => (
          <Button key={value} type="button" size="xs" variant="outline" onClick={() => set(value)}>
            {label}
          </Button>
        ))}
      {error && <span className="text-xs">{error}</span>}
    </div>
  );
}
