# 用户数据隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个登录账号拥有独立 API 配置和生成历史，并把旧根目录数据迁到主账号 `choushiyiguai`。

**Architecture:** `lib/shared.js` 提供用户数据路径、迁移和读写工具；API 路由通过 `req.username` 访问当前用户数据。旧根目录 `api-config.json` 和 `outputs/` 只作为主账号迁移来源，不删除。

**Tech Stack:** Node.js CommonJS、Express、Node 内置 `fs/path/http/https`、原生 JSON 文件存储。

---

## File Structure

- Modify: `.gitignore`
  - 忽略新运行时敏感目录 `data/users/`。
- Modify: `lib/shared.js`
  - 新增用户目录、配置迁移、历史迁移和按用户读写工具。
- Modify: `routes/config.js`
  - `GET/POST /api/config` 使用 `req.username`。
- Modify: `routes/chat.js`
  - `/api/test` 和 `/api/chat` 使用 `req.username` 的配置。
- Modify: `routes/history.js`
  - 所有历史读写使用 `req.username` 的输出目录。
- Modify: `docs/技术文档.md`
  - 将“用户隔离未完成”改为“已按账号隔离”，并保留旧数据迁移说明。

---

### Task 1: Ignore Per-User Runtime Data

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add user runtime data ignore rule**

Add this block to `.gitignore` after the existing `outputs/` rule:

```gitignore
# 用户运行时数据
data/users/
```

- [ ] **Step 2: Verify ignore behavior**

Run:

```bash
git check-ignore data/users/choushiyiguai/api-config.json
```

Expected output:

```text
data/users/choushiyiguai/api-config.json
```

- [ ] **Step 3: Commit**

Run:

```bash
git add .gitignore
git commit -m "chore: ignore per-user runtime data"
```

Expected: commit contains only `.gitignore`.

---

### Task 2: Add User Storage Helpers

**Files:**
- Modify: `lib/shared.js`

- [ ] **Step 1: Add constants**

In `lib/shared.js`, after `HISTORY_INDEX`, add:

```js
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const PRIMARY_USER = 'choushiyiguai';
```

- [ ] **Step 2: Add path helpers and migration helpers**

In `lib/shared.js`, before the config read/write section, add helpers:

```js
function safeUserName(username) {
  const value = String(username || '').trim();
  if (!value || !USERS[value]) {
    throw new Error('Invalid user');
  }
  return value;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getUserDir(username) {
  return path.join(USERS_DIR, safeUserName(username));
}

function getUserConfigPath(username) {
  return path.join(getUserDir(username), 'api-config.json');
}

function getUserOutputsDir(username) {
  return path.join(getUserDir(username), 'outputs');
}

function getUserHistoryIndex(username) {
  return path.join(getUserOutputsDir(username), 'index.json');
}

function ensureUserDir(username) {
  ensureDir(getUserDir(username));
}

function ensureUserOutputsDir(username) {
  ensureDir(getUserOutputsDir(username));
}

function migrateLegacyConfigIfNeeded(username) {
  const user = safeUserName(username);
  const userConfigPath = getUserConfigPath(user);
  if (user !== PRIMARY_USER) return;
  if (fs.existsSync(userConfigPath)) return;
  if (!fs.existsSync(CONFIG_PATH)) return;
  ensureUserDir(user);
  fs.copyFileSync(CONFIG_PATH, userConfigPath);
}

function migrateLegacyHistoryIfNeeded(username) {
  const user = safeUserName(username);
  const userHistoryIndex = getUserHistoryIndex(user);
  if (user !== PRIMARY_USER) return;
  if (fs.existsSync(userHistoryIndex)) return;
  if (!fs.existsSync(HISTORY_INDEX)) return;
  ensureUserOutputsDir(user);
  fs.copyFileSync(HISTORY_INDEX, userHistoryIndex);
  if (fs.existsSync(OUTPUTS_DIR)) {
    for (const name of fs.readdirSync(OUTPUTS_DIR)) {
      if (!name.endsWith('.txt')) continue;
      fs.copyFileSync(path.join(OUTPUTS_DIR, name), path.join(getUserOutputsDir(user), name));
    }
  }
}
```

