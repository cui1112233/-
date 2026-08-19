# Account OpenAI-Compatible Image Settings Design

**Date:** 2026-08-19  
**Status:** Approved for planning  
**Scope:** `/settings` account settings and Shuihuo image-task execution

## Goal

Let each account configure an image-generation provider independently from its text model. Version one supports the **OpenAI-compatible** provider only, while retaining an explicit provider boundary for later Nano Banana and Doubao image adapters. The configured image provider must be usable by Shuihuo image tasks without exposing the image API key to the browser, other accounts, task lists, or model catalogs.

## Non-goals

- Do not change text-model settings or reuse their URL/key.
- Do not change the administrator-owned model center or its credential-reference policy.
- Do not make a browser-to-model request.
- Do not send a real request to a user-provided upstream provider during implementation or automated verification.
- Do not implement Nano Banana, Doubao, nonstandard endpoint paths, asynchronous image polling, image-to-image, video, or audio in this increment.

## User Experience

`/settings` gains a separate **Image generation provider** section with these fields:

- Image provider selector. Version one has the single enabled option **OpenAI-compatible**.
- Image Base URL
- Image API Key
- Image model name

The provider selector is independent of the text provider selector. The image API key field is blank when settings load and has the existing "leave blank to keep saved key" behavior. The page displays whether an image key has been saved, never its value. Saving text fields must not erase image fields and saving image fields must not replace the text URL, key, or model.

When the three image fields are complete, Shuihuo exposes a per-account image choice named **Current account OpenAI-compatible image model**. When they are incomplete, that choice is absent (or disabled with a clear configuration message) and existing administrator-configured image models retain their current behavior.

## Data Model

Add an account-scoped `image_api_configs` table with one row per `users.id`:

- `user_id` unique foreign key to `users(id)` with cascade delete
- `provider` (initial value: `openai_compatible`)
- `base_url`
- `model`
- `api_key_ciphertext`
- created/updated timestamps

The name `api_key_ciphertext` matches the existing account configuration contract. This change does not claim at-rest encryption where the current codebase does not implement it; it preserves the established storage field and keeps the value server-only.

`store.ImageAPIConfig` and `store.ImageConfigs` provide `Get` and upsert `Save` methods. A missing row represents an unconfigured image provider.

## API Contract

Extend the existing authenticated account configuration request/response with an `image` object:

```json
{
  "image": {
    "provider": "openai_compatible",
    "baseUrl": "https://provider.example/v1",
    "model": "image-model-id",
    "hasApiKey": true
  }
}
```

`POST /api/config` accepts `image.provider`, `image.baseUrl`, `image.model`, and optional `image.apiKey`. Empty `image.apiKey` preserves a previously saved key. Image fields are validated as a complete unit when any non-key image field is submitted: provider, Base URL, and model are required; a new configuration also requires a key. Version one accepts only `openai_compatible` and rejects unknown providers.

The platform gateway keeps its existing signed forwarding behavior. It may carry the incoming key to Go only over its existing local trusted bridge and must never log it or return it. Read responses omit `image.apiKey`.

## Task Execution

Add a provider router for account image settings. In version one it registers one dedicated server-side `openai_compatible_image` adapter. The adapter resolves the current task owner’s `image_api_configs` row rather than a catalog credential reference, then submits:

```text
POST {normalized image Base URL}/images/generations
Authorization: Bearer {account image API key}
Content-Type: application/json

{ "model": "...", "prompt": "..." }
```

The adapter accepts the standard synchronous OpenAI shape `data[0].url`. Missing configuration, invalid URL, network failure, non-2xx response, malformed JSON, or a missing URL produce a task error that is safe to show to the user and does not include the key.

The task snapshot keeps the prompt, selected account-backed provider/adapter identity, and configured model name. It must not contain the base URL or API key. The worker resolves the owner configuration at execution time, so configuration remains account-isolated and is never represented as a shared browser-controlled catalog credential. Adding Nano Banana or Doubao later means registering their adapters and enabling their provider values; it does not require changing account isolation, the browser key boundary, or task ownership.

## Safety and Isolation

- Outbound URL validation uses the existing server-side validation policy before requesting the provider.
- The key is never returned from `GET /api/config`, public model listing, admin listing, task input, error text, or logs.
- A task may use only the configuration of its owner. A request cannot provide another user ID, endpoint, key, or model override.
- Existing `jimeng_image`, generic catalog models, and administrator role checks remain unchanged.

## Tests and Acceptance

1. Store tests prove independent image rows per user and an absent row reads as unconfigured.
2. HTTP tests prove a save/read round-trip reports the provider and `hasApiKey` but never returns the key; blank key preserves a saved key; incomplete first-time image settings and unknown providers are rejected.
3. Adapter tests use a local fake server to verify the exact `/images/generations` request, bearer header, body model/prompt, URL parsing, and credential redaction on an upstream error.
4. Task tests prove the current-account model cannot execute without complete image settings and resolves only the task owner configuration.
5. Frontend contract/build checks prove `/settings` has a distinct image provider, URL, key, and model configuration and does not populate the key on load.
6. Existing model catalog and legacy image task tests remain green.

## Operational Note

This feature only proves local request construction and route behavior against a fake upstream. A real image generation remains dependent on a valid user-owned provider URL, API key, model ID, quota, and provider support for the OpenAI-compatible image-generation endpoint.
