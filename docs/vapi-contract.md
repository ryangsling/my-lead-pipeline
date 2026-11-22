# Vapi contract

Checked against the current Vapi docs on 2026-11-07. Vapi request and response shapes come from here and from captured fixtures in `tests/fixtures/vapi/`. Re-check this file before changing Vapi code.

Base URL: `https://api.vapi.ai`. Every request sends `Authorization: Bearer <private key>` and `Content-Type: application/json`.

Sources:

- https://docs.vapi.ai/api-reference/assistants/create
- https://docs.vapi.ai/api-reference/tools/create
- https://docs.vapi.ai/server-url/events
- https://docs.vapi.ai/server-url/server-authentication
- https://docs.vapi.ai/assistants/structured-outputs
- https://docs.vapi.ai/api-reference/phone-numbers/list
- https://docs.vapi.ai/api-reference/phone-numbers/update

## Auth between Vapi and the hub (D7)

Vapi's `Server` object on an assistant, tool and phone number accepts `url` and arbitrary `headers`. Vapi now recommends Custom Credentials through `credentialId`, but plain headers still work: a `Server.headers` entry is sent as-is.

Decision: send the workspace secret as `x-vapi-secret` in `server.headers` on the assistant and on each tool. The assistant posts events to `/api/vapi/webhook`; each tool posts calls to `/api/vapi/tools`.

```json
"server": {
  "url": "https://<APP_URL>/api/vapi/webhook",
  "headers": { "x-vapi-secret": "<workspace webhook secret>" }
}
```

Vapi's legacy support also passes `X-Vapi-Secret` unchanged when the credential is a Bearer Token credential with header `X-Vapi-Secret` and no Bearer prefix. If plain headers are ever refused, create one Custom Credential per workspace per Vapi account and send `credentialId` instead. Header names are case-insensitive; the hub compares lowercased header names.

## Assistant

Create: `POST /assistant`. Update: `PATCH /assistant/{id}`. Both take the same body and return the assistant with `id`.

The hub sends:

```json
{
  "name": "Bloom Receptionist",
  "firstMessage": "Hi, you're speaking with Bloom's AI assistant. This call may be recorded. How can I help you today?",
  "firstMessageMode": "assistant-speaks-first",
  "model": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "messages": [{ "role": "system", "content": "<rendered prompt>" }],
    "toolIds": ["<tool id>", "<tool id>", "<tool id>"]
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "<voice id>",
    "model": "eleven_flash_v2_5"
  },
  "server": {
    "url": "https://<APP_URL>/api/vapi/webhook",
    "headers": { "x-vapi-secret": "<workspace webhook secret>" }
  },
  "maxDurationSeconds": 240,
  "artifactPlan": {
    "recordingEnabled": true,
    "structuredOutputIds": ["<structured output id>"]
  },
  "analysisPlan": {
    "summaryPlan": { "enabled": true, "timeoutSeconds": 20 }
  }
}
```

Notes:

- `model.toolIds` attaches reusable tools created with `POST /tool`; `model.tools` would inline them. The docs list both and allow them together. The hub uses `toolIds`, so tools are shared and updated in place.
- `model.messages` is the starting conversation state. The system prompt goes here.
- `analysisPlan` is marked deprecated but still accepted; its `summaryPlan` writes `call.analysis.summary` (D5). Structured data uses Structured Outputs, not `analysisPlan.structuredDataPlan`.
- `maxDurationSeconds` defaults to 600. The hub sends 240 for demos.
- `serverMessages` defaults already include `tool-calls`, `status-update` and `end-of-call-report`; the hub does not set it.
- The rendered prompt keeps `{{today}}` as the Liquid expression `{{"now" | date: "%A %d %B %Y", "<timezone>"}}` (D6). Vapi renders it at call time.

## Tools

Create: `POST /tool`. Update: `PATCH /tool/{id}`. The body for a Function tool:

```json
{
  "type": "function",
  "function": {
    "name": "check_availability",
    "description": "Check open appointment slots for a service on a date or date range.",
    "parameters": {
      "type": "object",
      "properties": {
        "service": { "type": "string", "description": "Service name as listed by the business" },
        "date": { "type": "string", "description": "ISO date, YYYY-MM-DD, for the requested day" },
        "part_of_day": { "type": "string", "enum": ["morning", "afternoon", "evening", "any"] }
      },
      "required": ["service"]
    }
  },
  "server": {
    "url": "https://<APP_URL>/api/vapi/tools",
    "headers": { "x-vapi-secret": "<workspace webhook secret>" }
  },
  "async": false
}
```

The same shape is used for `book_appointment` and `capture_lead`. Tools are synchronous: the assistant waits for the reply. Vapi's server `timeoutSeconds` defaults to 20; the hub's own budget is 1.5 seconds.

