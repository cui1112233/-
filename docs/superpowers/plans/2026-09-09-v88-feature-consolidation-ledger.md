# V88 Feature Consolidation Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不合并、不删除、不部署的前提下，完成 `master`、开放 PR、关键功能分支、Workflow 和其余历史分支相对最新 `v88` 的功能总账，并把每个候选明确分类为 A1～A5，为后续最小回迁和 Git 清理提供可审计依据。

**Architecture:** 本计划只做静态仓库核账和文档化，不修改业务代码。所有历史分支和 PR 都只作为只读候选源，以执行时最新 `v88` HEAD 为唯一比较基线；先采集 Git/PR/Workflow 证据，再写入统一 OBJ 总账，最后只产出 A2/A3 回迁队列与 A5 运行验证缺口，不执行这些后续动作。

**Tech Stack:** Git、GitHub CLI、Markdown、现有 Node/Go/React 测试清单。

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
- Produces: 后续任务共同更新的唯一总账文件，固定包含 `Source / Ref / Area / Evidence / A-class / PR disposition / Runtime verification / Next action / Notes` 字段。

- [ ] **Step 1: 在隔离工作区确认当前基线**

Run:

```bash
git fetch --all --prune --tags
git checkout v88
git pull --ff-only origin v88
printf 'v88=%s\n' "$(git rev-parse HEAD)"
printf 'master=%s\n' "$(git rev-parse origin/master)"
printf 'merge-base=%s\n' "$(git merge-base origin/master HEAD)"
printf 'remote-branches=%s\n' "$(git for-each-ref refs/remotes/origin --format='%(refname:short)' | grep -v '^origin/HEAD$' | wc -l | tr -d ' ')"
```

Expected: 输出执行时 `v88` SHA、`master` SHA、merge-base 和远端分支数量；若 `git pull --ff-only` 失败，停止本任务并记录阻塞，不允许 force/reset 覆盖。

- [ ] **Step 2: 采集默认分支与开放 PR 基线**

Run:

```bash
gh repo view cui1112233/- --json defaultBranchRef,nameWithOwner
gh pr list --repo cui1112233/- --state open --base v88 --limit 200 \
  --json number,title,headRefName,baseRefName,isDraft,mergeable,updatedAt,url \
  > /tmp/v88-open-prs.json
cat /tmp/v88-open-prs.json
```

Expected: 默认分支和执行时全部开放到 `v88` 的 PR 有可保存证据。

- [ ] **Step 3: 创建总账骨架**

Create `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md` with these exact sections:

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

Sections 3–11 use this table schema:

```markdown
| Source | Ref | Area | Evidence | A-class | PR disposition | Runtime verification | Next action | Notes |
|---|---|---|---|---|---|---|---|---|
```

- [ ] **Step 4: 验证总账格式**

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

