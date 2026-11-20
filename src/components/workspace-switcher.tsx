"use client";

import { useRouter } from "next/navigation";

type Item = { slug: string; name: string };

export function WorkspaceSwitcher({ items, current }: { items: Item[]; current?: string }) {
  const router = useRouter();
  return (
    <select
      aria-label="Workspace"
      value={current ?? ""}
      onChange={(e) => router.push(e.target.value === "__new" ? "/workspaces/new" : `/w/${e.target.value}`)}
      className="h-8 rounded-lg border bg-background px-2 text-sm"
    >
      {!current && <option value="">Select workspace</option>}
      {items.map((w) => (
        <option key={w.slug} value={w.slug}>{w.name}</option>
      ))}
      <option value="__new">+ New workspace</option>
    </select>
  );
}
