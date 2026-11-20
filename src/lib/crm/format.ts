/** 75 becomes 1:15. */
export function duration(seconds: number | null) {
  if (seconds === null) return "-";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function money(usd: string | null) {
  return usd === null ? "-" : `$${Number(usd).toFixed(2)}`;
}

export const channelLabel: Record<string, string> = { phone: "Phone", web_voice: "Web voice", chat: "Chat", form: "Form" };
