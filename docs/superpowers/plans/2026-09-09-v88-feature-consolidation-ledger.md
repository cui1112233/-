# V88 Feature Consolidation Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不合并、不删除、不部署的前提下，完成 `master`、开放 PR、关键功能分支、Workflow 和其余历史分支相对最新 `v88` 的功能总账，并把每个候选明确分类为 A1～A5，为后续最小回迁和 Git 清理提供可审计依据。

**Architecture:** 本计划只做静态仓库核账和文档化，不修改业务代码。所有历史分支和 PR 都只作为只读候选源，以执行时的最新 `v88` HEAD 为唯一比较基线；先采集 Git/PR/Workflow 证据，再写入统一 OBJ 总账，最后只产出后续 A2/A3 回迁计划清单与 A5 运行验证缺口，不执行这些后续动作。

**Tech Stack:** Git、GitHub CLI / GitHub API、Markdown、现有 Node/Go/React 测试清单（仅用于识别覆盖关系，不把合同测试当外部成功）。

**Spec:** `docs/superpowers/specs/2026-09-09-v88-safe-git-consolidation-design.md`

## Global Constraints

- `v88` 是唯一维护主线和源码真相；历史分支只读。
- 不直接 merge `master` 到 `v88`。
- 不整支 merge 明显落后于当前 `v88` 的 feature/fix/integration/ops/release 分支。
- 本计划执行期间不修改业务代码、不关闭 PR、不创建 archive、不删除分支、不删除 Workflow、不修改默认分支、不部署公网。
- Novel Fetch 必须保护 `originalRaw`、`maxTxt`、`4000/27831`、真实日期筛选、`input_ready` 展示语义，以及 `accepted_pending` 与远端 `book_list` 确认后的 `confirmed/submitted` 区分。
- 401/403、登录页 HTML、超时、缺 remote id、queued/running 不能当真实提交成功。
- H3、豆包/本地执行器、Batch Factory V11、Script/Director/Prompt Pipeline 的历史实现只能作为差异来源，最终权威实现必须指向 `v88`。
- Node 正式发布链保持 `V88 Direct Deploy Node Stage -> exact staged SHA -> V88 Direct Deploy Node Cutover -> external exact-SHA verification -> rollback protection`；本计划不运行发布链。
- A1～A5 是功能分类；开放 PR 另外使用 `MERGE-CANDIDATE / EXTRACT-ONLY / SUPERSEDED / HISTORICAL / BLOCKED` 作为 PR 处置分类。
- 静态代码无法证明真实外部行为时必须标记 A5，不能用单元测试、合同测试、`healthy` 或 `task_id` 替代真实运行验证。

---

### Task 1: 建立执行基线与统一总账格式

**Files:**
- Create: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`
- Reference: `AGENTS.md`
- Reference: `docs/V88_PROJECT_EXECUTION_MEMORY.md`
- Reference: `docs/obj/2026-09-08-v88-consolidation-stage1-inventory-freeze.md`
- Reference: `docs/superpowers/specs/2026-09-09-v88-safe-git-consolidation-design.md`

**Interfaces:**
- Consumes: 当前仓库 refs、默认分支、开放 PR、Workflow 目录。
- Produces: 后续所有任务共同更新的唯一总账文件，固定包含 `Source / Ref / Area / Evidence / A-class / PR disposition / Runtime verification / Next action / Notes` 字段。

- [ ] **Step 1: 在隔离工作区确认当前基线，不切换到历史分支开发**

Run:

```bash
git fetch --all --prune --tags
git checkout v88
git pull --ff-only origin v88
printf 'v88=%s\n' "$(git rev-parse HEAD)"
printf 'master=%s\n' "$(git rev-parse origin/master)"
printf 'merge-base=%s\n' "$(git merge-base origin/master HEAD)"
printf 'branches=%s\n' "$(git for-each-ref refs/remotes/origin --format='%(refname:short)' | grep -v 'origin/HEAD' | wc -l | tr -d ' ')"
```

Expected: 输出一个明确的执行时 `v88` SHA、`master` SHA、merge-base 和远端分支数量；如果 `v88` 无法 fast-forward 更新，则停止并记录阻塞，不允许 force/reset 覆盖。

- [ ] **Step 2: 采集仓库和开放 PR 基线**

Run:

```bash
git remote -v
git branch -r --no-merged origin/v88 | sed 's/^ *//' | sort
gh repo view cui1112233/- --json defaultBranchRef,nameWithOwner
gh pr list --repo cui1112233/- --state open --base v88 --limit 200 --json number,title,headRefName,baseRefName,isDraft,mergeable,updatedAt,url
```

Expected: 默认分支、未合入 `v88` 的远端分支、全部开放到 `v88` 的 PR 都有可保存证据。

- [ ] **Step 3: 创建总账骨架**

Create `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md` with these exact top-level sections:

```markdown
# V88 功能收口总账

