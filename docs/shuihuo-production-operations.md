# Shuihuo Production Operations

## Scope

Phase one is a platform-internal chain: reviewed text analysis, Jimeng image
generation, then Vidu image-to-video generation. The browser calls the signed
qiantie gateway; provider credentials stay in the Go service environment.

Do not use values from this document as credentials. Example values are
intentionally redacted.

## Start And Check

Prepare MySQL, object storage, Redis, and the controlled model records. Set
only server-side variable names and redacted examples:

```bash
brew services start redis
export QIANTIE_MYSQL_DSN='REDACTED'
export QIANTIE_REDIS_ADDR='127.0.0.1:6379'
export QIANTIE_STORAGE_DRIVER='local'
export QIANTIE_STORAGE_LOCAL_DIR='../data/shuihuo-objects'
export QIANTIE_STORAGE_PUBLIC_BASE_URL='http://127.0.0.1:4000'
export QIANTIE_MODEL_CREDENTIALS='TEXT_CREDENTIAL=REDACTED,VIDU_CREDENTIAL=REDACTED'
export QIANTIE_MODEL_ENDPOINTS='TEXT_CREDENTIAL=https://text-provider.example.com/v1/completions'
export VOLCENGINE_ACCESS_KEY_ID='REDACTED'
export VOLCENGINE_SECRET_ACCESS_KEY='REDACTED'
export VIDU_API_BASE_URL='https://vidu-provider.example.com'
export VIDU_CREDENTIAL='REDACTED'
cd /Users/ming/Downloads/qiantie/backend
go run ./cmd/qiantie
```

Verify process liveness directly:

```bash
curl -s http://127.0.0.1:4000/healthz
```

Then sign in through qiantie and check `/api/shuihuo-production/health`. It is
ready only when database, Redis, storage, and the enabled `text`, `image`, and
`video` model kinds are ready. An upstream `503` is intentionally returned by
the gateway unchanged so operators can see the blocking category. Health
responses must never include endpoints, credential references, request
templates, provider payloads, or keys.

## First Live Acceptance Record

After the operator has configured their own valid HTTPS provider credentials,
run one manually reviewed project through text candidate generation, a Jimeng
image task, and a Vidu image-to-video task. Record these fields in the
deployment ticket or protected operations log:

- UTC timestamp
- project ID and segment ID
- text, Jimeng, and Vidu model version IDs
- text, image, and video task IDs
- final image and video media IDs
- outcome for every stage
- redacted failure category and provider request/task reference when a stage fails

Do not record original credentials, authorization headers, full upstream
request/response bodies, system prompt bodies, or user source text in the
acceptance record. Unit tests and mocked requests are not live-model evidence.

## Audio And Phase Two

The existing HTTP `/api/tts` proxy is not a Shuihuo worker provider and must
not be used for production audio tasks. Add a separate HTTPS TTS adapter,
credential isolation, task lifecycle, and approval before enabling dubbing.

Video merge, ZIP download, and Jianying draft export are phase-two work. They
require a separately approved design and implementation plan; phase one does
not claim to produce a merged deliverable or an editable Jianying project.
