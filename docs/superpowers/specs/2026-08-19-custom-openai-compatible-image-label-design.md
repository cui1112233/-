# Custom OpenAI-Compatible Image Provider Label

## Goal

Allow an account to label an OpenAI-compatible image provider as custom without
changing the outbound OpenAI-compatible image-generation protocol.

## Scope

- The settings page offers `OpenAI compatible` and `Custom (OpenAI compatible)` modes.
- Custom mode exposes a required provider display name.
- The saved display name appears in the account image model shown by Shuihuo.
- Base URL, API key, and model remain account-specific and separate from text AI.

## Non-goals

- Do not add arbitrary request paths, authentication schemes, payload mappings,
  or response mappings.
- Do not add Nano Banana or Doubao adapters.
- Do not expose API keys in any response, model list, task snapshot, or error.

## Design

The stable provider identifier remains `openai_compatible`. The UI-only mode
selects either the default display name `OpenAI compatible` or a custom label.
The Node gateway sends `displayName` together with the canonical provider when
the complete account image configuration is synchronized. Go persists the label
with the image config and uses it solely for the synthetic account image model
name. The adapter continues to call `POST {baseUrl}/images/generations` with
the existing OpenAI-compatible request and response contract.

## Validation

Custom mode requires a nonblank display name. A complete image configuration
still requires a Base URL, a model, and an API key before it is synchronized and
made available as a Shuihuo model.
