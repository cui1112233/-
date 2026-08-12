# CM Agent Account-Scoped Task Conversations Design

## Goal

Replace the current single CM Agent chat history with account-scoped task conversations. A signed-in user can create, select, rename, clear, and delete independent conversations. Each task and every message is stored by the local qiantie backend under that account, survives server restarts and browser changes, and is never visible to another account.

The work applies only to the CM Agent page and its Express API. It retains the existing CM composer capabilities: modes, experts, selected skills, and text attachments. It does not make attachments, page context, or model configuration persistent conversation data.

## Alternatives Considered

### A. Browser-only task list

Store tasks in `localStorage` and send only the active messages to the current API.

- Advantages: small frontend change and no data migration.
- Disadvantages: disappears when browser storage is cleared, is not available in another browser, and does not meet the confirmed requirement that the backend owns the history.

### B. One global task store shared by all users

Use one `agent-tasks.json` for the server.

- Advantages: simplest file layout.
- Disadvantages: violates account isolation and makes ownership validation difficult.

### C. Per-account backend task store (recommended)

Persist a versioned task document at `users/<safe-username>/agent-tasks.json`; all task operations derive the file only from authenticated `req.username`.

- Advantages: matches the existing per-account agent-history store, survives browser changes and restarts, has a clear migration path, and needs no new database service.
- Disadvantages: synchronous JSON storage is appropriate for the current local single-process service but is not a multi-server data layer.

This specification adopts option C.

## Data Model and Persistence