## 1. 执行基线
## 2. 分类定义
## 3. master-only 遗产
## 4. 开放 PR
## 5. Novel Fetch / 视频管理系统 / Browser Worker
## 6. H3 视频能力
## 7. 豆包 / 本地执行器
## 8. Batch Factory V11
## 9. Script / Director / Prompt Pipeline
## 10. 发布 / 运维 / Workflow
## 11. 其余历史分支
## 12. A2 / A3 后续最小回迁队列
## 13. A5 运行验证缺口
## 14. 本阶段结论
```

Inside sections 3–11, use the same table schema:

```markdown
| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
```

- [ ] **Step 4: 验证总账格式完整**

Run:

```bash
python - <<'PY'
from pathlib import Path
p = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md')
s = p.read_text(encoding='utf-8')
required = [
'## 1. 执行基线','## 3. master-only 遗产','## 4. 开放 PR',
'## 5. Novel Fetch / 视频管理系统 / Browser Worker','## 6. H3 视频能力',
'## 7. 豆包 / 本地执行器','## 8. Batch Factory V11',
'## 9. Script / Director / Prompt Pipeline','## 10. 发布 / 运维 / Workflow',
'## 11. 其余历史分支','## 12. A2 / A3 后续最小回迁队列',
'## 13. A5 运行验证缺口','## 14. 本阶段结论'
]
missing = [x for x in required if x not in s]
assert not missing, missing
assert '| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |' in s
print('ledger schema ok')
PY
```

Expected: `ledger schema ok`.

- [ ] **Step 5: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): establish feature consolidation ledger"
```

---

