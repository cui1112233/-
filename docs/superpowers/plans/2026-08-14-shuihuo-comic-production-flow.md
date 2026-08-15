# 水货漫剧生产流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 将水货生产改造为"创建漫剧 → 选择分段对话模式 → 确认分段 → 分段生产"完整工作流，采用横向分段生产表布局，字幕默认等于分段正文，配音对接现有 TTS 后台。

**Architecture:** 前端新增项目首页布局、创建弹窗（含文件上传和对话模式）和横向分段生产表；Go 后端新增 `dialogueMode` 分段参数和两套提示词模板；前端 TTS 调用复用 Express `/api/tts`，音频回写水货媒体上传接口。

**Tech Stack:** React、Ant Design、Lucide React、Express、Go、MySQL、Redis。

## Global Constraints

- 不改变现有图片、视频、资产、任务中心和媒体绑定能力。
- 分段后端模型不变；新增 `dialogueMode` 字段仅用于选择提示词模板。
- 配音通过前端调用 Express `/api/tts` 获取音频 Blob，再调用水货媒体上传接口写入。
- 支持 TXT、SRT、VTT 文件上传读取为文本。
- 不引入对象存储原文上传作为本阶段前置依赖。

---

## 文件结构

- 修改 `frontend/src/user/pages/ShuihuoProductionPage.jsx`：项目首页布局、筛选、创建弹窗。
- 修改 `frontend/src/user/pages/shuihuo/StudioView.jsx`：横向分段生产表。
- 新增 `frontend/src/user/pages/shuihuo/CreateProjectModal.jsx`：创建弹窗组件。
- 修改 `frontend/src/shared/api/shuihuoProduction.js`：新增文件读取、TTS 配音和分段模式 API。
- 修改 `backend/internal/httpapi/shuihuo_segmentation_handlers.go`：接收 `dialogueMode` 并选择提示词模板。
- 新增 `backend/internal/shuihuo/segmentation/comic_prompts.go`：两套固定分段提示词。
- 新增 `tests/shuihuo-comic-production-contract.test.js`：流程合约测试。

### Task 1: 创建弹窗与文件上传

**Files:**
- Create: `frontend/src/user/pages/shuihuo/CreateProjectModal.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`

**Interfaces:**
- Consumes: `createProject({ name, sourceText })` API。
- Produces: `CreateProjectModal` 组件，含名称、文件上传、粘贴内容、对话模式选择。

- [ ] **Step 1: 编写失败测试**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const createModal = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'shuihuo', 'CreateProjectModal.jsx'),
  'utf8'
);

