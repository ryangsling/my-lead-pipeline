"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Choice = { value: string; label: string };

export function FormSelect({ id, name, label, value, onChange, choices }: {
  id?: string; name?: string; label?: string; value: string;
  onChange?: (value: string) => void; choices: Choice[];
}) {
  return (
    <Select name={name} items={choices} value={onChange ? value : undefined} defaultValue={onChange ? undefined : value}
      onValueChange={onChange && ((next) => { if (typeof next === "string") onChange(next); })}>
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
