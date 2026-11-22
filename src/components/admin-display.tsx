import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const tones: Record<string, string> = {
  booked: "success", confirmed: "success", sent: "success", ok: "success",
  lead: "info", rescheduled: "info",
  urgent: "danger", failed: "danger",
  pending: "warning", no_show: "warning",
};

export function statusLabel(value: string) {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <Badge className="status-badge" data-tone={tones[status] ?? "muted"}>{statusLabel(status)}</Badge>;
}

export function EmptyState({ children }: { children: string }) {
  return <Card><CardContent><p className="py-2 text-muted-foreground">{children}</p></CardContent></Card>;
}