### Task 2: 完成 master-only 遗产核账

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`
- Reference candidate: commit `96908c32456cb7572b8e621221e7cbeff75976db`
- Reference current V88: `frontend/public/batch-rewrite/*`, `lib/novel-fetch-workshop/*`, `routes/batch-rewrite.js`, Novel Fetch tests

**Interfaces:**
- Consumes: Task 1 基线。
- Produces: 每个 master-only commit 的 A1～A5 结论；A2/A3 只进入第 12 节，不修代码。

- [ ] **Step 1: 证明执行时 master-only commit 集合**

Run:

```bash
git log --left-right --cherry-pick --oneline origin/master...origin/v88
git rev-list --left-right --count origin/master...origin/v88
git log --format='%H %s' origin/v88..origin/master > /tmp/master-only-commits.txt
cat /tmp/master-only-commits.txt
```

Expected: 明确列出所有 master-only commit；若出现新的 master-only commit，全部纳入本任务。

- [ ] **Step 2: 对所有 master-only commit 采集文件差异**

Run:

```bash
while read -r sha rest; do
  [ -n "$sha" ] || continue
  echo "=== $sha $rest ==="
  git show --stat --oneline "$sha"
  git diff-tree --no-commit-id --name-status -r "$sha"
done < /tmp/master-only-commits.txt
```

- [ ] **Step 3: 对 Novel Fetch 版本配置链做专项静态核对**

Run:

```bash
grep -R "TARGET_VERSION_ORDER\|VERSION_ORDER" -n lib/novel-fetch-workshop routes/batch-rewrite.js | head -120
grep -R "webProfileBindingAi4\|webProfileBindingAi5\|profile_bindings" -n frontend/public/batch-rewrite routes/batch-rewrite.js lib/novel-fetch-workshop | head -180
grep -R "selected_versions\|ai_slot_methods" -n frontend/public/batch-rewrite routes/batch-rewrite.js lib/novel-fetch-workshop | head -180
find tests test -type f 2>/dev/null | grep -E 'novel-fetch.*(version|sparse|mainline)' | sort
```

Expected: 总账分别记录 original～AI5 的 UI、请求、持久化、后端规范化、上传选择和测试覆盖；不能只因 UI 存在就判 A1。

- [ ] **Step 4: 写入 master 结论与 A2/A3 队列**

For every SHA in `/tmp/master-only-commits.txt`, add a row to section 3. If current v88 has an equivalent or better implementation, record A1 and cite the replacing file/SHA. If v88 has the main implementation but misses fields/tests/semantics, record A2 with exact target files in section 12. If a still-required capability is wholly absent, record A3. If runtime is required to decide, record A5.

- [ ] **Step 5: 验证 master-only commit 全覆盖**

Run:

```bash
python - <<'PY'
from pathlib import Path
commits = [line.split()[0] for line in Path('/tmp/master-only-commits.txt').read_text(encoding='utf-8').splitlines() if line.strip()]
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [c for c in commits if c not in s]
assert not missing, f'master-only commits missing: {missing}'
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

### Task 3: 对全部开放 PR 做处置分类

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: `/tmp/v88-open-prs.json`。
- Produces: 每个开放 PR 的 A1～A5 与 PR disposition；本任务不合并、不关闭 PR。

- [ ] **Step 1: 为每个开放 PR 导出详情和文件列表**

Run:

```bash
mkdir -p /tmp/v88-pr-audit
jq -r '.[].number' /tmp/v88-open-prs.json | while read -r n; do
  gh pr view "$n" --repo cui1112233/- \
    --json number,title,state,isDraft,mergeable,headRefName,headRefOid,baseRefName,baseRefOid,commits,files,statusCheckRollup,url \
    > "/tmp/v88-pr-audit/pr-$n.json"
  gh pr diff "$n" --repo cui1112233/- --name-only \
    > "/tmp/v88-pr-audit/pr-$n-files.txt"
done
```

Expected: 每个开放 PR 都有一份详情 JSON 和 changed-file 清单。

- [ ] **Step 2: 应用 PR 分类规则**

Use exactly:

- `MERGE-CANDIDATE`: 功能仍需要，基线可安全更新，测试可充分证明静态行为。
- `EXTRACT-ONLY`: 分支落后或混入无关改动，只能提取局部逻辑/测试。
- `SUPERSEDED`: 当前 v88 已有等价或更完整实现。
- `HISTORICAL`: 只剩设计/审计价值。
- `BLOCKED`: 冲突或必须真实外部验证才能决定。

For PRs touching Novel Fetch login/121 submit, use A5 when real authenticated response or remote readback is still required even if CI is green.

- [ ] **Step 3: 写入总账**

Every PR in `/tmp/v88-open-prs.json` gets one row in section 4. Current known PR numbers #39, #37, #34, #33, #31, #29, #24, #16, #10 and #12 must be checked if still open; if any is already closed at execution time, mention that fact in Notes rather than inventing an open-PR row.

- [ ] **Step 4: 验证开放 PR 全覆盖**

Run:

```bash
python - <<'PY'
import json
from pathlib import Path
prs = json.load(open('/tmp/v88-open-prs.json', encoding='utf-8'))
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [p['number'] for p in prs if f"#{p['number']}" not in s]
assert not missing, f'open PRs missing: {missing}'
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

### Task 4: 核对五大功能域的历史分支

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
```

- [ ] **Step 2: 用 changed files 补充分支名漏检**

Run:

```bash
for b in $(git for-each-ref refs/remotes/origin --format='%(refname:short)' | grep -Ev '^origin/(HEAD|v88)$'); do
  if git diff --name-only origin/v88..."$b" 2>/dev/null \
    | grep -Eq '^(lib/novel-fetch-workshop|routes/(batch-rewrite|novel-fetch|script-video)|backend/internal/batchfactoryv11|frontend/src/user/pages/(ScriptPage|batch-factory-v11)|local-executor|\.github/workflows/v88-(novel|local-executor|script)|deploy/)'; then
    echo "$b"
  fi
done >> /tmp/v88-feature-branches.txt
sort -u /tmp/v88-feature-branches.txt -o /tmp/v88-feature-branches.txt
cat /tmp/v88-feature-branches.txt
```

- [ ] **Step 3: 批量采集每个候选的 Git 证据**

Run:

```bash
mkdir -p /tmp/v88-feature-audit
while read -r b; do
  safe=$(printf '%s' "$b" | tr '/:' '__')
  {
    echo "branch=$b"
    printf 'merge-base='; git merge-base origin/v88 "$b"
    printf 'left-right='; git rev-list --left-right --count origin/v88..."$b"
    echo '--- unique commits ---'
    git log --oneline --no-merges origin/v88.."$b" | head -100
    echo '--- changed files ---'
    git diff --name-status origin/v88..."$b" | head -260
  } > "/tmp/v88-feature-audit/$safe.txt"
done < /tmp/v88-feature-branches.txt
```

- [ ] **Step 4: 核对当前 v88 的保护语义**

Run:

```bash
grep -R "originalRaw\|original_raw\|maxTxt\|original_raw_chars\|accepted_pending\|confirmed\|submitted\|book_list\|input_ready" -n lib routes frontend/public tests test 2>/dev/null | head -320
grep -R "H3\|h3\|ref_image_0\|video_model" -n backend routes frontend/src tests test .github/workflows 2>/dev/null | head -300
grep -R "local-executor\|script-video\|unauthorized" -n local-executor routes frontend/src tests test .github/workflows 2>/dev/null | head -300
grep -R "batchfactoryv11\|Batch Factory V11\|personal_api\|VIDEO" -n backend frontend/src routes tests test .github/workflows 2>/dev/null | head -320
grep -R "matchAudio\|audioDurationSec\|constraint-prompts\|storyboard\|prompt pipeline" -n frontend/src routes backend tests test .github/workflows 2>/dev/null | head -320
```

Expected: 分类基于当前实现与测试，不只看历史 commit message。

- [ ] **Step 5: 写入五大功能域总账与后续队列**

Every candidate in `/tmp/v88-feature-branches.txt` gets a row in sections 5–9. A2/A3 rows must also enter section 12 with exact source ref, target files, protected semantics and required tests. A5 rows must enter section 13 with one concrete real-world proof gap.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): classify critical feature branches"
```

---

### Task 5: 核对 Workflow、发布历史与所有剩余分支

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`
- Reference: `.github/workflows/*`
- Reference: `deploy/v88-direct/*`
- Reference: `deploy/v88-public/*`

**Interfaces:**
- Consumes: 当前 v88 Workflow 和所有剩余远端 refs。
- Produces: Workflow 分类以及所有历史分支覆盖证明。

- [ ] **Step 1: 列出并读取当前 v88 Workflow**

Run:

```bash
git ls-tree -r --name-only origin/v88 .github/workflows | sort > /tmp/v88-workflows.txt
while read -r f; do
  echo "=== $f ==="
  git show "origin/v88:$f" | sed -n '1,260p'
done < /tmp/v88-workflows.txt
```

Classify every workflow as exactly one of:

- `ACTIVE-RELEASE`
- `ACTIVE-CI`
- `RECOVERY`
- `HISTORICAL-ONCE`
- `SUPERSEDED`

- [ ] **Step 2: 证明 Direct Stage/Cutover 正式链仍可从 v88 追溯**

Run:

```bash
git ls-tree -r --name-only origin/v88 deploy/v88-direct .github/workflows \
  | grep -E 'v88-direct-deploy-(contract|node-stage|node-cutover)|deploy/v88-direct/(STAGE-REQUEST|CUTOVER-REQUEST|package-node-release|stage-node-host|cutover-node-host)'
```

Expected: 正式链关键文件存在；缺失则只记 A2/A3，不修文件。

- [ ] **Step 3: 导出全部历史远端分支并补齐剩余分类**

Run:

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short)' \
  | grep -Ev '^origin/(HEAD|v88)$' \
  | sort -u > /tmp/v88-all-historical-branches.txt

while read -r b; do
  if ! grep -Fq "$b" docs/obj/2026-09-09-v88-feature-consolidation-ledger.md; then
    echo "=== $b ==="
    git rev-list --left-right --count origin/v88..."$b"
    git log --oneline --no-merges origin/v88.."$b" | head -60
    git diff --name-status origin/v88..."$b" | head -180
  fi
done < /tmp/v88-all-historical-branches.txt
```

For each uncovered branch, record A1–A5 in section 11. One-off diagnostics, retired release paths and temporary experiments with no maintained requirement are A4 unless runtime dependency evidence requires A5.

- [ ] **Step 4: 验证每个历史分支都被覆盖**

Run:

```bash
python - <<'PY'
from pathlib import Path
branches = [x.strip() for x in Path('/tmp/v88-all-historical-branches.txt').read_text(encoding='utf-8').splitlines() if x.strip()]
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
missing = [b for b in branches if b not in s]
assert not missing, 'historical branches missing:\n' + '\n'.join(missing)
print(f'branch coverage ok: {len(branches)} historical refs')
PY
```

Expected: 输出 `branch coverage ok:` 并显示执行时全部历史 refs 数量。

- [ ] **Step 5: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): complete workflow and branch accounting"
```

---

### Task 6: 做总账一致性验收并生成后续最小计划队列

**Files:**
- Modify: `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`

**Interfaces:**
- Consumes: Task 1–5 的完整总账。
- Produces: 优先级明确的 A2/A3 实施队列、A5 验证队列和阶段结论。

- [ ] **Step 1: 校验 A-class 与 PR disposition**

Run:

```bash
python - <<'PY'
from pathlib import Path
s = Path('docs/obj/2026-09-09-v88-feature-consolidation-ledger.md').read_text(encoding='utf-8')
rows = [line for line in s.splitlines() if line.startswith('|') and not line.startswith('|---') and 'Source | Ref' not in line]
valid_a = {'A1','A2','A3','A4','A5','N/A'}
valid_pr = {'MERGE-CANDIDATE','EXTRACT-ONLY','SUPERSEDED','HISTORICAL','BLOCKED','N/A'}
errors = []
for i,row in enumerate(rows,1):
    cols = [c.strip() for c in row.strip('|').split('|')]
    if len(cols) != 9:
        errors.append((i,'column-count',len(cols)))
        continue
    if cols[4] not in valid_a:
        errors.append((i,'A-class',cols[4]))
    if cols[5] not in valid_pr:
        errors.append((i,'PR disposition',cols[5]))
assert not errors, errors
print(f'classification schema ok: {len(rows)} rows')
PY
```

Expected: `classification schema ok`.

- [ ] **Step 2: 按固定优先级整理 A2/A3**

Section 12 uses this exact order:

1. Novel Fetch / 视频管理系统 / Browser Worker correctness gaps.
2. H3 integration onto latest v88.
3. 豆包 / 本地执行器 public authorization / update flow.
4. Batch Factory V11 remaining gaps.
5. Script / Director / Prompt Pipeline remaining gaps.
6. Release/CI source-of-truth gaps.
7. Other historical functionality.

Each item must name source ref, current v88 evidence, exact target files, protected semantics, required tests, and whether the next artifact is a bounded fix plan or architectural integration plan.

- [ ] **Step 3: A5 只写真实验证缺口**

Section 13 must use concrete proof language such as:

```text
121 login: requires a real authenticated Browser Worker session and a non-HTML authenticated response; CI success alone is insufficient.
121 submit: requires upload acceptance plus subsequent book_list readback matching the book/version; task_id/queued is insufficient.
Windows executor: requires installed/updated executor to connect to the public site and complete an authorized smoke path; build artifact success alone is insufficient.
Public routing: requires exact-SHA build-info and route-layer verification; local contract tests are insufficient.
```

- [ ] **Step 4: 写阶段结论**

Section 14 must answer:

- 唯一维护主线是否仍为 `v88`。
- `master` 是否还有 A2/A3 功能遗产；有则不得宣布 master 可退出。
- 哪些 PR 可安全候选、只能提取、已被替代或阻塞。
- 五大功能域各自权威 v88 文件/测试证据在哪里。
- 是否已经满足 archive、默认分支切换和历史分支删除条件；若 A2/A3/A5 未清零，则答案必须明确为“尚未满足”。

- [ ] **Step 5: Final verification**

Run:

```bash
git status --short
git diff origin/v88...HEAD --name-only
```

Expected: 本计划执行只修改实施计划文档和 `docs/obj/2026-09-09-v88-feature-consolidation-ledger.md`；不得出现业务代码、Workflow 或 deploy 配置修改。

Then repeat Task 2 Step 5, Task 3 Step 4, Task 5 Step 4 and Task 6 Step 1. All four validations must pass.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-09-09-v88-feature-consolidation-ledger.md
git commit -m "docs(v88): finalize feature consolidation ledger"
```

## Completion Gate

This plan is complete only when:

- Every execution-time master-only commit is represented in the ledger.
- Every execution-time open PR targeting `v88` is represented in the ledger.
- Every remote historical branch except `origin/HEAD` and `origin/v88` is represented in the ledger.
- Every current `v88` Workflow has a workflow classification.
- Every ledger row uses A1–A5 or N/A.
- Every open PR row uses one approved PR disposition.
- Every A2/A3 has an exact follow-up target and required tests; no business code is changed in this plan.
- Every A5 states one concrete real-world verification gap and does not claim success from contract tests.
- No branch, PR, Workflow, default-branch setting, production runtime, or business code is mutated by this plan.