test('create project modal includes name, file upload, paste, and dialogue mode', () => {
  assert.match(createModal, /作品名称/);
  assert.match(createModal, /上传小说文件/);
  assert.match(createModal, /粘贴小说内容/);
  assert.match(createModal, /对话模式/);
  assert.match(createModal, /自动识别/);
  assert.match(createModal, /中文双对话/);
  assert.match(createModal, /accept="\.txt,\.srt,\.vtt"/);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: FAIL，CreateProjectModal 不存在。

- [ ] **Step 3: 创建 CreateProjectModal 组件**

```jsx
import { Button, Form, Input, Modal, Select, Typography, Upload, message } from 'antd';
import { FileText, UploadOutlined } from 'lucide-react';
import { useState } from 'react';

const DIALOGUE_MODES = [
  { value: 'auto', label: '自动识别 — 按剧情冲突、场景变化与叙事节奏切分' },
  { value: 'dual_dialogue', label: '中文双对话 — 优先按人物对白、配音时长和镜头节奏切分' },
];

export function CreateProjectModal({ open, onClose, onCreated }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  async function handleFile(file) {
    const text = await file.text();
    form.setFieldsValue({ sourceText: text });
    return false;
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const project = await createProject({ name: values.name.trim(), sourceText: values.sourceText || '' });
      onCreated(project);
      form.resetFields();
    } catch (error) {
      message.error(error.message || '创建失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="创建漫剧" open={open} onCancel={onClose} footer={null} width={640}>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item name="name" label="作品名称" rules={[{ required: true, message: '请输入作品名称' }]}>
          <Input placeholder="输入漫剧名称" maxLength={120} />
        </Form.Item>
        <Form.Item label="上传小说文件">
          <Upload beforeUpload={handleFile} accept=".txt,.srt,.vtt" maxCount={1} showUploadList>
            <Button icon={<UploadOutlined size={16} />}>选择 TXT / SRT / VTT 文件</Button>
          </Upload>
        </Form.Item>
        <Form.Item name="sourceText" label="或粘贴小说内容">
          <Input.TextArea rows={8} placeholder="在此粘贴小说原文...（也可先上传文件自动填充）" />
        </Form.Item>
        <Form.Item name="dialogueMode" label="对话模式" initialValue="auto">
          <Select options={DIALOGUE_MODES} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Button onClick={onClose} style={{ marginRight: 8 }}>取消</Button>
          <Button type="primary" htmlType="submit" loading={loading}>创建并进入分段</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: PASS。

### Task 2: 项目首页布局

**Files:**
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`

**Interfaces:**
- Consumes: `CreateProjectModal`、`listProjects` API。
- Produces: 左侧作品卡片列表、顶部搜索/筛选/排序、"创建漫剧"按钮。

- [ ] **Step 1: 编写失败测试**

```javascript
const page = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ShuihuoProductionPage.jsx'),
  'utf8'
);

test('project home page renders search, filter, sort, and create button', () => {
  assert.match(page, /创建漫剧/);
  assert.match(page, /搜索作品/);
  assert.match(page, /CreateProjectModal/);
  assert.match(page, /dialogueMode/);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: FAIL，当前页面没有搜索和创建漫剧按钮。

- [ ] **Step 3: 改造项目首页**

将 `ShuihuoProductionPage.jsx` 的项目列表区改为：

```jsx
<div className="shuihuo-home">
  <div className="shuihuo-home-toolbar">
    <Input.Search
      placeholder="搜索作品名称"
      value={search}
      onChange={e => setSearch(e.target.value)}
      style={{ width: 280 }}
    />
    <Select
      value={filterStatus}
      onChange={setFilterStatus}
      options={[
        { value: 'all', label: '全部状态' },
        { value: 'draft', label: '草稿' },
        { value: 'confirmed', label: '已确认分段' },
      ]}
      style={{ width: 140 }}
    />
    <Select
      value={sortBy}
      onChange={setSortBy}
      options={[
        { value: 'updated', label: '最近更新' },
        { value: 'created', label: '创建时间' },
        { value: 'name', label: '名称排序' },
      ]}
      style={{ width: 130 }}
    />
    <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
      创建漫剧
    </Button>
  </div>
  <div className="shuihuo-project-grid">
    {filteredProjects.map(project => (
      <Card key={project.id} className="shuihuo-project-card" hoverable onClick={() => openProject(project)}>
        <Card.Meta
          title={project.name}
          description={project.summary || '暂无分段'}
        />
        <div className="shuihuo-project-card-footer">
          <span>{project.segmentationStatus === 'confirmed' ? '已确认' : '草稿'}</span>
          <span>{project.updatedAt}</span>
        </div>
      </Card>
    ))}
  </div>
  <CreateProjectModal
    open={createOpen}
    onClose={() => setCreateOpen(false)}
    onCreated={handleProjectCreated}
  />
</div>
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: PASS。

### Task 3: 对话模式分段提示词

**Files:**
- Create: `backend/internal/shuihuo/segmentation/comic_prompts.go`
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`

**Interfaces:**
- Consumes: 智能分段请求中的 `dialogueMode`。
- Produces: `ComicSegmentationPrompt(mode string) string`。

- [ ] **Step 1: 编写 Go 提示词单元测试**

在 `comic_prompts.go` 同目录创建 `comic_prompts_test.go`：

```go
func TestComicSegmentationPrompt(t *testing.T) {
    auto := ComicSegmentationPrompt("auto")
    assert.Contains(t, auto, "剧情冲突")
    dual := ComicSegmentationPrompt("dual_dialogue")
    assert.Contains(t, dual, "人物对白")
    assert.NotEqual(t, auto, dual)
}
```

- [ ] **Step 2: 实现两套提示词**

```go
func ComicSegmentationPrompt(mode string) string {
    switch mode {
    case "dual_dialogue":
        return "你是漫剧分段助手。请将以下小说内容按人物对白切分，每段以一组完整对话为单位，控制每段配音时长在30-90秒。保留角色台词和必要叙述过渡。"
    default:
        return "你是漫剧分段助手。请根据剧情冲突、场景变化和叙事节奏将小说内容切分为适合漫剧制作的片段。每段应包含一个完整的故事推进单元。"
    }
}
```

- [ ] **Step 3: 修改分段处理器接收 dialogueMode**

在 `shuihuo_segmentation_handlers.go` 的处理函数中读取请求的 `dialogueMode` 字段，传递给 `ComicSegmentationPrompt` 构造模型请求。

- [ ] **Step 4: 运行 Go 测试**

```bash
go test ./internal/shuihuo/segmentation/... -v
```

Expected: PASS。

### Task 4: 横向分段生产表

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`

**Interfaces:**
- Consumes: 已确认分段列表、`updateSegment`、TTS 配音 API。
- Produces: 横向行式分段生产表。

- [ ] **Step 1: 编写失败测试**

```javascript
test('studio view renders horizontal segment production table', () => {
  assert.match(studio, /shuihuo-production-table/);
  assert.match(studio, /生成配音/);
  assert.match(studio, /subtitleText/);
});
```

- [ ] **Step 2: 实现横向分段生产表**

将分段展示改为：

```jsx
<div className="shuihuo-production-table">
  <div className="shuihuo-production-header">
    <span>序号</span><span>分段原文</span><span>内容</span>
    <span>角色/场景</span><span>图片提示词</span><span>图片</span>
    <span>视频提示词</span><span>视频</span><span>操作</span>
  </div>
  {confirmedSegments.map((seg, index) => (
    <div key={seg.id} className="shuihuo-production-row">
      <span>{index + 1}</span>
      <span className="shuihuo-production-row-source">{seg.sourceText}</span>
      <Input.TextArea value={seg.subtitleText} onChange={...} />
      <AssetBinding segment={seg} />
      <PromptCell segment={seg} kind="image" />
      <MediaCell segment={seg} kind="image" />
      <PromptCell segment={seg} kind="video" />
      <MediaCell segment={seg} kind="video" />
      <Space>
        <Button onClick={() => generateTtsAudio(seg)}>生成配音</Button>
        <Button onClick={() => regenerateSegment(seg)}>重新生成</Button>
        <Button danger onClick={() => deleteSegment(seg)}>删除</Button>
      </Space>
    </div>
  ))}
</div>
```

- [ ] **Step 3: 实现 TTS 配音绑定**

```javascript
async function generateTtsAudio(segment) {
  try {
    setTtsLoading(segment.id, true);
    const blob = await textToSpeech({
      text: segment.subtitleText || segment.sourceText,
      voice: ttsVoice,
      style: ttsStyle,
      rate: ttsRate,
      pitch: ttsPitch,
    });
    const formData = new FormData();
    formData.append('segmentId', segment.id);
    formData.append('kind', 'audio');
    formData.append('file', blob, `tts_${segment.id}.mp3`);
    await uploadMedia(segment.id, formData);
    message.success('配音已生成并绑定');
  } catch (error) {
    message.error(error.message || '配音生成失败');
  } finally {
    setTtsLoading(segment.id, false);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: PASS。

### Task 5: 确认分段时字幕初始化

**Files:**
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`

**Interfaces:**
- Consumes: 确认分段请求。
- Produces: 新确认分段 `subtitleText` 默认等于确认后的分段正文。

- [ ] **Step 1: 编写 Go 测试**

```go
func TestConfirmSegmentsSetsSubtitle(t *testing.T) {
    // 确认分段后，subtitleText 应等于 sourceText
}
```

- [ ] **Step 2: 修改确认分段逻辑**

在确认分段处理函数中，对每个新确认的分段，若 `subtitleText` 为空则写入 `sourceText`。

- [ ] **Step 3: 运行 Go 测试**

Expected: PASS。

### Task 6: 回归验证

**Files:**
- 修改: 无
- Test: `tests/shuihuo-comic-production-contract.test.js`、`tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: 运行水货生产流程合约测试**

```bash
node --test tests/shuihuo-comic-production-contract.test.js
```

Expected: PASS。

- [ ] **Step 2: 运行水货生产 UI 合约测试**

```bash
node --test tests/shuihuo-production-ui-contract.test.js
```

Expected: PASS（若存在本次变更前已存在的独立失败，记录其测试名和失败原因）。

- [ ] **Step 3: 构建 React 前端**

```bash
npm --prefix frontend run build
```

Expected: Vite 构建完成，退出码 0。

- [ ] **Step 4: 构建 Go 后端**

```bash
cd backend && go build ./...
```

Expected: 构建通过。

- [ ] **Step 5: 手动验收**

按设计流程完成：创建漫剧 → 选择模式 → 确认分段 → 查看字幕 → 生成配音 → 操作图片视频。