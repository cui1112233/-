# 多书城分组新建批量 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在"新建批量"弹窗里按书城分组录入书籍（添加书城→标签暂存→可回填编辑），一次创建含多个书城书籍的 1 个批量，并一键跑完全自动流程。

**Architecture:** Go 端手动录入接口新增可选 `groups` 入参，分组复用现有 `ParseManualBookList`，旧单书城路径原样保留；Node 层为透传代理无需改；前端弹窗维护分组状态，提交时按组调用现有 `fetch-originals` 抓正文，再带 `groups` 调 `intakes/manual` 创建。

**Tech Stack:** Go（标准库 testing）、React + Antd、Node Express 透传、node:test 前端纯函数测试。

## Global Constraints

- 工作分支：`v88`；在隔离 worktree `f:\脚本测试\v88-hotfix-tmp` 内作业（已基于 origin/v88 最新 HEAD），主工作区 `f:\脚本测试\Agent` 不动
- 设计文档：`docs/superpowers/specs/2026-09-27-multi-platform-batch-intake-design.md`
- 书 ID 解析规则：行首连续 6–25 位数字（沿用 `manualDigits`）
- 单次提交总量 ≤ 50 本（现有后端限制）
- 旧路径必须零回归：`groups` 为空/缺省时行为与现在完全一致
- 每个任务结束运行测试并单独 commit；提交人 `cui1112233 <732223510@qq.com>`
- 面向用户文案一律中文；用户可见名称"视频管理系统"不出现 121

---

### Task 1: Go 分组解析纯函数

**Files:**
- Modify: `backend/internal/batchfactoryv11/manual_intake.go`（`ManualIntakeInput` 结构体在 11-25 行；`ParseManualBookList` 在 376 行）
- Test: `backend/internal/batchfactoryv11/manual_intake_grouped_test.go`（新建）

**Interfaces:**
- Consumes: 现有 `ParseManualBookList(input ManualIntakeInput) ([]CreateBookInput, error)`、`ManualIntakeInput`
- Produces:
  - `type ManualIntakeGroup struct { PlatformID string \`json:"platformId"\`; PlatformName string \`json:"platformName"\`; InputText string \`json:"inputText"\` }`
  - `ManualIntakeInput` 新字段 `Groups []ManualIntakeGroup \`json:"groups,omitempty"\``
  - `func ParseGroupedManualBookLists(base ManualIntakeInput) ([]CreateBookInput, error)`
  - 语义：按 `base.Groups` 顺序，每组用自己的平台字段 + base 的 ParseMode/ColumnPresetID/ColumnOrder/SourceTextByBookID 调 `ParseManualBookList`，结果顺序拼接；任一组解析失败整体返回错误；全空返回 `ErrInvalid`；跨组同 ID 不去重（视为不同书城的两本书）

- [ ] **Step 1: 写失败测试**

新建 `backend/internal/batchfactoryv11/manual_intake_grouped_test.go`：

```go
package batchfactoryv11

import "testing"

func TestParseGroupedManualBookLists(t *testing.T) {
	input := ManualIntakeInput{
		ParseMode:      "smart",
		ColumnPresetID: "full_metadata",
		Groups: []ManualIntakeGroup{
			{PlatformID: "3", PlatformName: "七猫付费", InputText: "737092 雪尽风软归良人\n687404 老公狠心"},
			{PlatformID: "15", PlatformName: "知乎付费", InputText: "567168 晚风惊扰旧梦"},
		},
	}
	books, err := ParseGroupedManualBookLists(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(books) != 3 {
		t.Fatalf("want 3 books, got %d", len(books))
	}
	if books[0].Platform != "3" || books[0].SourceMetadata["platformName"] != "七猫付费" {
		t.Fatalf("book0 platform wrong: %+v", books[0])
	}
	if books[2].Platform != "15" || books[2].SourceMetadata["platformName"] != "知乎付费" {
		t.Fatalf("book2 platform wrong: %+v", books[2])
	}
}

func TestParseGroupedManualBookListsSameIDAcrossGroupsKept(t *testing.T) {
	input := ManualIntakeInput{
		Groups: []ManualIntakeGroup{
			{PlatformID: "3", InputText: "737092 甲"},
			{PlatformID: "15", InputText: "737092 乙"},
		},
	}
	books, err := ParseGroupedManualBookLists(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(books) != 2 {
		t.Fatalf("cross-group same ID must be kept twice, got %d", len(books))
	}
}

func TestParseGroupedManualBookListsInvalidGroup(t *testing.T) {
	input := ManualIntakeInput{
		Groups: []ManualIntakeGroup{
			{PlatformID: "", InputText: "737092 甲"},
		},
	}
	if _, err := ParseGroupedManualBookLists(input); err == nil {
		t.Fatal("group without platformId must fail")
	}
}

func TestParseGroupedManualBookListsEmpty(t *testing.T) {
	if _, err := ParseGroupedManualBookLists(ManualIntakeInput{}); err == nil {
		t.Fatal("empty input must fail")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./internal/batchfactoryv11/ -run TestParseGrouped -v`
