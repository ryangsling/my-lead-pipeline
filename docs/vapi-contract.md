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
- https://docs.vapi.ai/api-reference/phone-numbers/get
- https://docs.vapi.ai/api-reference/phone-numbers/update
- https://github.com/VapiAI/server-sdk-typescript

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
  "firstMessage": "Hi, this is the AI assistant for Bloom. This call will continue without an audio recording. How can I help you today?",
  "firstMessageMode": "assistant-speaks-first",
  "firstMessageInterruptionsEnabled": false,
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
    "recordingEnabled": false,
    "videoRecordingEnabled": false,
    "pcapEnabled": false,
    "structuredOutputIds": ["<structured output id>"]
  },
  "monitorPlan": { "listenEnabled": false, "controlEnabled": false },
  "compliancePlan": {},
  "analysisPlan": {
    "summaryPlan": { "enabled": true, "timeoutSeconds": 20 }
  }
}
```

Notes:

- `model.toolIds` attaches reusable tools created with `POST /tool`; `model.tools` inlines the native transfer tool when enabled. The hub creates a new reusable tool when its desired configuration changes.
- `model.messages` is the starting conversation state. The system prompt goes here.
- `analysisPlan` is marked deprecated but still accepted; its `summaryPlan` writes `call.analysis.summary` (D5). Structured data uses Structured Outputs, not `analysisPlan.structuredDataPlan`.
- `maxDurationSeconds` defaults to 600. The hub sends 240 for demos.
- `serverMessages` defaults already include `tool-calls`, `status-update` and `end-of-call-report`; the hub does not set it.
- The rendered prompt keeps `{{today}}` as the Liquid expression `{{"now" | date: "%A %d %B %Y", "<timezone>"}}` (D6). Vapi renders it at call time.

## Recording consent

Migration 0016 defaults new workspaces to recording off. A workspace's recording preference requires its UUID in the server's `VAPI_VERIFIED_RECORDING_WORKSPACE_IDS` as well as an assistant sync. The list defaults to empty. Leave production entries empty until counsel approves the policy and controlled calls establish that it works on the exact provider and account in use. Existing preferences remain saved. Existing Vapi assistants keep their provider settings until updated. Before resuming real calls after rollout, sync every previously published assistant and verify its resulting Vapi settings and phone bindings. A failed recording update requires checking the provider and keeping the affected call path paused. Sync first makes unsafe legacy configurations unrecorded before staging resources, then reads recording, consent and monitoring settings back before publishing.

Vapi's published TypeScript SDK describes `compliancePlan.recordingConsentPlan` as a consent prompt before the main assistant joins. Use `type: "verbal"`, `firstMessageMode: "assistant-speaks-first"`, and the fixed question “Hi, this is the AI assistant for [business]. May we record this call? Please say yes or no.” A Vapi `declineTool` of type `endCall` requests a blocking goodbye that points callers to the business website. The first line of the main assistant's greeting after consent is “This call is being recorded.” The unrecorded assistant identifies itself as AI and says the call will continue without an audio recording. Audio recording is enabled only for the verified verbal-consent configuration. Video, SIP packet capture, and live monitor controls are disabled in both modes. [Consent plan](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/CompliancePlanRecordingConsentPlan.ts) · [Verbal consent](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/RecordingConsentPlanVerbal.ts) · [Artifact settings](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/ArtifactPlan.ts)

Vapi documents the final result at `message.compliance.recordingConsent` in the end-of-call report and `compliance.recordingConsent` in `GET /call/{id}`. The hub also accepts that result in `message.call.compliance`. An ISO timestamp in `grantedAt` with `type: "verbal"` is required. If both webhook locations report a result, they must agree. When Vapi supplies call creation or end times, the grant must fall within those bounds. Audio links in new receipts and conversations require the workspace policy and this evidence. Video, packet capture and monitoring links are stripped even with a valid audio grant. Playback requires the same call ID and grant in Vapi's current response before the hub redirects to a signed URL. Pre-migration recordings without a saved grant are hidden. Transcription, summary and intake records are part of the normal unrecorded receptionist flow and need separate counsel review. [Consent result](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/RecordingConsent.ts) · [End-of-call report](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/types/ServerMessageEndOfCallReport.ts)

### Counsel decisions before activation

- Determine which jurisdictions and parties the policy must cover, whether the AI and recording disclosures are sufficient, and whether recording the confirmation itself or any audio before it is allowed. Approve the exact consent question, post-consent first line, refusal message, and available alternate contact.
- Decide what counts as affirmative consent, how to handle silence, ambiguous answers, interrupted disclosures, third parties and later withdrawal, and how calls involving an urgent need are routed when recording cannot proceed.
- Review what the provider and carriers can process or keep before consent and during unrecorded calls, including transcripts, logs, structured data and call summaries. Decide which processing and evidence may be kept and how long.

### Controlled provider checks before activation

1. Use an isolated Vapi account or workspace and a controlled test number with informed testers. Verify exact `POST`, `PATCH`, and `GET` behavior, including clearing the consent plan on a downgrade or rollback and reading back disabled audio, video, packet capture and monitoring. Confirm the active inbound number and browser button resolve to the tested assistant with no number-level or carrier recording override.
2. Call the number and test the browser where enabled. On an explicit yes, play the resulting artifact and confirm capture starts only after consent and begins with “This call is being recorded.” Confirm the consent timestamp appears in the webhook and call retrieval and that the hub only exposes the corresponding recording.
3. Try an explicit no, silence to timeout, unclear speech, an interruption during the disclosure, and hangup before consent. Confirm no path joins the recorded assistant, no audio or video is captured at any provider stage, and the refusal message and alternate route work. Confirm the timeout behavior and any reprompt limits directly. The SDK does not specify verbal timeout and capture timing.
4. Test the unrecorded path and a downgrade on the same account. Confirm truthful AI and no-recording disclosures, ordinary receptionist functionality, and absence of new audio and video artifacts, monitor links and packet captures. Check transfers, consent withdrawal and urgent fallbacks against counsel's decisions before using those paths with callers.

The installed SDK and the provider's published types were checked. Counsel approval and controlled provider calls are pending.

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

## Sync and recovery

Migration 0014 adds a sync lease per assistant and Vapi account, hashes for the desired and published configurations, and durable checkpoints for each resource create. A sync can issue requests for up to 35 seconds under a 60-second lease. Concurrent requests return a busy result and can retry after the active sync finishes.

The hub stages changed tools and structured outputs separately, reuses confirmed resources for unchanged versions, and sends the complete assistant configuration and resource IDs in one `PATCH /assistant/{id}`. It reads back the prompt and resource IDs before recording the revision as applied or rebinding a number. If Vapi still reports earlier values, retry sync to apply the complete revision using the saved resource IDs. Older tools and outputs remain available to calls that already reference them. For legacy sync rows, the first sync stages versioned dependencies before updating the existing assistant. The assistant keeps its ID while Vapi reports it exists.

A create checkpoint has a unique marker before the hub sends the `POST`. Assistants store it in `metadata.incodetSyncCreate`, function tools put it in the webhook URL query, and structured outputs store it in `description`. On an interrupted create, the hub checks `GET /assistant` or `GET /tool` as an array with creation-time filters, or `GET /structured-output` as a paginated `results` response. It adopts only a matching marker. These list and marker shapes are supported by the published Vapi TypeScript SDK. Confirm their round trip against a test Vapi account before relying on live recovery.

If Vapi reports creation is awaiting confirmation, retry sync to check the inventory again. Only after Vapi confirms the original request did not create a resource should an operator remove that specific unresolved entry from `assistant_syncs.resource_checkpoints`. Wait until the sync lease is idle, and leave any checkpoint with a remote ID in place. The published API has no documented create idempotency or conditional assistant update. A timed-out assistant update can still arrive at Vapi later as a complete configuration. Re-sync if the provider shows an older version after a timeout.

## Phone numbers

List: `GET /phone-number` returns an array of phone number objects for the account. Each has `id`, `number`, `provider`, `status` and optional `assistantId`.

The hub uses `GET /phone-number/{id}` to resolve the selected E.164 value and verify routing. Number records with a local owner, a remote assistant, or other number-level routing are unavailable for ordinary assignment. The separate reassignment action requires the known source workspace and verifies its current Vapi binding. Before moving or detaching a locally assigned number, the hub checks that its normalized E.164 value agrees with Vapi. If the values differ, verify the workspace and actual number in Vapi before correcting the saved mapping.

The hub records each change in `phone_number_changes` before calling Vapi. It binds the selected number with `PATCH /phone-number/{id}` and `{ "assistantId": "<vapi assistant id>" }`, then detaches any replaced number with `{ "assistantId": null }`. The hub reads both bindings back before committing the new `phone_numbers` mapping. The authenticated `/api/cron/sweep` retries changes awaiting confirmation. A partial change keeps both workspaces and numbers reserved. If Vapi reports unexpected routing, check the number in the Vapi dashboard and resolve the ownership mismatch before the change can settle.

If Vapi reports a published assistant missing, the hub checkpoints the rebuilt assistant and checks the workspace's assigned number. It verifies the E.164 value and binds the number when it is unbound or attached to the missing assistant. The hub reads the number back before publishing the replacement ID. If the response is lost, retry assistant sync to verify the binding. Review unexpected routing in the Vapi dashboard before retrying.

The account's live provider still needs verification. On a controlled US test number, verify that the private key sees that exact number and can route to both synced assistants, that setting `assistantId` to `null` clears the binding and has the expected inbound behavior, and that org-level fallback routing does not redirect detached calls. Verify read-after-write timing and place real inbound calls to check the intended assistant, then check the former number after replacement and the transferred number after reassignment. Vapi's SDK describes the assistant field as an optional string, and the hub requires readback confirmation even when Vapi accepts the PATCH. The API contract used here does not specify conditional updates, so dashboard edits during a hub change can race it.

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
2. Look up the published or replacement assistant ID in `assistant_syncs` to resolve exactly one workspace.
3. Compare `x-vapi-secret` with the workspace's decrypted secret in constant time.
4. Store the sanitized payload in `webhook_events`, keyed by the authenticated workspace, source and external ID. Return 200 after storing the receipt.
5. Process eligible end-of-call reports in `after()`. Duplicate deliveries and the authenticated sweep can reclaim retryable or interrupted work. Processing stores the conversation and queues its notifications before marking the receipt complete.

A missing or wrong secret, an unknown assistant, or an assistant ID mapped to multiple workspaces returns 401. Required fields missing from a payload return 400.

## Call erasure

The provider SDK defines single-call deletion as `DELETE /call/{id}` with an optional bulk-ID body. The hub uses the single-call path, verifies the authenticated `GET /call/{id}` assistant and checkpoints account ownership before deleting. Afterward it checks for 404 or 410 on the call and on its five `GET /call/{id}/{mono,stereo,customer,assistant,video}-recording` routes. Redirects are treated as live media, and the hub does not follow them. For the operator terms and live signed-URL checks, see [Data retention](DATA-RETENTION.md). [Vapi published calls SDK](https://github.com/VapiAI/server-sdk-typescript/blob/main/src/api/resources/calls/client/Client.ts).