- [ ] **Step 3: Change config helpers to accept username**

Replace `readConfig()` and `writeConfig(config)` with:

```js
function readConfig(username) {
  migrateLegacyConfigIfNeeded(username);
  const configPath = getUserConfigPath(username);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...savedConfig };
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(username, config) {
  ensureUserDir(username);
  fs.writeFileSync(getUserConfigPath(username), JSON.stringify(config, null, 2), 'utf8');
}
```

- [ ] **Step 4: Change history helpers to accept username**

Replace `ensureOutputsDir()`, `readHistoryIndex()`, and `writeHistoryIndex(data)` with:

```js
function ensureOutputsDir(username) {
  ensureUserOutputsDir(username);
}

function readHistoryIndex(username) {
  migrateLegacyHistoryIfNeeded(username);
  ensureUserOutputsDir(username);
  const historyIndex = getUserHistoryIndex(username);
  if (!fs.existsSync(historyIndex)) return { entries: [] };
  try {
    return JSON.parse(fs.readFileSync(historyIndex, 'utf8'));
  } catch (e) {
    return { entries: [] };
  }
}

function writeHistoryIndex(username, data) {
  ensureUserOutputsDir(username);
  fs.writeFileSync(getUserHistoryIndex(username), JSON.stringify(data, null, 2), 'utf8');
}
```

- [ ] **Step 5: Export new helpers**

In `module.exports`, include:

```js
DATA_DIR, USERS_DIR, PRIMARY_USER,
safeUserName, getUserDir, getUserConfigPath, getUserOutputsDir, getUserHistoryIndex,
ensureUserDir, ensureUserOutputsDir,
```

- [ ] **Step 6: Syntax check**

Run:

```bash
node -c lib/shared.js
```

Expected: no output and exit code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/shared.js
git commit -m "feat: add per-user storage helpers"
```

Expected: commit contains only `lib/shared.js`.

---

### Task 3: Use Per-User Config In Config And Chat Routes

**Files:**
- Modify: `routes/config.js`
- Modify: `routes/chat.js`

- [ ] **Step 1: Update config route**

In `routes/config.js`:

```js
router.get('/', (req, res) => {
  res.json(publicConfig(readConfig(req.username)));
});
```

and:

```js
const oldConfig = readConfig(req.username);
```

then:

```js
writeConfig(req.username, nextConfig);
```

- [ ] **Step 2: Update chat route config reads**

In `routes/chat.js`, replace both:

```js
const config = readConfig();
```

with:

```js
const config = readConfig(req.username);
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node -c routes/config.js
node -c routes/chat.js
```

Expected: no output and exit code 0.

- [ ] **Step 4: Commit**

Run:

```bash
git add routes/config.js routes/chat.js
git commit -m "feat: isolate API config by user"
```

Expected: commit contains only `routes/config.js` and `routes/chat.js`.

---

### Task 4: Use Per-User History

**Files:**
- Modify: `routes/history.js`

- [ ] **Step 1: Update imports**

Import user output helpers:

```js
const { apiAuth } = require('../middleware/auth');
const { getUserOutputsDir, ensureOutputsDir, readHistoryIndex, writeHistoryIndex } = require('../lib/shared');
```

- [ ] **Step 2: Update list and save**

Use:

```js
const data = readHistoryIndex(req.username);
ensureOutputsDir(req.username);
const filePath = path.join(getUserOutputsDir(req.username), filename);
writeHistoryIndex(req.username, data);
```

- [ ] **Step 3: Update read and delete**

Every file path must use:

```js
path.join(getUserOutputsDir(req.username), id + '.txt')
```

Every index read/write must use:

```js
readHistoryIndex(req.username)
writeHistoryIndex(req.username, data)
```

For clear-all, delete only files under `getUserOutputsDir(req.username)` and do not touch root `outputs/`.

- [ ] **Step 4: Syntax check**

Run:

```bash
node -c routes/history.js
```

Expected: no output and exit code 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add routes/history.js
git commit -m "feat: isolate generation history by user"
```

