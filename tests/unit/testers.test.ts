import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { testProvider, findTelegramChats } = await import("@/lib/integrations/testers");

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fail = (status: number, body: string) => new HttpResponse(body, { status });

describe("testProvider", () => {
  it("vapi: passes when assistants and phone numbers both list", async () => {
    server.use(
      http.get("https://api.vapi.ai/assistant", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer key");
        return HttpResponse.json([]);
      }),
      http.get("https://api.vapi.ai/phone-number", () => HttpResponse.json([])),
    );
    expect(await testProvider("vapi", { privateKey: "key" })).toEqual({ ok: true });
  });

  it("vapi: returns Vapi's error text unchanged", async () => {
    server.use(http.get("https://api.vapi.ai/assistant", () => fail(401, '{"message":"Invalid Key"}')));
    expect(await testProvider("vapi", { privateKey: "bad" })).toEqual({ ok: false, error: '{"message":"Invalid Key"}' });
  });

  it("openrouter: sends a 1-token request with the model", async () => {
    server.use(
      http.post("https://openrouter.ai/api/v1/chat/completions", async ({ request }) => {
        const body = (await request.json()) as { model: string; max_tokens: number };
        expect(body).toMatchObject({ model: "openai/gpt-4o-mini", max_tokens: 1 });
        return HttpResponse.json({ choices: [] });
      }),
    );
    expect(await testProvider("openrouter", { apiKey: "k", model: "openai/gpt-4o-mini" })).toEqual({ ok: true });
  });

  it("openrouter: returns the provider error", async () => {
    server.use(http.post("https://openrouter.ai/api/v1/chat/completions", () => fail(402, "No credits")));
    expect(await testProvider("openrouter", { apiKey: "k", model: "m" })).toEqual({ ok: false, error: "No credits" });
  });

  it("openrouter: ignores a trailing slash on the base URL", async () => {
    server.use(http.post("https://openrouter.ai/api/v1/chat/completions", () => HttpResponse.json({ choices: [] })));
    const fields = { apiKey: "k", model: "m", baseUrl: "https://openrouter.ai/api/v1/" };
    expect(await testProvider("openrouter", fields)).toEqual({ ok: true });
  });

  it("telegram: sends 'Agent Hub test message' to the chat", async () => {
    server.use(
      http.post("https://api.telegram.org/botT/sendMessage", async ({ request }) => {
        expect(await request.json()).toEqual({ chat_id: "42", text: "Agent Hub test message" });
        return HttpResponse.json({ ok: true });
      }),
    );
    expect(await testProvider("telegram", { botToken: "T", chatId: "42" })).toEqual({ ok: true });
  });

  it("telegram: returns the provider error", async () => {
    server.use(http.post("https://api.telegram.org/botT/sendMessage", () => fail(400, "chat not found")));
    expect(await testProvider("telegram", { botToken: "T", chatId: "1" })).toEqual({ ok: false, error: "chat not found" });
  });

  it("resend: sends a test email to the admin", async () => {
    server.use(
      http.post("https://api.resend.com/emails", async ({ request }) => {
        expect(await request.json()).toMatchObject({ from: "hub@incodet.com", to: ["me@x.com"] });
        return HttpResponse.json({ id: "1" });
      }),
    );
    expect(await testProvider("resend", { apiKey: "k", from: "hub@incodet.com", to: "me@x.com" })).toEqual({ ok: true });
  });

  it("resend: returns the provider error", async () => {
    server.use(http.post("https://api.resend.com/emails", () => fail(403, "domain not verified")));
    expect(await testProvider("resend", { apiKey: "k", from: "a@b.c", to: "me@x.com" })).toEqual({
      ok: false,
      error: "domain not verified",
    });
  });

  it("smtp: passes when the mail is sent, returns the error when it is not", async () => {
    const f = { host: "h", port: "587", user: "u", password: "p", from: "a@b.c", to: "me@x.com" };
    sendMail.mockResolvedValueOnce({});
    expect(await testProvider("smtp", f)).toEqual({ ok: true });
    sendMail.mockRejectedValueOnce(new Error("Invalid login"));
    expect(await testProvider("smtp", f)).toEqual({ ok: false, error: "Invalid login" });
  });

  it("names the missing fields without calling the provider", async () => {
    expect(await testProvider("telegram", { botToken: "T" })).toEqual({ ok: false, error: "Missing: chatId" });
  });

  it("returns a network failure as an error", async () => {
    server.use(http.post("https://api.telegram.org/botT/sendMessage", () => HttpResponse.error()));
    const result = await testProvider("telegram", { botToken: "T", chatId: "1" });
    expect(result.ok).toBe(false);
  });
});

describe("findTelegramChats", () => {
  it("lists each chat once", async () => {
    const msg = (id: number, first_name: string) => ({ message: { chat: { id, first_name } } });
    server.use(
      http.get("https://api.telegram.org/botT/getUpdates", () => HttpResponse.json({ result: [msg(7, "Sam"), msg(7, "Sam"), msg(8, "Kim")] })),
    );
    expect(await findTelegramChats("T")).toEqual([
      { id: "7", name: "Sam" },
      { id: "8", name: "Kim" },
    ]);
  });
});
