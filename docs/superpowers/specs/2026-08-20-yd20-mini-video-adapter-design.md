# YD2.0 Mini Video Adapter Design

## Scope

Integrate the official YD2.0 Mini video API into Shuihuo Production. This is a
server-side video-model adapter. It reuses the existing MySQL task records,
Redis worker queue, task events, and generated-media storage. It does not
place provider credentials in the browser, project data, or diagnostic logs.

The provider contract is:

- Model: `yd2.0-mini`
- Create: `POST https://ydapi.yadiai.cn/openapi/v1/video/create`
- Status: `GET https://ydapi.yadiai.cn/openapi/v1/video/tasks/{taskId}`
- Result: `GET https://ydapi.yadiai.cn/openapi/v1/video/tasks/{taskId}/result`
- Authorization: `Authorization: Bearer <server-side API key>`

## Model Configuration

The model catalog gains the fixed video adapter kind `yd_video`. Administrators
can create an enabled or disabled YD model with a display name and a credential
reference. The provider model code and API endpoints are fixed in the adapter;
they are not user-editable catalog fields.

The administrator sets a reference such as `yd-video-api-key`. The deployed
service supplies its value through `QIANTIE_MODEL_CREDENTIALS`, for example
`yd-video-api-key=sk-yadi-...`. The catalog stores and returns only the
reference, never the secret value.

## Submission Contract

For each video task the adapter sends JSON with these fixed values:

```json
{
  "model": "yd2.0-mini",
  "duration": "1",
  "resolution": "720p",
  "aspect_ratio": "9:16",
  "image_urls": [
    "https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png"
  ]
}
```

`prompt` is the existing server-snapshotted video prompt. `aspect_ratio` may
be `9:16` or `16:9` and is selected with the batch video submission. Other
ratios are rejected. Duration is always one second; the YD selection must not
show or submit the current non-functional 5, 8, or 10 second choices.

The first `image_urls` item is always the fixed `empty.png` URL above. The
remaining four slots are user images. The existing storyboard primary image is
required and is always the final item because YD treats the last item as the
scene image. Before it, the server may include up to three distinct image URLs
from the segment's explicitly bound user assets. This yields:

```text
[empty.png, optional character/prop reference images (0..3), required scene image]
```

No video or audio reference fields are sent. Duplicate image object keys are
removed before URL creation. The worker rejects requests with no scene image,
more than four user images, empty prompts, unsupported ratios, or images that
cannot be converted to public HTTPS URLs.

## Async Task Processing

The worker maps the provider create response `taskId` to the existing
`provider_task_id` and leaves the Shuihuo task in `running`. The poller becomes
an adapter-keyed async-video poller so Vidu and YD tasks can coexist.

For YD tasks it calls the status endpoint and maps `QUEUED`, `SUBMITTED`, and
`RUNNING` to a later poll. On `SUCCESS`, it calls the result endpoint and takes
the first valid public HTTPS video URL from `urls` or `outputs[].url`. It then
downloads the video, saves it through the configured object storage, and uses
the existing compare-and-set completion path so duplicate polls cannot create
duplicate media. `FAILED` writes `provider_task_failed` and the safe
`errorMessage`; malformed or unknown responses write a safe provider-query
failure without provider credentials or response bodies.

## Runtime Storage Boundary

YD receives image URLs from its cloud service. It cannot access the local
development object's `127.0.0.1` URL. Real production submissions therefore
require a configured object-storage implementation that yields public HTTPS or
provider-readable signed URLs, such as TOS or MinIO. Local development may run
unit and HTTP-contract tests with mock public URLs, but must not issue a paid
YD request using local files.

## UI Changes

- The administrator model catalog offers `YD2.0 Mini 图生视频`.
- Batch video generation shows only `9:16` and `16:9` for a selected YD model,
  snapshots that value on every queued task, and states that YD runs at one
  second and 720p.
- Existing image-asset upload and segment binding remains the input path for
  optional reference images. This design does not add a second upload surface
  to the video batch modal.

## Validation

Tests cover the following without a real API key or a paid request:

1. The adapter's create payload has the fixed model, duration, resolution,
   Bearer authentication, mandatory `empty.png`, and image ordering/cap.
2. Missing scene image, non-public source URL, invalid ratio, and provider HTTP
   failures become safe task errors with no credential leakage.
3. Status mapping covers queued, submitted, running, success, failed, and an
   unknown status.
4. Success retrieves the result URL from `urls` and `outputs`, persists media
   exactly once, and survives a second poll.
5. Existing Vidu tests continue to pass, proving both async model types are
   polled independently.
6. Backend tests and the frontend production build pass; browser checks submit
   only mocked or unconfigured requests and do not charge the provider.
