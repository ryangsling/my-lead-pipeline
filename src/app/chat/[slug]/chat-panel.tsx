"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ChatPanel({ publicKey }: { publicKey: string }) {
  const session = useRef<string>(null);
  const [turns, setTurns] = useState<{ question: string; answer: string }[]>([]);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  async function send(event: FormEvent) {
    event.preventDefault();
    const question = message.trim();
    if (!question || waiting) return;
    session.current ??= crypto.randomUUID();
    setMessage("");
    setError("");
    setWaiting(true);
    setTurns(current => [...current, { question, answer: "" }]);
    function append(text: string) {
      setTurns(current => current.map((turn, index) => index === current.length - 1 ? { ...turn, answer: turn.answer + text } : turn));
    }
    try {
      const response = await fetch(`/api/public/${encodeURIComponent(publicKey)}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.current, message: question }),
      });
      if (!response.ok || !response.body) {
        setError((await response.json().catch(() => null))?.error ?? "Chat is unavailable. Please try again.");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
      append(decoder.decode());
    } catch {
      setError("The chat connection was interrupted. Please try again.");
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">You’re chatting with an AI assistant.</p>
      <div role="log" aria-label="Chat transcript" className="space-y-4 whitespace-pre-wrap break-words text-sm">
        {turns.map(({ question, answer }, index) => (
          <div className="grid gap-2" key={index}>
            <p className="ml-6 justify-self-end rounded-lg bg-muted px-3 py-2"><span className="sr-only">You: </span>{question}</p>
            {answer && <p className="mr-6 justify-self-start rounded-lg border px-3 py-2"><span className="sr-only">Assistant: </span>{answer}</p>}
          </div>
        ))}
      </div>
      {waiting && <p role="status" className="text-sm text-muted-foreground">Waiting for a reply…</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      <form onSubmit={send} className="space-y-2">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required />
        <Button disabled={waiting || !message.trim()} type="submit">Send</Button>
      </form>
    </div>
  );
}
