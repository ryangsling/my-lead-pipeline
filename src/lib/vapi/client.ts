const BASE_URL = "https://api.vapi.ai";

export class VapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "VapiError";
  }
}

/** Billing and credit failures, which the pool switches on in Part 15. */
export class VapiCreditError extends VapiError {
  constructor(message: string, status: number, body: string) {
    super(message, status, body);
    this.name = "VapiCreditError";
  }
}

function providerMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON.
  }
  return body.trim() || `Vapi returned ${status}`;
}

/** Calls the Vapi REST API. Non-2xx throws a VapiError with Vapi's message. */
export async function vapiFetch<T>(
  privateKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${privateKey}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const message = providerMessage(text, response.status);
    if (response.status === 402 || /credit|payment|balance|billing/i.test(message)) {
      throw new VapiCreditError(message, response.status, text);
    }
    throw new VapiError(message, response.status, text);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
