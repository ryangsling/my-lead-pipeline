"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Item = { slug: string; name: string };

export function WorkspaceSwitcher({ items, current, onNavigate }: { items: Item[]; current?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const choices = [...items.map(({ slug, name }) => ({ value: slug, label: name })), { value: "__new", label: "New workspace" }];
  return (
    <Select items={choices} value={current ?? null} onValueChange={(value) => {
      if (!value) return;
      onNavigate?.();
      router.push(value === "__new" ? "/workspaces/new" : `/w/${value}`);
    }}>
      <SelectTrigger aria-label="Workspace" className="w-full">
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {choices.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