## Structured output

Create: `POST /structured-output`. Update: `PATCH /structured-output/{id}`.

```json
{
  "name": "Bloom call fields",
  "type": "ai",
  "schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "phone": { "type": "string" },
      "email": { "type": "string" },
      "service": { "type": "string" },
      "preferred_time": { "type": "string" },
      "booked": { "type": "boolean" },
      "urgency": { "type": "string" }
    }
  }
}
```

Link it to the assistant with `artifactPlan.structuredOutputIds`. The result appears in the end-of-call report at `message.artifact.structuredOutputs[outputId]` as `{ name, result }`.

## Phone numbers

List: `GET /phone-number` returns an array of phone number objects for the account. Each has `id`, `number`, `provider`, `status` and optional `assistantId`.

Assign: `PATCH /phone-number/{id}` with `{ "assistantId": "<vapi assistant id>" }`. The hub stores the assignment in `phone_numbers`.

## Webhooks the hub receives

Every event is a POST with:

```json
{ "message": { "type": "<type>", "call": { ... }, "...": "other fields" } }
```

The hub uses three types in Part 5:

### tool-calls

```json
{
  "message": {
    "type": "tool-calls",
    "call": { "id": "call_...", "assistantId": "asst_..." },
    "toolCallList": [
      {
        "id": "toolu_...",
        "type": "function",
        "function": { "name": "check_availability", "arguments": { "service": "Cut and finish" } }
      }
    ]
  }
}
```

Reply with results for every entry, within the request timeout:

```json
{ "results": [{ "name": "check_availability", "toolCallId": "toolu_...", "result": "spoken sentence" }] }
```

For results with choices, the result string encodes JSON with a spoken sentence and data.options. Each option has a spoken time, UTC start and opaque slot_id. Pass the chosen ID to book_appointment on this call within five minutes. The endpoint accepts one to eight entries and replays completed results by tool call ID. A 503 means the previous execution is pending. An interrupted claim requires checking the appointment and calendar before another booking attempt.

### status-update

```json
{ "message": { "type": "status-update", "status": "ended", "call": { "id": "call_...", "assistantId": "asst_..." } } }
```

Statuses: `scheduled`, `queued`, `ringing`, `in-progress`, `forwarding`, `ended`.

### end-of-call-report

```json
{
  "message": {
    "type": "end-of-call-report",
    "endedReason": "customer-ended-call",
    "cost": 0.0221,
    "costBreakdown": { "total": 0.0221 },
    "analysis": { "summary": "Two-line summary" },
    "call": {
      "id": "call_...",
      "assistantId": "asst_...",
      "cost": 0,
      "status": "queued"
    },
    "artifact": {
      "recordingUrl": "https://...",
      "transcript": "AI: ... User: ...",
      "messages": [{ "role": "assistant", "message": "How can I help?" }],
      "structuredOutputs": {
        "<outputId>": { "name": "Bloom call fields", "result": { "booked": true }, "compliancePlan": null }
      }
    }
  }
}
```

Field locations confirmed by the first real call on 2026-11-07 (fixtures in `tests/fixtures/vapi/`):

| Field | Location |
| --- | --- |
| Cost | `message.cost` (USD). `message.call.cost` was `0` in the captured report, so do not use it |
| Cost breakdown | `message.costBreakdown.total` |
| Summary | `message.analysis.summary` |
| Ended reason | `message.endedReason`; `message.call.status` was still `queued`, so do not infer the end from it |
| Transcript | `message.artifact.transcript` (a JSON string of turns) and `message.artifact.messages` |
| Recording URL | `message.artifact.recordingUrl` (also `message.recordingUrl`) |
| Structured output | `message.artifact.structuredOutputs[outputId].result` |

Vapi echoes the assistant under `message.assistant`, including `server.headers` and each tool's `server.headers`, which contain `x-vapi-secret`. The webhook strips every `server.headers` before storing the raw payload (`stripServerHeaders` in the webhook route). Keep that behaviour when Part 8 starts reading raw rows.

The `tool-calls` fixture is captured in Part 7, when `/api/vapi/tools` exists.

## Idempotency keys

- `end-of-call-report`: external id is the call id.
- `status-update`: external id is `<callId>:<status>`.

## What the hub does with an incoming webhook

1. Parse `message.type` and `message.call.assistantId`.
2. Look up `assistant_syncs` by `vapi_assistant_id` to resolve the assistant and workspace.
3. Compare `x-vapi-secret` with the workspace's decrypted secret in constant time.
4. Insert the raw payload into `webhook_events` with `onConflictDoNothing`; return 200 immediately.
5. Processing happens in `after()` from Part 8.

A missing assistant or a missing or wrong secret returns 401. Everything else is stored and acknowledged so Vapi does not retry.
