# V78 Doubao Local Executor S4 — Live Doubao Browser Adapter

**Date:** 2026-09-01

## Goal

Replace the fake Doubao adapter with a source-controlled Electron browser adapter that can operate the user's isolated Doubao web sessions, submit one exact VIDEO request, recover safely around the acceptance boundary, bind the exact returned media, and hand an exact MP4 to the later artifact-upload slice.

This slice must remain fail-closed: if the live page cannot prove a capability, acceptance, media identity, or official download target, it must stop instead of guessing.

## Current product evidence

- Seedance 2.0 supports text, image, audio, and video inputs at the model level.
- Doubao consumer web/desktop exposes a Seedance 2.0 entry and supports prompt-driven video creation. Public launch material explicitly documented 5s/10s at launch.
- Consumer-web controls can change independently from model capability. Reference-image upload and duration/model options therefore must be detected from the live account page instead of assumed.

## Input contract

- Prompt is required.
- Reference images are optional.
- Prompt-only jobs are valid and must never be blocked by missing images.
- When images are present, the adapter must use the live page's reference-image control when available.
- If images are present but the live page does not expose a compatible reference-image control, fail with `REFERENCE_IMAGES_UNSUPPORTED`; never silently drop the images.
- Requested model, duration, aspect ratio, or other options must be selected only when the live page proves the requested value exists. Unsupported requested values fail explicitly instead of being changed silently.

## Implementation architecture

### 1. Browser session access

Extend `AccountWindows` with a guarded accessor for registered account windows/webContents. All live automation stays inside the account's existing persistent Electron partition.

### 2. Semantic page probe

Add a `DoubaoPageProbe` that inspects the rendered page using semantic evidence rather than unstable generated CSS class names:

- visible text and ARIA labels;
- buttons and menu items;
- textareas/contenteditable inputs;
- file inputs;
- nearby labels for model, duration, ratio, generate/submit, confirmation, verification, and quota states;
- message/card containers and stable DOM/data attributes when exposed.

The probe returns a redacted capability snapshot. It never returns cookies, localStorage, sessionStorage, Authorization headers, or browser credentials.

### 3. Network evidence tracker

Use Electron `webContents.debugger` with the Chromium Network domain to observe request/response metadata for the isolated Doubao window.

The tracker must:

- maintain a pre-submit baseline;
- capture only redacted request/response identity evidence needed for task correlation;
- extract candidate conversation/message/task/media identifiers from JSON metadata when present;
- never persist cookies, request Authorization headers, or full private response bodies;
- provide positive acceptance evidence only when a new request/response can be tied to the current submit attempt.

### 4. Submission flow

For each VIDEO job on one locked account:

1. open/reuse that account window;
2. detect login/verification/quota state;
3. enter/select the Seedance video mode;
4. detect current capabilities;
5. normalize prompt + optional references + requested options;
6. capture DOM/network baseline;
7. upload reference images only when present and supported;
8. enter prompt and requested options;
9. submit once;
10. if a normal non-captcha confirmation appears, confirm at most once;
11. determine one of `accepted`, `not_accepted`, or `unknown` from positive evidence.

### 5. Acceptance recovery

`unknown` is never treated as `not_accepted`.

On an ambiguous network/UI result:

- keep the same account and same page/session;
- rebind/refresh only that account when necessary;
- compare against the pre-submit baseline and network evidence;
- if the previous request is found, return `accepted` with its submission identity;
- retry submission only after bounded recovery positively proves the previous attempt was not accepted.

After acceptance, the adapter never submits again and never switches accounts.

### 6. Exact completion binding

The completed video must be associated with the accepted submission identity using at least one stable identity chain such as:

`conversation -> user message -> generation task -> assistant/media card -> media/download`

If the page/network evidence cannot prove that chain, fail closed. Never choose the newest video, the last `<video>`, or the most recent download globally.

### 7. Verification / quota classification

Detect and return explicit local account states:

- login missing -> `auth_required`
- captcha / human verification -> `human_verification`
- explicit daily quota exhaustion -> `quota_exhausted`
- normal temporary page/network failure -> recoverable error/cooldown, not permanent disable

No captcha bypass is implemented.

### 8. Download handoff

S4 obtains or triggers only the official download action belonging to the exact matched media card. It validates that the downloaded file is plausibly MP4 before returning a local artifact descriptor.

Cloud upload and V78 attachment remain S5. S4 must not mark a cloud job successful with a fake artifact ID.

## TDD order

1. capability/input normalization tests;
2. page-state classification tests;
3. semantic control selection tests;
4. acceptance evidence tests;
5. ambiguous recovery/no-resubmit tests;
6. exact media binding tests;
7. official download/MP4 validation tests;
8. AccountWindows guarded access tests;
9. JobRunner integration with the live adapter interface using deterministic browser/network fixtures;
10. only then wire live Electron polling.

## Completion gate

S4 is complete only when deterministic tests prove:

- prompt-only submission works without any upload call;
- prompt + images requires and uses reference upload support;
- unsupported requested controls fail instead of silently changing;
- ambiguous acceptance never causes duplicate submission;
- accepted jobs stay on the same account;
- unrelated/latest videos are rejected;
- captcha is surfaced for manual action;
- quota is surfaced without permanently disabling the account;
- download retry never regenerates.

Real controlled-account observation is still required before S5/release because public web documentation does not expose stable internal Doubao DOM/network selectors.