Each account gets one private file with mode `0600`:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "uuid",
      "title": "第一条用户消息的前二十个字符",
      "titleMode": "automatic",
      "createdAt": "2026-08-12T00:00:00.000Z",
      "updatedAt": "2026-08-12T00:01:00.000Z",
      "messages": [
        { "role": "user", "content": "...", "createdAt": "..." },
        { "role": "assistant", "content": "...", "createdAt": "..." }
      ]
    }
  ]
}
```

- `id` is generated on the server with a UUID and is opaque to the client.
- `titleMode` is `automatic` until a rename request changes it to `manual`.
- The automatic title is derived from the first user message using the first 20 Unicode characters after trimming. An empty newly-created task uses `新聊天` until its first message.
- A task list entry exposes `id`, `title`, `createdAt`, `updatedAt`, `messageCount`, and a bounded final-message preview. It does not expose messages from other tasks.
- A task detail response exposes the selected task and its messages only.
- Retain at most 100 tasks per account and at most 100 valid messages per task. Creating a task when the account already has 100 tasks returns a clear client error; existing conversations are never silently deleted.
- Existing 12,000-character message validation remains in effect. File writes use a same-directory temporary file followed by rename, preserving the private file mode.

## Legacy History Migration

The existing private `agent-history.json` remains the migration source. On the first task-store read for an account where `agent-tasks.json` does not exist:

1. Read and validate the legacy flat messages with the current validation rules.
2. If it has messages, create one task named `历史聊天`, with its first and last valid message times used for `createdAt` and `updatedAt` when available.
3. Write the version-1 task document atomically.
4. Leave `agent-history.json` untouched as a recoverable source; subsequent reads use only `agent-tasks.json`.

If legacy JSON is corrupt or empty, initialize an empty task document. Migration must be idempotent: it never creates a second `历史聊天` task after `agent-tasks.json` exists.

## API Contract

All endpoints require the current `apiAuth` middleware. The server obtains identity solely from `req.username`; no request body or route parameter can select another account.

| Method | Path | Contract |
| --- | --- | --- |
| `GET` | `/api/agent/tasks` | Returns `{ tasks }`, newest `updatedAt` first. |
| `POST` | `/api/agent/tasks` | Creates an empty task and returns `{ task }`. Client title input is not accepted here. |
| `GET` | `/api/agent/tasks/:taskId` | Returns `{ task }` including its messages. Unknown or foreign IDs return `404`. |
| `PATCH` | `/api/agent/tasks/:taskId` | Accepts `{ title }`; validates non-empty trimmed title up to 80 characters, sets `titleMode: "manual"`, and returns `{ task }`. |
| `DELETE` | `/api/agent/tasks/:taskId` | Permanently removes only the selected task and returns `204`. |
| `DELETE` | `/api/agent/tasks/:taskId/messages` | Removes only the selected task messages, retains its title and task record, updates `updatedAt`, and returns `204`. |
| `POST` | `/api/agent/chat` | Requires `{ taskId, prompt, context, skillIds }`; appends the user and assistant messages to that task and returns `{ task, user, assistant }`. |

The current `/api/agent/history` endpoints are replaced atomically with the task frontend. They are internal UI endpoints, so they will not be retained with ambiguous "current task" behavior. Route and UI contract tests will be updated together.

For `POST /chat`, the server validates task ownership before appending a message, resolves skills for `req.username`, and builds model history from only that task's last `HISTORY_WINDOW` persisted messages before the current prompt. Page context, selected skills, attachment content, and model configuration are request-scoped only. They are not written into `agent-tasks.json`.

The current rate limit, internal-information refusal, upstream failure handling, and response validation stay unchanged. Sending controls are disabled while a request is in flight. If a task disappears before the assistant write completes, the request fails without recreating that task.

## Frontend Layout and Behavior

The Agent workbench becomes a two-column CM surface:

1. **Task sidebar:** a `新建聊天` command, compact task rows with title, final-message preview, and formatted update time. The active task is visibly selected. The list is independently scrollable.
2. **Conversation workspace:** the existing CM header, message history, composer, plus-menu, attachment handling, modes, experts, and selected-skill tags remain. The old large left-side skill library moves to the composer `技能` panel, where the existing selection limit and skill CRUD entry points remain available.

The workspace loads the task list first. It opens the most recently updated task, or creates no task until the user chooses `新建聊天` when the list is empty. Selecting a task fetches only that task detail. A send from an empty state first creates a task, then sends to it.

The active-task header provides rename, clear, and delete actions. Delete requires confirmation. Clear requires confirmation and clears only that task's messages. After deletion, the UI selects the next most recently updated task; if none exists it shows the empty state. Rename uses an accessible modal/input rather than editing raw data in the page.

The selected task ID is frontend state, not a trust boundary. It may be remembered locally for convenience, but the server remains authoritative and falls back safely if that task no longer exists.

## Isolation, Failure Handling, and Non-Goals

- Every lookup, rename, clear, delete, append, and skill resolution is scoped to `req.username`. A task ID from another account is indistinguishable from an unknown task (`404`).
- The frontend never reads or writes task JSON directly.
- No message data is shared between accounts, and the feature does not attempt cross-device live sync, collaboration, or administrator access to private Agent histories.
- This change does not persist page snapshots, file attachment bodies, selected mode/expert, selected skills, or upstream credentials. Persisting those requires a separate retention and privacy design.
- This change does not replace the local JSON store with MySQL, alter the CM system prompt, or change other application history pages.

## Acceptance Criteria

1. A signed-in user can create multiple tasks, switch among them, and sees each task's independent messages after browser reload and service restart.
2. The first user message names a new task from its first 20 Unicode characters; a manual rename remains unchanged after later messages.
3. Clear and delete affect only the selected task; the UI never clears all account conversations from a current-task action.
4. A second account cannot list, fetch, rename, clear, delete, or append to a task created by the first account, including when it guesses the task ID.
5. An existing valid `agent-history.json` becomes exactly one visible `历史聊天` task after upgrade, without loss of its valid messages.
6. The model receives only the active task's bounded history plus the current request context; a prior task's content is absent.
7. Store, route, and UI contract tests cover the new behavior, including migration and cross-account rejection. The React build and architecture validator pass.
8. A real authenticated browser check at `/agent` confirms task creation, switching, rename, clear/delete, skill access, and persistent reload behavior without console errors.
