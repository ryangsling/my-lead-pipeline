"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

  if (status === "pending") return <span className="text-muted-foreground">Awaiting calendar confirmation</span>;
  if (status === "cancelled" || status === "no_show") return <span className="text-muted-foreground">—</span>;
  return (
    <div className="grid justify-items-start gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
          Manage <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.filter(([value]) => value !== status).map(([value, label]) => (
            <DropdownMenuItem key={value} variant={value === "cancelled" ? "destructive" : "default"}
              onClick={() => set(value)}>{label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span role="alert" className="text-destructive">{error}</span>}
    </div>
  );
}