Expected: 编译失败 `undefined: ManualIntakeGroup / ParseGroupedManualBookLists`

- [ ] **Step 3: 实现**

在 `manual_intake.go` 的 `ManualIntakeInput` 结构体（第 24 行 `SourceTextByBookID` 后）加：

```go
	// Groups 可选：多书城分组录入。非空时每组按各自平台解析，忽略顶层 PlatformID/InputText。
	Groups []ManualIntakeGroup `json:"groups,omitempty"`
}

// ManualIntakeGroup 是一个书城下的一批粘贴文本。
type ManualIntakeGroup struct {
	PlatformID   string `json:"platformId"`
	PlatformName string `json:"platformName"`
	InputText    string `json:"inputText"`
}
```

（注意：原结构体第 25 行的 `}` 要随字段一起调整。）

文件末尾追加：

```go
// ParseGroupedManualBookLists 按书城分组解析粘贴文本。每组复用
// ParseManualBookList 的全部解析/组内去重规则，仅平台信息按组取值；
// 跨组重复 ID 保留（不同书城可能撞 ID，视为两本书）。
func ParseGroupedManualBookLists(base ManualIntakeInput) ([]CreateBookInput, error) {
	if len(base.Groups) == 0 {
		return nil, ErrInvalid
	}
	out := make([]CreateBookInput, 0)
	for _, group := range base.Groups {
		groupInput := base
		groupInput.PlatformID = strings.TrimSpace(group.PlatformID)
		groupInput.PlatformName = strings.TrimSpace(group.PlatformName)
		groupInput.InputText = group.InputText
		books, err := ParseManualBookList(groupInput)
		if err != nil {
			return nil, err
		}
		out = append(out, books...)
	}
	if len(out) == 0 {
		return nil, ErrInvalid
	}
	return out, nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `go test ./internal/batchfactoryv11/ -run TestParseGrouped -v`
Expected: 4 个测试全 PASS

- [ ] **Step 5: 跑该包全部测试防回归**

Run: `go test ./internal/batchfactoryv11/`
Expected: PASS（含原有 manual_intake_test.go 全部用例）

- [ ] **Step 6: Commit**

```bash
git add backend/internal/batchfactoryv11/manual_intake.go backend/internal/batchfactoryv11/manual_intake_grouped_test.go
git commit -m "feat(batch-factory): parse multi-platform grouped manual intake"
```

---

### Task 2: Go HTTP 接口接入 groups

**Files:**
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go:14-79`（`POST /intakes/manual` handler）
- Test: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`（在现有测试文件中追加用例）

**Interfaces:**
- Consumes: Task 1 的 `ParseGroupedManualBookLists`
- Produces: `POST /api/batch-factory/v11/intakes/manual` 接受 `groups`；分组模式下每本书的 `sourceMetadata.platformName` 保持各自书城，不被顶层覆盖；批次 metadata 记录 `groupCount`

- [ ] **Step 1: 写失败测试**

在 `batch_factory_v11_slice1_test.go` 末尾追加（参考文件内已有的 `signedJSONRequest` 用法与 store 初始化方式）：

```go
func TestManualIntakeGroupedCreatesOneBatchWithPerBookPlatforms(t *testing.T) {
	api, _ := newTestSliceAPI(t) // 若该 helper 名称不同，沿用本文件已有用例的初始化方式
	resp := signedJSONRequest(t, api, time.Now(), "alice", http.MethodPost, "/api/batch-factory/v11/intakes/manual", map[string]any{
		"title": "多书城批", "contentRangeLines": 5, "contentCaptureCharacters": 4000,
		"groups": []map[string]any{
			{"platformId": "3", "platformName": "七猫付费", "inputText": "737092 甲\n687404 乙"},
			{"platformId": "15", "platformName": "知乎付费", "inputText": "567168 丙"},
		},
	})
	if resp.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d body=%s", resp.Code, resp.Body.String())
	}
	var payload struct {
		Batch struct {
			Books []struct {
				Platform       string         `json:"platform"`
				SourceMetadata map[string]any `json:"sourceMetadata"`
			} `json:"books"`
		} `json:"batch"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Batch.Books) != 3 {
		t.Fatalf("want 3 books, got %d", len(payload.Batch.Books))
	}
	if payload.Batch.Books[0].SourceMetadata["platformName"] != "七猫付费" {
		t.Fatalf("book0 platformName must stay group-scoped, got %v", payload.Batch.Books[0].SourceMetadata["platformName"])
	}
	if payload.Batch.Books[2].Platform != "15" {
		t.Fatalf("book2 platform want 15, got %s", payload.Batch.Books[2].Platform)
	}
}
```

注意：若现有 helper 命名/签名不同（如 store 构造、时间参数），照搬同文件最近一个 `intakes/manual` 成功用例（约 200-210 行）的骨架，仅替换请求体与断言。需要的 import（`encoding/json`、`net/http`、`time`）沿用文件已有。

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./internal/httpapi/ -run TestManualIntakeGrouped -v`
Expected: FAIL（分组被忽略导致断言失败，或书数为 0）

- [ ] **Step 3: 改 handler**

`batch_factory_v11_slice1.go` 第 46 行把：

```go
	books, err := batchfactoryv11.ParseManualBookList(input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
```

改为：

```go
	grouped := len(input.Groups) > 0
	var books []batchfactoryv11.CreateBookInput
	if grouped {
		books, err = batchfactoryv11.ParseGroupedManualBookLists(input)
	} else {
		books, err = batchfactoryv11.ParseManualBookList(input)
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
```

第 51-60 行的 metadata 循环中，把无条件的 platformName 覆盖：

```go
		books[index].SourceMetadata["platformName"] = strings.TrimSpace(input.PlatformName)
```

改为（分组模式平台名在解析时已按组写入，不能覆盖）：

```go
		if !grouped {
			books[index].SourceMetadata["platformName"] = strings.TrimSpace(input.PlatformName)
		}
```

第 63-67 行批次 metadata 字面量中，在 `"queueStatus": queueStatus` 后加一行：

```go
				"groupCount": len(input.Groups),
```

（非分组模式 len(nil)=0，旧数据语义不变。）

- [ ] **Step 4: 运行新测试确认通过**

Run: `go test ./internal/httpapi/ -run TestManualIntakeGrouped -v`
Expected: PASS

- [ ] **Step 5: 跑 httpapi 全部测试防回归**

Run: `go test ./internal/httpapi/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/httpapi/batch_factory_v11_slice1.go backend/internal/httpapi/batch_factory_v11_slice1_test.go
git commit -m "feat(batch-factory): accept groups in manual intake HTTP endpoint"
```

---

### Task 3: 前端分组纯函数

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryManualFetch.js`
- Test: `frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`

**Interfaces:**
- Produces（均 export）：
  - `mergeGroupLines(oldText, newText)` → 合并两段粘贴文本，按行首数字 ID 去重，新文本的行优先，保持"旧行顺序 + 新 ID 追加"，返回字符串
  - `upsertPlatformGroup(groups, group)` → `group = { platformId, platformName, inputText }`；同 platformId 合并文本，否则新增；返回**新数组**；inputText 去空行后无有效 ID 时原样返回（交给调用方提示）
  - `replacePlatformGroup(groups, platformId, inputText)` → 用 inputText 整体替换该组；trim 后无有效行则移除该组；返回新数组
  - `removePlatformGroup(groups, platformId)` → 删除该组，返回新数组
  - `totalGroupBookCount(groups)` → 所有组的去重书 ID 总数

- [ ] **Step 1: 写失败测试**

在 `batchFactoryManualFetch.test.js` 顶部 import 行追加新函数名，并追加用例：

```js
  // mergeGroupLines
  assert.equal(mergeGroupLines('737092 甲\n687404 乙', '749269 丙'), '737092 甲\n687404 乙\n749269 丙');
  const merged = mergeGroupLines('737092 旧标题', '737092 新标题\n749269 丙');
  assert.match(merged, /^737092 新标题/m);
  assert.match(merged, /749269 丙/);
  assert.equal((merged.match(/737092/g) || []).length, 1);

  // upsertPlatformGroup
  const g1 = upsertPlatformGroup([], { platformId: '3', platformName: '七猫付费', inputText: '737092 甲' });
  assert.equal(g1.length, 1);
  const g2 = upsertPlatformGroup(g1, { platformId: '3', platformName: '七猫付费', inputText: '687404 乙' });
  assert.equal(g2.length, 1);
  assert.equal(totalGroupBookCount(g2), 2);
  const g3 = upsertPlatformGroup(g2, { platformId: '15', platformName: '知乎付费', inputText: '567168 丙' });
  assert.equal(g3.length, 2);
  assert.equal(totalGroupBookCount(g3), 3);

  // replacePlatformGroup：整体替换；清空则移除
  const r1 = replacePlatformGroup(g3, '3', '737092 甲\n687404 乙\n711720 丁');
  assert.equal(totalGroupBookCount(r1), 4);
  const r2 = replacePlatformGroup(g3, '3', '   ');
  assert.equal(r2.length, 1);
  assert.equal(r2[0].platformId, '15');

  // removePlatformGroup
  assert.equal(removePlatformGroup(g3, '3').length, 1);
  assert.equal(removePlatformGroup(g3, '99').length, 2);
```

（沿用该文件已有的 `assert` import 与 `node:test` 风格，把上述断言放进一个新的 `test('platform group helpers', () => { ... })` 块。）

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`
Expected: FAIL（函数未导出）

- [ ] **Step 3: 实现**

在 `batchFactoryManualFetch.js` 追加：

```js
function nonEmptyLines(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim());
}

export function mergeGroupLines(oldText = '', newText = '') {
  const byId = new Map();
  const order = [];
  for (const line of nonEmptyLines(oldText)) {
    const id = line.match(/^\s*(\d+)(?=\s|$)/)?.[1];
    if (!id) continue;
    byId.set(id, line);
    order.push(id);
  }
  for (const line of nonEmptyLines(newText)) {
    const id = line.match(/^\s*(\d+)(?=\s|$)/)?.[1];
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, line); // 新行优先
  }
  return order.map(id => byId.get(id)).join('\n');
}

export function upsertPlatformGroup(groups = [], { platformId, platformName, inputText } = {}) {
  const id = String(platformId || '').trim();
  const name = String(platformName || '').trim();
  const text = String(inputText || '').trim();
  if (!id || !manualBookIDsFromInput(text).length) return groups;
  const existing = groups.find(group => String(group.platformId) === id);
  if (existing) {
    return groups.map(group => String(group.platformId) === id
      ? { ...group, platformName: name || group.platformName, inputText: mergeGroupLines(group.inputText, text) }
      : group);
  }
  return [...groups, { platformId: id, platformName: name, inputText: text }];
}

export function replacePlatformGroup(groups = [], platformId, inputText = '') {
  const id = String(platformId || '').trim();
  const text = String(inputText || '').trim();
  if (!text || !manualBookIDsFromInput(text).length) {
    return groups.filter(group => String(group.platformId) !== id);
  }
  return groups.map(group => String(group.platformId) === id ? { ...group, inputText: text } : group);
}

export function removePlatformGroup(groups = [], platformId) {
  const id = String(platformId || '').trim();
  return groups.filter(group => String(group.platformId) !== id);
}

export function totalGroupBookCount(groups = []) {
  return groups.reduce((sum, group) => sum + manualBookIDsFromInput(group.inputText).length, 0);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js`
Expected: PASS（含原有用例）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/shuihuo/batchFactoryManualFetch.js frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js
git commit -m "feat(frontend): platform group helper functions for grouped intake"
```

---

### Task 4: 弹窗分组交互（状态 + 标签区 + 添加/回填/删除）

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`

**Interfaces:**
- Consumes: Task 3 的 `upsertPlatformGroup / replacePlatformGroup / removePlatformGroup / totalGroupBookCount / manualBookIDsFromInput`
- Produces（组件内状态，Task 5 消费）：
  - `groups`：`[{platformId, platformName, inputText}]`
  - `editingPlatformId`：`string | null`，非空时标签区有"编辑中"高亮
  - 本任务只改交互，不碰 submit 提交链路（Task 5 做）

- [ ] **Step 1: 加状态**

在第 58 行 `sourceTextByBookId` 状态附近加：

```jsx
  const [groups, setGroups] = useState([]);
  const [editingPlatformId, setEditingPlatformId] = useState(null);
```

并在 `reset()` 函数（约 110-118 行）里追加两行：`setGroups([]); setEditingPlatformId(null);`

- [ ] **Step 2: 加三个处理函数**（放在 `fetchMissingOriginals` 之前）

```jsx
  function handleAddPlatformGroup() {
    const id = String(platformId || '').trim();
    if (!id) return message.warning('请先选择书城');
    const ids = manualBookIDsFromInput(inputText);
    if (!ids.length) return message.warning('小说列表中没有有效的 Book ID（每行以书 ID 开头）');
    if (totalGroupBookCount(groups) - (editingPlatformId ? manualBookIDsFromInput(groups.find(g => g.platformId === editingPlatformId)?.inputText).length : 0) + ids.length > 50) {
      return message.warning('一个批量最多 50 本书');
    }
    const platformName = platformOptions.find(option => option.value === id)?.label || id;
    if (editingPlatformId) {
      setGroups(current => replacePlatformGroup(current, editingPlatformId, inputText).map(g => g.platformId === editingPlatformId ? { ...g, platformId: id, platformName } : g));
      setEditingPlatformId(null);
    } else {
      setGroups(current => upsertPlatformGroup(current, { platformId: id, platformName, inputText }));
    }
    setInputText('');
  }

  function handleEditGroup(group) {
    if (editingPlatformId && editingPlatformId !== group.platformId) {
      return message.warning('请先完成当前修改：点"添加书城"保存，或点当前标签的 × 放弃');
    }
    setPlatformId(group.platformId);
    setInputText(group.inputText);
    setEditingPlatformId(group.platformId);
  }

  function handleRemoveGroup(platformId) {
    if (editingPlatformId === platformId) {
      // 编辑中点自己的 × = 放弃修改
      setEditingPlatformId(null);
      setInputText('');
      return;
    }
    if (editingPlatformId) {
      return message.warning('请先完成当前修改：点"添加书城"保存，或点当前标签的 × 放弃');
    }
    setGroups(current => removePlatformGroup(current, platformId));
  }
```

书城下拉的 `onChange`（约 291 行）改为切换时拦截编辑中跨书城修改：

```jsx
          onChange={value => {
            if (editingPlatformId && value !== editingPlatformId) {
              message.warning('请先完成当前修改：点"添加书城"保存，或点当前标签的 × 放弃');
              return;
            }
            setPlatformId(value);
            clearFetchedSources();
          }}
```

- [ ] **Step 3: 替换工具栏与列顺序区域的 JSX**

删除"自定义列顺序"那个 `<label>`（约 312-313 行）。把工具栏（约 331-337 行）替换为：

```jsx
    <div className="batch-factory-create-toolbar">
      <Button type="primary" onClick={handleAddPlatformGroup}>{editingPlatformId ? '保存书城修改' : '添加书城'}</Button>
      <Button type="primary" loading={busy} onClick={() => openAutomationDialog('immediate')}>立即执行</Button>
      <Button onClick={() => openAutomationDialog('scheduled')}>开始定时</Button>
      <Button onClick={openScheduleTasks}>定时任务</Button>
    </div>
    {groups.length ? (
      <div className="batch-factory-platform-groups" data-testid="platform-groups">
        {groups.map(group => (
          <Tag
            key={group.platformId}
            color={editingPlatformId === group.platformId ? 'processing' : 'blue'}
            closable
            onClose={event => { event.preventDefault(); handleRemoveGroup(group.platformId); }}
            onClick={() => handleEditGroup(group)}
            style={{ cursor: 'pointer', marginBottom: 4 }}
          >
            {group.platformName} ×{manualBookIDsFromInput(group.inputText).length}{editingPlatformId === group.platformId ? '（编辑中）' : ''}
          </Tag>
        ))}
      </div>
    ) : null}
```

确认文件顶部已 import `Tag`（antd 解构里没有就加：第 1 行的 import 列表中加 `Tag`），并从 `./batchFactoryManualFetch` 的 import 中补入 `upsertPlatformGroup, replacePlatformGroup, removePlatformGroup, totalGroupBookCount`。

- [ ] **Step 4: 交互手测（本地构建不跑后端，只验渲染不报错）**

Run: `cd frontend; npm run build`
Expected: 构建成功（无 undefined、无编译错误）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx
git commit -m "feat(frontend): grouped platform intake UI with tags and edit-back"
```

---

### Task 5: 提交链路按组抓正文并携带 groups

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx`（`submit` 函数约 234-280 行、`validateDraft` 约 186-197 行）

**Interfaces:**
- Consumes: `groups` 状态；现有 `fetchDirectOriginals`、`buildManualBatchSubmission`、`manualBookIDsFromInput`
- Produces: 提交体新增 `groups: [{platformId, platformName, inputText}]`；`onCreated` 之后的分类/自动化由 `BatchFactoryWorkbenchPage.createBatch` 现有逻辑负责，不改

- [ ] **Step 1: 改校验函数**

`validateDraft()` 改为：

```jsx
  function validateDraft() {
    if (!title.trim()) return message.warning('请填写作品名称');
    if (!groups.length) return message.warning('请至少添加一个书城的书（粘贴后点"添加书城"）');
    if (editingPlatformId) return message.warning('请先完成当前书城的修改：点"保存书城修改"或 × 放弃');
    return true;
  }
```

- [ ] **Step 2: 改 submit**

把 submit 开头"单平台抓正文"段（237-245 行 `let resolvedSources ...` 到 `resolvedSources = fetched.sources;` 整块）替换为按组抓取：

```jsx
    // 编辑中点了定时入口也会先校验；此时 groups 是唯一事实源
    const resolvedSources = {};
    const failedPlatforms = [];
    for (const group of groups) {
      const ids = manualBookIDsFromInput(group.inputText);
      const pending = ids.filter(bookId => !String(resolvedSources[bookId] || '').trim());
      if (!pending.length) continue;
      try {
        const result = await fetchDirectOriginals({
          platform: group.platformId,
          bookIds: pending,
          maxTxt: contentCaptureCharacters
        });
        for (const item of Array.isArray(result?.results) ? result.results : []) {
          const text = String(item?.data || '').trim();
          if (item?.status === 'ok' && text) resolvedSources[String(item.bookId)] = text;
        }
        if (!ids.some(bookId => resolvedSources[bookId])) failedPlatforms.push(group.platformName);
      } catch (error) {
        failedPlatforms.push(group.platformName);
      }
    }
    // 设计约定：抓不到的书照样创建（正文为空，列表中标红），不阻断整个批量
    const fetchedCount = Object.keys(resolvedSources).length;
    const totalCount = totalGroupBookCount(groups);
```

后续 `onCreated(buildManualBatchSubmission({...}))` 调用中：
- 删除 `platformId, platformName, parseMode, columnPresetId, columnOrder, inputText` 这些旧字段
- 加入 `groups: groups.map(group => ({ platformId: group.platformId, platformName: group.platformName, inputText: group.inputText }))`
- `sourceTextByBookId: resolvedSources` 保留
- 成功提示前（`reset()` 之后、函数内 await onCreated 完成后）加：
```jsx
      if (fetchedCount < totalCount) message.warning(`${fetchedCount}/${totalCount} 本已抓到正文，其余书将在列表中标红，可单独重试`);
```

最终提交对象至少包含：`title, groups, sourceTextByBookId, contentRangeLines, contentCaptureCharacters, scheduledAt, automationEnabled, autoPublishEnabled, presetId, runMode, automationConcurrency, parseMode, columnPresetId`。
（`parseMode/columnPresetId` 保留供后端按组解析使用；`columnOrder` 传当前预设即可。）

- [ ] **Step 3: 删掉失效的旧状态引用**

弹窗中 `sourceReady / missingBookIds / failedBookIds / fetchedCount(旧) / sourceTextByBookId / fetchErrorsByBookId / fetchMissingOriginals` 若在 JSX 中已无引用（旧"获取内容"按钮、正文进度 Alert 已在 Task 4 移除），删除对应变量与函数，保证 `npm run build` 无未使用告警报错。`fetching` 状态若无其他用途一并删掉，工具栏 loading 只用 `busy`。

- [ ] **Step 4: 构建验证**

Run: `cd frontend; npm run build`
Expected: 成功

- [ ] **Step 5: 跑前端相关测试**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryManualFetch.test.js frontend/src/shared/api/batchFactoryV11.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx
git commit -m "feat(frontend): grouped fetch and submit in create-batch modal"
```

---

### Task 6: 服务器构建部署与人工验收

**Files:** 无代码修改；Go 后端需重新构建部署（按 V88 增量发布规矩：只重建 go-api，前端整包更新）

- [ ] **Step 1: 推送 v88 并记录 SHA**

```bash
git log --oneline -6
git push origin HEAD:v88
```
记录推送后的精确 SHA。

- [ ] **Step 2: 构建前端整包**

Run: `cd frontend; npm run build`
产物 `frontend/dist/` 打包：`tar -czf dist-grouped.tar.gz -C dist .`

- [ ] **Step 3: 部署前端**（沿用本会话已验证路径）

SCP 上传 `dist-grouped.tar.gz` 到服务器 `/tmp`，然后：
```bash
docker cp /tmp/dist-grouped.tar.gz v88-public-v88-node-1:/tmp/
docker exec v88-public-v88-node-1 sh -c "mkdir -p /tmp/dist-grouped && cd /tmp/dist-grouped && tar -xzf ../dist-grouped.tar.gz && cp -rf . /app/frontend/dist/"
```
提醒用户用无痕窗口验证（避免旧缓存）。

- [ ] **Step 4: Go 后端发布**

按 V88 规矩走 Git-direct/镜像增量部署 go-api 到 Step 1 的精确 SHA（具体方式以用户当时批准的发布路径为准；部署后 `docker ps` 确认 go-api 健康）。
**禁止**拿旧 SHA 或旧镜像覆盖。

- [ ] **Step 5: 人工验收清单（用户在无痕窗口操作）**

1. 打开新建批量，填名称；选七猫付费，贴 2 本 6 位 ID 书，点"添加书城" → 出现"七猫付费 ×2"标签，输入框清空
2. 再选知乎付费贴 1 本，添加 → 两个标签并存
3. 七猫再补 1 本添加 → 标签变"七猫付费 ×3"（合并去重）
4. 点"七猫付费 ×3"标签 → 3 行回到输入框、书城切回七猫、显示"编辑中"；删掉 1 行后点"保存书城修改" → 标签变 ×2
5. 编辑中尝试点别的标签/切书城 → 出现拦截提示
6. 点标签 × → 整组删除
7. 重新加好 2 个书城共 3 本书，点"立即执行"，自动化设置确认 → 批量创建成功，共 3 本
8. 进入批量列表：3 本书各自显示正确书城名
9. 故意填 1 个错误 ID 重复流程：批量照建，错书显示"原文尚未获取"，其余正常
10. 抓到正文的书自动完成男女频/风格识别并继续自动化

- [ ] **Step 6: 收尾**

验收通过后更新项目记忆（热修/发布 SHA、验证结果）；若部署方式为容器热替换，记录需在下次正规发布中固化的点。

---

## Self-Review 结论

- Spec 2.1 布局：Task 4 实现；2.2 状态模型：Task 3/4；2.3 操作规则 1-3：Task 3/4；规则 4-5 与 2.4 链路：Task 5 + 现有 WorkbenchPage 自动化；2.5 边界（50 本、跨组同 ID、空组拦截、失败不阻断）：Task 1/2/4/5 各有覆盖
- 三、后端：Task 1+2；3.2 抓取不改后端：Task 5 前端按组调用；3.3 Node 透传：v12→v11→Go 兜底代理原样转发 JSON，已核实无需改
- 五、测试：Go 单测 Task 1/2，前端纯函数 Task 3，人工验收 Task 6
- 旧路径回归：Task 1 Step5、Task 2 Step5 全包测试
