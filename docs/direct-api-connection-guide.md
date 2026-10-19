# Direct API connection guide

This guide explains Sagar's existing direct HTTP API connection and how to reuse
the design in another project. It covers API connections only. The request
examples describe this repository's implementation, not a guarantee that every
compatible provider supports every endpoint or option.

## 1. How it works

```text
Connection settings in React
        ↓ typed Tauri command
Rust validates and saves configuration
        ↓
User selects a provider and model
        ↓
Rust loads the credential and builds a protocol-specific HTTP request
        ↓
Provider streams output over HTTP
        ↓
Rust decodes events → frontend displays progress and generated text
        ↓
Application validates the result → user reviews → application saves
```

Saving a connection does not generate content. Testing a connection requests only
the model list. Actual generation sends the prompt and any application content
included in that prompt to the configured provider.

## 2. Connection fields

| Field | Purpose |
| --- | --- |
| API format | Selects the request format, authentication headers and response decoder. |
| Name | A user-facing name for the saved connection. |
| Base URL | API root, including the required version or gateway path. |
| API key | Credential used by the Rust backend. |
| Model | Provider-specific model identifier. |

In Sagar's AI settings, add a custom provider, fill these fields, choose **Save**,
then **Test**. Select the saved provider and desired model for generation.
Leaving the key blank when editing preserves the saved key; a new connection
requires a nonempty key, including for local services in the current implementation.

Base URLs must use HTTP or HTTPS and contain a host. Embedded credentials, query
parameters and fragments are rejected. Trailing slashes are removed. Use HTTPS
for remote services; HTTP is useful for local development servers.

## 3. Supported protocols

The following are Sagar's current wire formats. `BASE` means the normalized base
URL and `KEY` is the saved secret. Example model names are placeholders.

### OpenAI-compatible Chat Completions

Example base: `https://api.example.com/v1`

```http
POST BASE/chat/completions
Authorization: Bearer KEY
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "model": "your-model-id",
  "messages": [{ "role": "user", "content": "Your prompt" }],
  "stream": true
}
```

When selected, Sagar also adds `reasoning_effort`. Provider support for that field
varies. This adapter uses Chat Completions; a Responses-only endpoint requires a
different adapter. Enter the base URL, excluding `/chat/completions`.

### Gemini-compatible Interactions

Sagar's Gemini adapter uses **Interactions**. A service implementing only
`generateContent` or `streamGenerateContent` needs a separate adapter.

```http
POST BASE/interactions
x-goog-api-key: KEY
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "model": "your-model-id",
  "input": "Your prompt",
  "stream": true,
  "store": false
}
```

The base must include the version path supported by the service. A full URL ending
in `/interactions` is also accepted. A leading `models/` is removed from the model
ID before generation. `store: false` is a request option; it is not a guarantee
about the provider's overall retention policy.

### Anthropic-compatible Messages

```http
POST BASE/messages
Authorization: Bearer KEY
x-api-key: KEY
anthropic-version: 2023-06-01
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "model": "your-model-id",
  "max_tokens": 8192,
  "messages": [{ "role": "user", "content": "Your prompt" }],
  "stream": true
}
```

Sagar sends both authorization headers above for compatibility. It accepts an API
root, a base ending in `/v1`, or a full endpoint ending in `/v1/messages`.
Gateway prefixes are preserved: `https://api.example.com/anthropic` becomes
`https://api.example.com/anthropic/v1`.

The decoder also supports certain compatible gateways returning a complete
Messages JSON response instead of a stream.

## 4. What Test verifies

Sagar sends `GET BASE/models` using the protocol's authentication headers.
OpenAI and Anthropic model lists use `data`; Gemini lists use `models`.
Connection tests have a 10-second timeout and do not follow redirects.

A successful test means the model-list request succeeded. It does not prove that
the selected model can generate, that streaming works, or that sufficient quota
is available. A gateway without a model-list endpoint can fail Test even when its
generation endpoint works. Sagar can report a successful HTTP response as
connected even if it cannot extract a model count.

For a new integration, verify model listing and a small generation request
separately, with an explicit user action for generation.

## 5. Reuse in another project

Keep provider configuration independent from your application's prompts and data.
These are suggested interfaces, not additional APIs already present in Sagar:

```ts
type ApiProtocol = "openai" | "gemini" | "anthropic";

type ProviderSummary = {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

type GenerateInput = {
  providerId: string;
  model: string;
  prompt: string;
};

type GenerationEvent =
  | { jobId: string; kind: "text"; text: string }
  | { jobId: string; kind: "done" }
  | { jobId: string; kind: "failed"; message: string }
  | { jobId: string; kind: "cancelled" };
```

Implement in this order:

1. **Configuration storage:** create, update, list and delete provider settings.
   Return summaries without the saved credential.
2. **Backend validation:** validate protocol, URL, model and key before storage or
   requests. Resolve credentials by provider ID inside the backend.
3. **Connection testing:** request models and report useful status messages.
4. **One generation adapter:** start with the protocol your project requires.
   Build JSON using a serializer and headers using the HTTP client.
5. **Streaming:** buffer incomplete network chunks, decode complete SSE events,
   and extract answer text separately from reasoning or status events. Network
   chunks are not guaranteed to align with events or Unicode characters.
6. **Job management:** assign job IDs, support cancellation, bound output size,
   enforce deadlines and ignore stale results.
7. **Application integration:** build task-specific prompts, validate the final
   result and save through your existing persistence service. Keep partial or
   failed output distinguishable from a completed result.

For a Tauri desktop app, the frontend calls Rust commands; Rust owns outgoing HTTP
requests. For a hosted web app using an application-owned secret, put equivalent
logic on your server. Never bundle that secret into public frontend JavaScript.

## 6. Credential storage and failure handling

Sagar currently stores keys as text in app-owned SQLite. Saved keys are not
returned to the frontend; summaries expose only `hasApiKey`. The entered key
necessarily passes from the settings form to Rust when saved. This is not
encrypted credential storage. For another desktop project, an OS credential store
can hold the key while SQLite stores a credential reference.

Keep keys and prompt content out of logs and user-visible diagnostics. Sagar
disables HTTP redirects, uses a 30-second generation connection timeout and
applies cancellation and an overall job deadline.

| Failure | Suggested user action |
| --- | --- |
| 401 / 403 | Check the key and model access. |
| 404 | Check API format, base path and model identifier. |
| 429 | Check quota or retry later. |
| 5xx | Retry later or check provider availability. |
| Unexpected response format | Verify that the endpoint supports the selected streaming protocol. |
| Interrupted stream | Preserve recoverable output and clearly offer retry. |

Do not automatically retry generation without considering duplicate requests,
cost and whether partial output has already been received.

## 7. Sagar files to study

Paths below are relative to the repository root.

| File | Reusable responsibility |
| --- | --- |
| `src/types/ai.ts` | Frontend provider, selection and event types. |
| `src/lib/tauri/ai.ts` | Typed calls to backend commands. |
| `src/features/settings/AiSettingsDialog.tsx` | Connection form, saved provider list and testing feedback. |
| `src-tauri/src/domain/ai.rs` | Backend provider models and summaries. |
| `src-tauri/src/services/ai.rs` | Configuration validation, URL normalization, model requests and connection tests. Contains other provider code too; extract only the direct API sections. |
| `src-tauri/src/storage/ai_providers.rs` | SQLite provider persistence and backend-only secret reads. |
| `src-tauri/src/services/custom_stream.rs` | Direct HTTP requests, protocol decoders and stream errors. |
| `src-tauri/src/services/ai_translate.rs` | Job lifecycle and Sagar-specific prompt/result handling. Extract the lifecycle separately from EPUB behavior. |

Keep your new project's domain logic separate from the HTTP adapter. Replace
Sagar's EPUB prompts, HTML validation and chapter saving with your own task rules.

## 8. Verification checklist for the new project

- [ ] Create, edit and delete a connection; blank key on edit retains the secret.
- [ ] Reject malformed URLs and unsupported protocols.
- [ ] Never return saved credentials in provider summaries.
- [ ] Test model listing independently from generation.
- [ ] Decode fragmented SSE and split Unicode correctly, including Myanmar text.
- [ ] Handle denied access, quota errors, invalid formats and interrupted streams.
- [ ] Cancel in-flight requests and enforce time/output limits.
- [ ] Prevent older jobs from replacing newer edits.
- [ ] Validate output before accepting or saving it.
- [ ] Verify real provider compatibility separately from local mock tests.

This guide was checked against the repository source. No live provider calls
were made while preparing it.