### Task 2: 完成 master-only 遗产逐文件核账

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`
- Reference candidate: `master` commit `96908c32456cb7572b8e621221e7cbeff75976db`
- Reference current V88 files: `frontend/public/batch-rewrite/*`, `lib/novel-fetch-workshop/*`, `routes/batch-rewrite.js`, Novel Fetch tests

**Interfaces:**
- Consumes: Task 1 的执行基线和统一表格。
- Produces: master 每个独有 commit 和受影响文件的 A1～A5 结论；任何 A2/A3 缺口进入第 12 节，不在本任务修代码。

- [ ] **Step 1: 证明 master 相对 v88 的独有提交集合**

Run:

```bash
git log --left-right --cherry-pick --oneline origin/master...origin/v88
git rev-list --left-right --count origin/master...origin/v88
git log --oneline origin/v88..origin/master
```

Expected: 明确列出所有 `master` 独有 commit；若不再只有 `96908c3`，把新出现的 master-only commit 一并纳入核账，不能沿用旧结论。

- [ ] **Step 2: 对每个 master-only commit 采集文件级差异**

For `96908c32456cb7572b8e621221e7cbeff75976db`, run:

```bash
git show --stat --oneline 96908c32456cb7572b8e621221e7cbeff75976db
git diff-tree --no-commit-id --name-status -r 96908c32456cb7572b8e621221e7cbeff75976db
```

Then compare the known key paths against current `v88`:

```bash
git diff origin/master..origin/v88 -- \
  frontend/public/batch-rewrite/index.html \
  frontend/public/batch-rewrite/app.js \
  frontend/public/batch-rewrite/styles.css \
  lib/novel-fetch-workshop/rewrite.js \
  lib/novel-fetch-workshop/task-ops.js \
  lib/novel-fetch-workshop/version-selection.js \
  lib/novel-fetch-workshop/target-versions.js \
  routes/batch-rewrite.js \
  tests/novel-fetch-mainline-version-config.test.js \
  tests/novel-fetch-version-selection.test.js \
  tests/novel-fetch-rewrite-sparse.test.js
```

Expected: 能区分“v88 已重写”和“master 仍有未覆盖逻辑/测试”。

- [ ] **Step 3: 对版本配置链做专项静态核对**

Run:

```bash
grep -R "TARGET_VERSION_ORDER\|VERSION_ORDER" -n lib/novel-fetch-workshop routes/batch-rewrite.js | head -80
grep -R "webProfileBindingAi4\|webProfileBindingAi5\|profile_bindings" -n frontend/public/batch-rewrite routes/batch-rewrite.js lib/novel-fetch-workshop | head -120
grep -R "selected_versions\|ai_slot_methods" -n frontend/public/batch-rewrite routes/batch-rewrite.js lib/novel-fetch-workshop | head -120
```

Expected: 总账必须明确记录 original～AI5 的 UI、请求、持久化、后端规范化、上传选择、测试覆盖分别处于 A1/A2/A3 哪一类；不能只看 UI 存在就判定完整。

- [ ] **Step 4: 写入 master 结论和后续队列**

In section 3, every master-only commit gets one summary row plus file-level evidence notes. Any confirmed gap such as “v88 主要实现存在但缺 AI4/AI5 后端绑定或回归测试” goes to section 12 as an A2 follow-up with exact files and desired behavior. If code has changed and the gap no longer exists, record A1 with the replacing v88 file/SHA evidence instead.

- [ ] **Step 5: Validate master coverage**

Run:

```bash
python - <<'PY'
import subprocess
from pathlib import Path
commits = subprocess.check_output(['git','log','--format=%H','origin/v88..origin/master'], text=True).split()
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [c for c in commits if c not in s]
assert not missing, f'master-only commits missing from ledger: {missing}'
print('master coverage ok')
PY
```

Expected: `master coverage ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): account for master-only functionality"
```

---

### Task 3: 对全部开放 PR 做处置分类，不执行合并或关闭

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: 当前开放到 `v88` 的 PR 列表和每个 PR 的 head/base/diff/workflow 状态。
- Produces: 每个开放 PR 的 `MERGE-CANDIDATE / EXTRACT-ONLY / SUPERSEDED / HISTORICAL / BLOCKED` 处置结论，并映射到 A1～A5。

- [ ] **Step 1: 导出全部开放 PR**

Run:

```bash
gh pr list --repo cui1112233/- --state open --base v88 --limit 200 \
  --json number,title,headRefName,baseRefName,isDraft,mergeable,updatedAt,url \
  > /tmp/v88-open-prs.json
cat /tmp/v88-open-prs.json
```

Expected: 文件包含执行时所有开放到 `v88` 的 PR；当前已知候选至少要复核 #39、#37、#34、#33、#31、#29、#24、#16、#10、#12，如果其中某个已关闭则在总账 notes 记录“执行前已关闭”，不要伪造成开放 PR。

- [ ] **Step 2: 对每个开放 PR 获取详细证据**

Run for each PR number returned in Step 1:

```bash
gh pr view <PR_NUMBER> --repo cui1112233/- \
  --json number,title,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,baseRefOid,commits,files,statusCheckRollup,url
```

Then inspect changed files:

```bash
gh pr diff <PR_NUMBER> --repo cui1112233/- --name-only
```

`<PR_NUMBER>` is replaced with every number from `/tmp/v88-open-prs.json`; no PR may be skipped because it appears old or redundant.

- [ ] **Step 3: 分类规则逐条应用**

Record:

- `MERGE-CANDIDATE`: head 可安全更新到当前 v88、功能仍需要、静态测试能充分证明行为；
- `EXTRACT-ONLY`: 分支明显落后或混入无关改动，但包含仍需要的局部逻辑/测试；
- `SUPERSEDED`: 当前 v88 已有等价或更完整实现；
- `HISTORICAL`: 只剩设计/审计价值；
- `BLOCKED`: 冲突或必须真实外部验证才能决定。

For PRs touching Novel Fetch login/121 submission, use A5 when real login/remote readback is still required even if CI is green.

- [ ] **Step 4: 验证开放 PR 一个不少地写进总账**

Run:

```bash
python - <<'PY'
import json
from pathlib import Path
prs = json.load(open('/tmp/v88-open-prs.json', encoding='utf-8'))
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [p['number'] for p in prs if f"#{p['number']}" not in s]
assert not missing, f'open PRs missing from ledger: {missing}'
print('open PR coverage ok')
PY
```

Expected: `open PR coverage ok`.

- [ ] **Step 5: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): classify open consolidation PRs"
```

---

### Task 4: 核对五大功能域的未合入历史分支

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: 所有 `origin/*` refs 与当前 `origin/v88`。
- Produces: Novel Fetch、H3、豆包/本地执行器、Batch Factory V11、Script/Prompt 五个功能域的分支级 A1～A5 总账。

- [ ] **Step 1: 建立候选分支集合**

Run:

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short)' \
  | grep -Ev '^origin/(HEAD|v88)$' \
  | grep -Ei 'novel|121|browser|worker|h3|video|doubao|executor|local-executor|batch|bf11|script|director|prompt|storyboard' \
  | sort -u > /tmp/v88-feature-branches.txt
cat /tmp/v88-feature-branches.txt
```

Expected: 得到五大功能域的候选历史分支集合；不要因为分支名不规范就只依赖名称，下一步还需用 changed files 补充发现。

- [ ] **Step 2: 补充“名称不匹配但文件命中”的候选**

Run:

```bash
for b in $(git for-each-ref refs/remotes/origin --format='%(refname:short)' | grep -Ev '^origin/(HEAD|v88)$'); do
  files=$(git diff --name-only origin/v88..."$b" 2>/dev/null | grep -E '^(lib/novel-fetch-workshop|routes/(batch-rewrite|novel-fetch|script-video)|backend/internal/batchfactoryv11|frontend/src/user/pages/(ScriptPage|batch-factory-v11)|local-executor|\.github/workflows/v88-(novel|local-executor|script)|deploy/)' || true)
  if [ -n "$files" ]; then echo "$b"; fi
done | sort -u >> /tmp/v88-feature-branches.txt
sort -u /tmp/v88-feature-branches.txt -o /tmp/v88-feature-branches.txt
```

Expected: 候选不仅来自名称，也来自实际文件触达。

- [ ] **Step 3: 为每个候选计算 ahead/behind、merge-base、独有 commit、changed files**

Run for each branch in `/tmp/v88-feature-branches.txt`:

```bash
b='origin/<BRANCH_NAME>'
printf '\n=== %s ===\n' "$b"
printf 'merge-base: '; git merge-base origin/v88 "$b"
printf 'left-right: '; git rev-list --left-right --count origin/v88..."$b"
git log --oneline --no-merges origin/v88.."$b" | head -80
git diff --name-status origin/v88..."$b" | head -200
```

Replace `<BRANCH_NAME>` with each exact branch name from the file. If a branch has no unique commits or all patches are patch-equivalent to v88, classify A1 instead of assuming it still needs merge.

- [ ] **Step 4: 应用功能域保护规则**

For Novel Fetch/视频管理系统/Browser Worker, explicitly check the files/terms:

```bash
grep -R "originalRaw\|original_raw\|maxTxt\|original_raw_chars\|accepted_pending\|confirmed\|submitted\|book_list\|input_ready" -n lib routes frontend/public tests | head -240
```

For H3:

```bash
grep -R "H3\|h3\|ref_image_0\|video_model" -n backend routes frontend/src test tests .github/workflows 2>/dev/null | head -240
```

For local executor:

```bash
grep -R "local-executor\|script-video\|unauthorized\|update" -n local-executor routes frontend/src .github/workflows test tests 2>/dev/null | head -240
```

For Batch Factory V11:

```bash
grep -R "batchfactoryv11\|Batch Factory V11\|personal_api\|VIDEO" -n backend frontend/src routes test tests .github/workflows 2>/dev/null | head -260
```

For Script/Prompt:

```bash
grep -R "matchAudio\|audioDurationSec\|constraint-prompts\|storyboard\|prompt pipeline" -n frontend/src routes backend test tests .github/workflows 2>/dev/null | head -260
```

Expected: 总账的分类必须基于当前 v88 的实际实现与测试，而不是仅基于历史分支 commit message。

- [ ] **Step 5: 把 A2/A3/A5 结果同步到后续队列**

For every A2/A3 row, section 12 must include exact source ref, target files, protected semantics, and recommended next artifact type (`bounded fix plan` or `feature integration plan`). For every A5 row, section 13 must include the exact real-world proof still missing, such as “121 登录后 book_list readback” or “Windows executor public authorization smoke”.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): classify critical feature branches"
```

---

### Task 5: 核对 Workflow、发布和运维历史分支

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`
- Reference: `.github/workflows/*`
- Reference: `deploy/v88-direct/*`
- Reference: `deploy/v88-public/*`

**Interfaces:**
- Consumes: 当前 v88 Workflow 和所有运维/部署候选分支。
- Produces: `ACTIVE-RELEASE / ACTIVE-CI / RECOVERY / HISTORICAL-ONCE / SUPERSEDED` 分类，以及是否存在仍只能从 master/历史分支运行的正式能力。

- [ ] **Step 1: 列出当前 v88 Workflow**

Run:

```bash
git ls-tree -r --name-only origin/v88 .github/workflows | sort
```

Expected: 得到当前所有 Workflow 文件；以执行时结果为准，不硬编码旧的 21 个数量。

- [ ] **Step 2: 核对正式发布链文件仍存在且没有被另一套正式入口替代**

Run:

```bash
git ls-tree -r --name-only origin/v88 deploy/v88-direct .github/workflows \
  | grep -E 'v88-direct-deploy-(contract|node-stage|node-cutover)|deploy/v88-direct/(STAGE-REQUEST|CUTOVER-REQUEST|package-node-release|stage-node-host|cutover-node-host)'
```

Expected: 正式 Direct Stage/Cutover 链仍可从 v88 追溯；如果缺任何关键文件，标记 A2/A3 而不是补文件。

- [ ] **Step 3: 分类当前 Workflow**

For each workflow file, inspect name, triggers, writes, deployment commands and comments:

```bash
for f in $(git ls-tree -r --name-only origin/v88 .github/workflows); do
  echo "=== $f ==="
  git show "origin/v88:$f" | sed -n '1,220p'
done
```

Classify each into exactly one of:

- `ACTIVE-RELEASE`
- `ACTIVE-CI`
- `RECOVERY`
- `HISTORICAL-ONCE`
- `SUPERSEDED`

Do not delete any file in this task.

- [ ] **Step 4: 找出历史运维/发布分支仍独有的文件**

Run:

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short)' \
  | grep -Ei 'ops|deploy|release|ci|diag|emergency|public|workflow' \
  | grep -v '^origin/v88$' \
  | sort -u > /tmp/v88-ops-branches.txt

while read -r b; do
  echo "=== $b ==="
  git rev-list --left-right --count origin/v88..."$b"
  git diff --name-status origin/v88..."$b" -- .github/workflows deploy scripts | head -200
done < /tmp/v88-ops-branches.txt
```

Expected: 能证明哪些旧 ops/release/ci 分支只是历史工具，哪些仍有 v88 未表达的运行依赖；涉及 ECS-only 配置但静态无法确认运行真相时标 A5。

- [ ] **Step 5: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): classify workflows and release history"
```

---

### Task 6: 覆盖其余历史分支，确保 147 类历史债务没有漏项

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: Task 2–5 已覆盖 refs。
- Produces: 所有剩余远端分支的最少一行归属，最终达到“每个远端历史分支都有去向”。

- [ ] **Step 1: 导出全部远端分支列表**

Run:

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short)' \
  | grep -Ev '^origin/(HEAD|v88)$' \
  | sort -u > /tmp/v88-all-historical-branches.txt
```

- [ ] **Step 2: 对未在总账出现的分支做快速静态分类**

For each branch not already named in the ledger, collect:

```bash
b='origin/<BRANCH_NAME>'
git rev-list --left-right --count origin/v88..."$b"
git log --oneline --no-merges origin/v88.."$b" | head -40
git diff --name-status origin/v88..."$b" | head -120
```

Classify:

- No unique meaningful patch / patch already equivalent: A1.
- Partial useful patch mixed with obsolete changes: A2.
- Needed capability wholly absent from v88: A3.
- One-off diagnostics, superseded releases, temporary experiments with no maintained requirement: A4.
- Static evidence insufficient due runtime/external dependency: A5.

- [ ] **Step 3: 验证所有历史分支都被总账覆盖**

Run:

```bash
python - <<'PY'
import subprocess
from pathlib import Path
branches = subprocess.check_output(
    "git for-each-ref refs/remotes/origin --format='%(refname:short)' | grep -Ev '^origin/(HEAD|v88)$' | sort -u",
    shell=True, text=True
).splitlines()
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [b for b in branches if b not in s]
assert not missing, 'historical branches missing from ledger:\n' + '\n'.join(missing)
print(f'branch coverage ok: {len(branches)} historical refs')
PY
```

Expected: `branch coverage ok: <N> historical refs`; `<N>` is execution-time count and must equal all remote refs except `origin/HEAD` and `origin/v88`.

- [ ] **Step 4: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): complete historical branch accounting"
```

---

### Task 7: 做总账一致性验收并生成后续最小计划队列

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: Task 1–6 的完整总账。
- Produces: 按优先级排序的 A2/A3 实施队列、A5 运行验证队列，以及本阶段明确的“可以做/不能做”结论。

- [ ] **Step 1: 检查分类值没有自由文本漂移**

Run:

```bash
python - <<'PY'
from pathlib import Path
import re
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
rows = [line for line in s.splitlines() if line.startswith('|') and not line.startswith('|---') and 'Source | Ref' not in line]
valid_a = {'A1','A2','A3','A4','A5','N/A'}
valid_pr = {'MERGE-CANDIDATE','EXTRACT-ONLY','SUPERSEDED','HISTORICAL','BLOCKED','N/A'}
errors = []
for i,row in enumerate(rows,1):
    cols = [c.strip() for c in row.strip('|').split('|')]
    if len(cols) < 9: errors.append((i,'column-count',row)); continue
    if cols[4] not in valid_a: errors.append((i,'A-class',cols[4]))
    if cols[5] not in valid_pr: errors.append((i,'PR disposition',cols[5]))
assert not errors, errors
print(f'classification schema ok: {len(rows)} rows')
PY
```

Expected: `classification schema ok`.

- [ ] **Step 2: 对 A2/A3 队列按风险排序**

Use this exact priority order in section 12:

1. Novel Fetch / 视频管理系统 / Browser Worker correctness gaps.
2. H3 integration onto latest v88.
3. 豆包 / 本地执行器 public authorization / update flow.
4. Batch Factory V11 remaining gaps.
5. Script / Director / Prompt Pipeline remaining gaps.
6. Release/CI source-of-truth gaps.
7. Other historical functionality.

Each row must name source ref, current v88 evidence, exact target files, protected semantics, required tests, and whether it needs a new bounded/architectural plan.

- [ ] **Step 3: 对 A5 只写“唯一验证缺口”，不伪造成功**

Examples of acceptable section 13 wording:

```text
121 login: requires a real authenticated Browser Worker session and a non-HTML authenticated response; CI success alone is insufficient.
121 submit: requires upload acceptance plus subsequent book_list readback matching the book/version; task_id/queued is insufficient.
Windows executor: requires installed/updated executor to connect to the public site and complete an authorized smoke path; build artifact success alone is insufficient.
Public routing: requires exact-SHA build-info and route-layer verification; local contract tests are insufficient.
```

- [ ] **Step 4: 写本阶段结论**

Section 14 must explicitly answer:

- 当前唯一维护主线是否仍为 `v88`。
- `master` 是否还存在 A2/A3 功能遗产；如果有，列出，不宣布 master 可退出。
- 哪些 PR 是可安全候选、哪些只能提取、哪些已被替代、哪些阻塞。
- 五大功能域各自的权威 v88 文件/测试证据在哪里。
- 是否已经满足创建 archive、切默认分支、删除历史分支的条件；本计划预期答案通常仍为“尚未，需先完成 A2/A3/A5 后续”。

- [ ] **Step 5: Final verification**

Run:

```bash
git status --short
git diff origin/v88...HEAD --name-only
```

Expected: 本计划执行过程中只出现 `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md` 的新增/修改，以及本实施计划文档自身；不得出现业务代码、Workflow、deploy 配置的修改。

Then run the branch coverage and classification schema validation from Task 6 Step 3 and Task 7 Step 1 again. Both must pass.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): finalize feature consolidation ledger"
```

## Completion Gate

This plan is complete only when:

- Every execution-time `master`-only commit is represented in the ledger.
- Every execution-time open PR targeting `v88` is represented in the ledger.
- Every remote historical branch except `v88`/`origin/HEAD` is represented in the ledger.
- Every current `v88` Workflow has a workflow classification.
- Every row uses A1–A5 (or N/A where classification is not applicable).
- Every open PR row uses one PR disposition from the approved set.
- Every A2/A3 has an exact follow-up target and tests; no code is changed in this plan.
- Every A5 states one concrete real-world verification gap and does not claim success from contract tests.
- No branch, PR, Workflow, default-branch setting, production runtime, or business code is mutated by this plan.