Expected: commit contains only `routes/history.js`.

---

### Task 5: Update Documentation And Validate

**Files:**
- Modify: `docs/技术文档.md`

- [ ] **Step 1: Update known limitation section**

Change the user-isolation limitation to:

```markdown
- API 配置和生成历史已按登录账号写入 `data/users/<username>/`。
- 首次访问主账号 `choushiyiguai` 时，会从旧根目录 `api-config.json` 和 `outputs/` 复制一份历史数据；旧文件保留不删除。
```

Remove statements that say user data isolation is not complete.

- [ ] **Step 2: Run checks**

Run:

```bash
node scripts/validate-multipage-architecture.js
rg -n "用户数据隔离尚未完成|仍是全局共享" docs/技术文档.md
```

Expected: validation passes and `rg` returns no matches.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/技术文档.md
git commit -m "docs: document per-user data isolation"
```

Expected: commit contains only `docs/技术文档.md`.

---

### Task 6: Runtime Isolation Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Syntax checks**

Run:

```bash
node -c server.js
node -c lib/shared.js
node -c routes/config.js
node -c routes/chat.js
node -c routes/history.js
node scripts/validate-multipage-architecture.js
```

Expected: all pass.

- [ ] **Step 2: Start server**

Run:

```bash
npm start
```

Expected: server listens on `http://127.0.0.1:3000`.

- [ ] **Step 3: Login two users**

Run:

```bash
MAIN_TOKEN=$(curl -s http://127.0.0.1:3000/api/login -H 'Content-Type: application/json' -d '{"username":"choushiyiguai","password":"123456"}' | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).token')
USER2_TOKEN=$(curl -s http://127.0.0.1:3000/api/login -H 'Content-Type: application/json' -d '{"username":"choushiyiguai1","password":"123456"}' | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).token')
```

Expected: both variables are non-empty.

- [ ] **Step 4: Verify config isolation**

Run:

```bash
curl -s http://127.0.0.1:3000/api/config -H "Authorization: Bearer $MAIN_TOKEN"
curl -s http://127.0.0.1:3000/api/config -H "Authorization: Bearer $USER2_TOKEN"
curl -s http://127.0.0.1:3000/api/config -H "Authorization: Bearer $USER2_TOKEN" -H 'Content-Type: application/json' -d '{"provider":"custom","baseUrl":"https://example.invalid/v1","model":"user2-model","apiKey":"user2-key"}'
curl -s http://127.0.0.1:3000/api/config -H "Authorization: Bearer $MAIN_TOKEN"
```

Expected: user2 save does not change main account config.

- [ ] **Step 5: Verify history isolation**

Run:

```bash
curl -s http://127.0.0.1:3000/api/history -H "Authorization: Bearer $MAIN_TOKEN"
curl -s http://127.0.0.1:3000/api/history -H "Authorization: Bearer $USER2_TOKEN"
curl -s http://127.0.0.1:3000/api/history -H "Authorization: Bearer $USER2_TOKEN" -H 'Content-Type: application/json' -d '{"id":"user2-check","format":"storyboard","formatName":"画布模式","mode":"continuous","duration":"10s","output":"user2 only"}'
curl -s http://127.0.0.1:3000/api/history -H "Authorization: Bearer $MAIN_TOKEN"
curl -s http://127.0.0.1:3000/api/history -H "Authorization: Bearer $USER2_TOKEN"
```

Expected: main account history does not include `user2-check`; user2 history includes `user2-check`.

- [ ] **Step 6: Stop server**

Stop `npm start` with Ctrl-C or kill the listener PID.

Expected: no process remains listening on port 3000.

---

## Self-Review

- Spec coverage: storage helpers, config routes, chat routes, history routes, ignore rule, docs, and runtime verification are covered.
- Placeholder scan: no placeholder markers or vague implementation-only steps are present.
- Scope check: password hardening, token expiry, user management UI, prompt changes, and deletion of old root data are explicitly excluded.
