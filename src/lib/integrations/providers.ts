/** Fields per provider. Secrets are encrypted and masked on read; config values are plain. */
export const providers = {
  vapi: { label: "Vapi", secrets: ["privateKey"], config: ["publicKey"], override: true },
  google: { label: "Google Calendar", secrets: ["refreshToken"], config: [], override: false },
  openrouter: { label: "OpenRouter", secrets: ["apiKey"], config: ["model", "baseUrl"], override: true },
  telegram: { label: "Telegram", secrets: ["botToken"], config: ["chatId"], override: false },
  resend: { label: "Resend", secrets: ["apiKey"], config: ["from"], override: true },
  smtp: { label: "SMTP (fallback)", secrets: ["password"], config: ["host", "port", "user", "from"], override: false },
} as const;

export type Provider = keyof typeof providers;
export const providerNames = Object.keys(providers) as Provider[];
export const isProvider = (v: string): v is Provider => v in providers;
export type Fields = Record<string, string>;
