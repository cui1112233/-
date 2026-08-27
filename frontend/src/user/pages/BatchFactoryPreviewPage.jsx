import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Drawer,
  Input,
  Modal,
  Progress,
  Select,
  Tag,
  message,
} from "antd";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  Clock3,
  FileText,
  FolderOpen,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import {
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  generateBatchFactoryVideos,
  generateBatchFactoryBatch,
  getBatchFactoryBatch,
  getBatchFactoryIntake,
  getBatchFactoryMergeCapability,
  listBatchFactoryBatches,
  mergeBatchFactoryVideos,
  startBatchFactoryBatch,
  updateBatchFactoryItem,
  updateBatchFactorySettings,
} from "../../shared/api/batchFactory";
import { loadBatchFactoryVideoModels } from "./batch-factory/BatchFactoryProductionControls";
import { resolveBatchFactoryVideoProduction, resolveBookStatus, useBatchFactoryProductionStatus } from "./batch-factory/BatchFactoryVideoProductionStatus";
import {
  fileToDraft,
  parseManualNovels,
  validateDraftItems,
} from "./batch-factory/intake";
import "./batch-factory-preview.css";

const STATUS_ORDER = [
  "全部",
  "待开始",
  "待审核",
  "AI处理中",
  "待生成",
  "排队中",
  "视频生成中",
  "异常",
  "待合并",
  "已合并",
];
const samples = [
  ["余生不逢云", "207414171084...", "已合并"],
  ["她离开以后", "2072480890496...", "待生成"],
  ["春风不渡", "20764104100976...", "异常"],
  ["星沉大海", "2078234234556...", "待审核"],
  ["烟火人间", "2076232344556...", "排队中"],
  ["归去来兮", "207734455667...", "已合并"],
  ["长夜将尽", "207845566778...", "待生成"],
].map(([title, bookId, displayStatus], index) => ({
  id: `sample-${index}`,
  title,
  bookId,
  displayStatus,
  index: index + 1,
}));

function itemStatus(item) {
  if (item.status === "failed" || item.production?.failed) return "异常";
  if (item.production?.mergedAt || item.mergedAt) return "已合并";
  if (item.production?.status === "running") return "视频生成中";
  if (item.production?.status === "queued") return "排队中";
  if (item.production?.readyToMerge) return "待合并";
  if (item.status === "hook_review") return "待审核";
  if (
    [
      "queued_hook",
      "hook_generating",
      "queued_director",
      "director_generating",
    ].includes(item.status)
  )
    return "AI处理中";
  return item.status === "complete" || item.directorResult
    ? "待生成"
    : "待开始";
}
function tone(status) {
  return {
    异常: "red",
    已合并: "green",
    待合并: "green",
    排队中: "blue",
    视频生成中: "blue",
    待生成: "gold",
    AI处理中: "blue",
  }[status];
}
function mapItems(batch, byProjectId = {}) {
  return (batch?.items || []).map((item, index) => ({
    ...item,
    id: item.id || `book-${index}`,
    title: item.title || "未命名小说",
    bookId: item.bookId || "",
    index: index + 1,
    displayStatus: ({ pending: "待开始", review: "待审核", ai_processing: "AI处理中", ready_generate: "待生成", queued: "排队中", generating: "视频生成中", failed: "异常", ready_merge: "待合并", merged: "已合并" })[resolveBookStatus(item, byProjectId[String(item.production?.projectId)] || null)] || itemStatus(item),
  }));
}
function summarise(items) {
  return STATUS_ORDER.reduce(
    (out, label) => ({
      ...out,
      [label]:
        label === "全部"
          ? items.length
          : items.filter((item) => item.displayStatus === label).length,
    }),
    {},
  );
}
function summaryText(batch) {
  const s = batch?.settings || {};
  return `${batch?.mode === "viral" ? "爆款开头" : "原著直出"} · ${s.videoModelName || "未选择模型"} · ${s.aspectRatio || "9:16"} · ${s.fixedSingleVideo ? `固定 ${s.maxVideoDuration || 10}s` : `AI 自动 1-${s.maxVideoDuration || 10}s`}`;
}

function BookList({ entries, selectedId, onSelect }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const shown = entries.filter(
    (item) =>
      `${item.title} ${item.bookId}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (status === "all" || item.displayStatus === status),
  );
  return (
    <aside className="bf-preview-books">
      <div className="bf-preview-section-title">
        <span>小说列表</span>
        <small>
          {shown.length}/{entries.length}
        </small>
      </div>
      <div className="bf-preview-book-tools">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索书名 / Book ID"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">全部状态</option>
          {STATUS_ORDER.slice(1).map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <button
          aria-label="列表设置"
          title="清除搜索和状态筛选"
          onClick={() => {
            setSearch("");
            setStatus("all");
          }}
        >
          <Settings2 size={15} />
        </button>
      </div>
      <div className="bf-preview-book-list">
        {shown.map((item) => (
          <button
            data-batch-item-id={item.id}
            key={item.id}
            className={`bf-preview-book ${selectedId === item.id ? "is-selected" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <span className="bf-preview-book-id">
              {String(item.index).padStart(2, "0")} ·
            </span>
            <span className="bf-preview-book-copy">
              <strong>{item.title}</strong>
              {item.bookId ? <small>Book ID {item.bookId}</small> : null}
            </span>
            <Tag color={tone(item.displayStatus)}>{item.displayStatus}</Tag>
          </button>
        ))}
      </div>
      <div className="bf-preview-pagination">
        共 {entries.length} 本 <b>1</b>
      </div>
    </aside>
  );
}

function CurrentBook({ item, onRetry, canProduce, onSettings }) {
  const failed = item?.displayStatus === "异常";
  const [openSections, setOpenSections] = useState(["source"]);
  const toggle = (section) =>
    setOpenSections((current) =>
      current.includes(section)
        ? current.filter((entry) => entry !== section)
        : [...current, section],
    );
  const storyboard = item?.directorResult?.storyboard || [];
  const sections = [
    [
      "source",
      <FileText size={16} />,
      "原文",
      item?.sourceText || "暂无原文内容。",
    ],
    [
      "hook",
      <Sparkles size={16} />,
      "爆款钩子",
      item?.approvedHookScript || item?.hookDraft || "原著直出模式不生成钩子。",
    ],
    [
      "assets",
      <FolderOpen size={16} />,
      "人物 / 场景 / 道具",
      "导演完成后会在这里显示本书的视觉设定。",
    ],
    [
      "prompts",
      <Video size={16} />,
      "VIDEO 提示词",
      storyboard.length
        ? storyboard
            .map(
              (video) =>
                `VIDEO ${video.id} · ${video.duration_sec || 0}s · ${video.prefix_key || "general_anime"}\n${video.video_desc || ""}`,
            )
            .join("\n\n")
        : "导演完成后会生成分卡 VIDEO 提示词。",
    ],
    [
      "activity",
      <Clock3 size={16} />,
      "操作记录",
      (item?.activityLog || [])
        .slice()
        .reverse()
        .map(
          (entry) =>
            `${entry.at || ""} · ${entry.message || entry.status || "已更新"}`,
        )
        .join("\n") || "暂无操作记录。",
    ],
  ];
  return (
    <section className="bf-preview-center">
      <div className="bf-preview-current">
        <div>
          <h2>{item?.title || "请选择小说"}</h2>
          {item?.bookId ? <span>Book ID {item.bookId}</span> : null}
          <Tag color={tone(item?.displayStatus)}>
            {item?.displayStatus || "待开始"}
          </Tag>
          {item?.settingOverrides ? <Tag color="purple">单书已调整</Tag> : null}
        </div>
        <Button
          icon={<Settings2 size={15} />}
          disabled={!item}
          title={item ? "打开当前小说的单独生产设置" : "请先导入小说"}
          onClick={onSettings}
        >
          单书设置
        </Button>
      </div>
      {failed ? (
        <div className="bf-preview-alert">
          <AlertTriangle size={22} />
          <div>
            <strong>存在异常 VIDEO</strong>
            <small>{item.error || "视频生成失败，请检查后重试。"}</small>
          </div>
          <Button danger disabled={!canProduce} onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : null}
      <div className="bf-preview-content-grid">
        <div className="bf-preview-folds">
          {sections.map(([key, icon, label, content]) => (
            <div key={key}>
              <button
                onClick={() => toggle(key)}
                aria-expanded={openSections.includes(key)}
              >
                {icon} {label} <ChevronDown size={15} />
              </button>
              {openSections.includes(key) ? (
                <div className="bf-preview-readonly">{content}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function VideoOperations({ item, onRetry, onViewPrompt, canProduce, projectStatus, mergeCapability, onMerge, merging }) {
  const [choice, setChoice] = useState("merged");
  const videos = item?.directorResult?.storyboard || [
    { id: "01", duration_sec: 13 },
    { id: "02", duration_sec: 12 },
    { id: "03", duration_sec: 10 },
  ];
  const videoStates = (item?.directorResult?.storyboard || []).map((video, index) => resolveBatchFactoryVideoProduction(item, index, projectStatus));
  const mediaIds = videoStates.map(state => Number(state?.media?.id || 0));
  const hasReadyVideos = videoStates.length > 0 && videoStates.every(state => state?.status === "succeeded") && mediaIds.every(id => id > 0);
  const validBookId = /^\d{1,128}$/.test(String(item?.bookId || ""));
  const canMerge = hasReadyVideos && validBookId && mergeCapability?.ready === true;
  const mergeReason = !mergeCapability?.ready ? (mergeCapability?.reason || "正在检查服务器合并能力") : !validBookId ? "合并需要纯数字 Book ID" : !hasReadyVideos ? "等待当前书全部 VIDEO 成品完成" : "";
  return (
    <aside className="bf-preview-video-operations">
      <div className="bf-preview-section-title">
        <span>当前书 VIDEO</span>
        <small>唯一播放框</small>
      </div>
      <div className="bf-preview-video-section">
        {videos.map((video, index) => {
          const id = String(video.id || index + 1).padStart(2, "0");
          const failed =
            item?.displayStatus === "异常" && index === videos.length - 1;
          return (
            <button
              key={id}
              className={`bf-preview-video-card ${choice === id ? "is-open" : ""}`}
              onClick={() => setChoice(id)}
            >
              <Video size={15} />
              <strong>VIDEO {id}</strong>
              <span>{video.duration_sec || 10}s</span>
              <Tag color={failed ? "red" : "gold"}>
                {failed ? "失败" : "待生成"}
              </Tag>
            </button>
          );
        })}
        <button
          className={`bf-preview-video-card ${choice === "merged" ? "is-open" : ""}`}
          onClick={() => setChoice("merged")}
        >
          <CircleCheck size={15} />
          <strong>合并成片</strong>
          <span>当前书</span>
          <Tag>未合并</Tag>
        </button>
      </div>
      <section className="bf-preview-player-panel">
        <div className="bf-preview-player">
          <Play size={28} />
          <div>
            {choice === "merged" ? "合并成片预览" : `VIDEO ${choice} 预览`}
          </div>
        </div>
        <div className="bf-preview-player-actions">
          <Button
            size="small"
            icon={<RotateCcw size={14} />}
            disabled={choice === "merged" || !canProduce}
            onClick={() => onRetry(choice)}
          >
            重试
          </Button>
          <Button
            size="small"
            disabled={choice === "merged" || !canProduce}
            onClick={() => onViewPrompt(choice)}
          >
            查看 Prompt
          </Button>
        </div>
      </section>
      <section className="bf-preview-composer">
        <h3>
          合并设置 <ChevronDown size={15} />
        </h3>
        <label>成品时长处理</label>
        <div className="bf-preview-segment">
          <b>倍速</b>
          <span>跟随音频时长</span>
        </div>
        <select defaultValue="1.5">
          <option value="1.5">1.5x</option>
        </select>
        <Button
          type="primary"
          block
          loading={merging}
          disabled={!canMerge}
          title={mergeReason}
          onClick={() => onMerge({ projectId: Number(item?.production?.projectId), bookId: String(item?.bookId || ""), mediaIds, speed: 1.5 })}
        >
          合并当前小说
        </Button>
      </section>
    </aside>
  );
}

function BatchIntakeDrawer({ open, onClose, onCreated }) {
  const [pasted, setPasted] = useState("");
  const [items, setItems] = useState([]);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);

  function updateItems(updater) {
    setItems((current) => updater(current).slice(0, 200));
  }

  function inspectItems(drafts = items) {
    const titleCounts = new Map();
    const bookIdCounts = new Map();
    for (const item of drafts) {
      const title = String(item.title || "").trim();
      const bookId = String(item.bookId || "").trim();
      if (title) titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
      if (bookId) bookIdCounts.set(bookId, (bookIdCounts.get(bookId) || 0) + 1);
    }
    return drafts.map((item) => ({
      ...item,
      duplicateFields: [
        ...(titleCounts.get(String(item.title || "").trim()) > 1
          ? ["title"]
          : []),
        ...(bookIdCounts.get(String(item.bookId || "").trim()) > 1
          ? ["bookId"]
          : []),
      ],
      validationError:
        item.bookId && !/^\d+$/.test(String(item.bookId).trim())
          ? "Book ID 只能填写数字"
          : !String(item.sourceText || "").trim()
            ? "正文不能为空"
            : "",
    }));
  }

  const inspectedItems = inspectItems();

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    loadBatchFactoryVideoModels()
      .then((result) => {
        if (!active) return;
        const compatible = result.filter(
          (model) =>
            model.requiresImageInput !== true &&
            Number(model.maxVideoDuration) >= 1,
        );
        setModels(compatible);
        if (compatible.length)
          setModelId((current) => current || compatible[0].id);
      })
      .catch(
        (error) => active && message.error(error.message || "读取视频模型失败"),
      );
    return () => {
      active = false;
    };
  }, [open]);

  function addPasted() {
    const next = parseManualNovels(pasted);
    if (!next.length) return message.warning("请先粘贴小说正文");
    updateItems((current) => [...current, ...next]);
    setPasted("");
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const supported = files.filter((file) => /\.(txt|md)$/i.test(file.name));
    if (supported.length !== files.length)
      message.warning("只支持 TXT / MD 文件");
    const allowed = supported.filter((file) => file.size <= 2 * 1024 * 1024);
    if (allowed.length !== supported.length)
      message.error("单个文件不能超过 2 MB");
    const next = await Promise.all(
      allowed.map(async (file) => {
        const draft = fileToDraft(file.name, await file.text());
        return { ...draft, fileName: file.name };
      }),
    );
    const valid = next.filter((item) => item.sourceText);
    if (valid.length !== next.length) message.error("文件正文不能为空");
    if (valid.length) updateItems((current) => [...current, ...valid]);
  }

  async function submit(drafts) {
    const selectedModel = models.find(
      (model) => Number(model.id) === Number(modelId),
    );
    if (!drafts.length) return message.warning("至少导入一篇小说");
    if (!selectedModel) return message.warning("请选择可用的视频模型");
    setCreating(true);
    try {
      const created = await createBatchFactoryBatch({
        mode: "original",
        items: drafts,
        settings: {
          videoModelId: selectedModel.id,
          videoModelVersionId: selectedModel.versionId,
          videoModelName: selectedModel.name,
          maxVideoDuration: selectedModel.maxVideoDuration,
          fixedSingleVideo: false,
          aspectRatio: "9:16",
          prefixMode: "auto",
          style: "高质量动漫短视频",
        },
      });
      onCreated(created.batch);
      setItems([]);
      onClose();
      message.success(`已创建批次，包含 ${drafts.length} 本小说`);
    } catch (error) {
      message.error(error.message || "创建批次失败");
    } finally {
      setCreating(false);
    }
  }

  function create() {
    try {
      const drafts = validateDraftItems(inspectedItems);
      const duplicates = drafts.some((item) => item.duplicateFields?.length);
      if (!duplicates) return submit(drafts);
      Modal.confirm({
        title: "检测到重复书名或 Book ID",
        content: "继续创建会保留重复标记，不会自动修改书名或 Book ID。",
        okText: "继续创建",
        cancelText: "返回修改",
        onOk: () => submit(drafts),
      });
    } catch (error) {
      message.error(error.message || "导入内容不符合要求");
    }
  }

  return (
    <Drawer
      title="新建批次"
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <div className="bf-intake-drawer">
        <label>粘贴小说正文</label>
        <Input.TextArea
          rows={9}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder={
            "支持多篇粘贴：\n1\n第一篇标题\n正文\n\n2\n第二篇标题\n正文"
          }
        />
        <div className="bf-intake-actions">
          <Button onClick={addPasted}>加入列表</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            multiple
            hidden
            onChange={addFiles}
          />
          <Button onClick={() => fileInputRef.current?.click()}>
            上传 TXT / MD
          </Button>
        </div>
        <label>视频模型</label>
        <Select
          value={modelId}
          onChange={setModelId}
          placeholder="选择视频模型"
          options={models.map((model) => ({
            value: model.id,
            label: `${model.name} · 最长 ${model.maxVideoDuration}s`,
          }))}
        />
        <div className="bf-intake-list">
          <strong>待导入小说 {items.length}/200</strong>
          {inspectedItems.map((item, index) => (
            <div key={`${item.title}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div className="bf-intake-fields">
                <Input
                  size="small"
                  title="更新书名"
                  aria-label={`第 ${index + 1} 本书名`}
                  value={item.title}
                  placeholder="书名"
                  onChange={(event) =>
                    updateItems((current) =>
                      current.map((entry, itemIndex) =>
                        itemIndex === index
                          ? { ...entry, title: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <Input
                  size="small"
                  title="更新 Book ID"
                  aria-label={`第 ${index + 1} 本 Book ID`}
                  value={item.bookId}
                  placeholder="Book ID（可留空）"
                  onChange={(event) =>
                    updateItems((current) =>
                      current.map((entry, itemIndex) =>
                        itemIndex === index
                          ? { ...entry, bookId: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <small>{item.fileName || `${item.sourceText.length} 字`}</small>
                {item.duplicateFields?.includes("title") ? (
                  <Tag color="orange">书名重复</Tag>
                ) : null}
                {item.duplicateFields?.includes("bookId") ? (
                  <Tag color="orange">ID 重复</Tag>
                ) : null}
                {item.validationError ? (
                  <Tag color="red">{item.validationError}</Tag>
                ) : null}
              </div>
              <Button
                type="text"
                danger
                size="small"
                onClick={() =>
                  updateItems((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                移除
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="primary"
          block
          loading={creating}
          disabled={
            !items.length ||
            !modelId ||
            inspectedItems.some((item) => item.validationError)
          }
          onClick={create}
        >
          创建批次
        </Button>
      </div>
    </Drawer>
  );
}

function ProductionSettingsDrawer({ open, onClose, batch, entries, onSaved }) {
  const [scope, setScope] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setSettings({ ...(batch?.settings || {}) }); setSelectedIds(entries.slice(0, 1).map(item => item.id)); setScope("all"); } }, [open, batch, entries]);
  const patchSetting = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  async function save() {
    if (!batch?.id) return;
    setSaving(true);
    try {
      let updated = batch;
      if (scope === "all") updated = (await updateBatchFactorySettings(batch.id, settings)).batch || batch;
      else for (const id of selectedIds) {
        const item = entries.find(entry => entry.id === id);
        if (!item) continue;
        const result = await updateBatchFactoryItem(batch.id, id, { ...item, settingOverrides: { ...(item.settingOverrides || {}), ...settings }, manuallyEdited: true });
        if (result.item) updated = { ...updated, items: updated.items.map(entry => entry.id === id ? result.item : entry) };
      }
      onSaved(updated); message.success(scope === "all" ? "已保存生产统一设置" : `已保存 ${selectedIds.length} 本小说的单独设置`); onClose();
    } catch (error) { message.error(error.message || "保存生产设置失败"); } finally { setSaving(false); }
  }
  return <Drawer title="生产统一设置" placement="right" width={460} open={open} onClose={onClose} destroyOnClose><div className="bf-settings-drawer">
    <label>应用范围</label><Select value={scope} onChange={setScope} options={[{ value: "all", label: "全部小说（未单独覆盖）" }, { value: "individual", label: "个别小说" }]} />
    {scope === "individual" ? <div className="bf-settings-books">{entries.map(item => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /> {item.title}</label>)}</div> : null}
    <label>最大视频时长（秒）</label><Input type="number" min={1} max={60} value={settings.maxVideoDuration || 10} onChange={event => patchSetting("maxVideoDuration", Number(event.target.value))} />
    <label>画幅</label><Select value={settings.aspectRatio || "9:16"} onChange={value => patchSetting("aspectRatio", value)} options={[{ value: "9:16", label: "9:16 竖屏" }, { value: "16:9", label: "16:9 横屏" }]} />
    <label className="bf-settings-check"><input type="checkbox" checked={settings.fixedSingleVideo === true} onChange={event => patchSetting("fixedSingleVideo", event.target.checked)} /> 固定单镜头时长</label>
    <label>视频风格</label><Input value={settings.style || ""} onChange={event => patchSetting("style", event.target.value)} placeholder="例如：高质量动漫短视频" />
    <Button type="primary" block loading={saving} disabled={scope === "individual" && !selectedIds.length} onClick={save}>保存设置</Button>
  </div></Drawer>;
}

export function BatchFactoryPreviewPage() {
  const [batch, setBatch] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [currentFilter, setCurrentFilter] = useState("全部");
  const [filterPosition, setFilterPosition] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mergeCapability, setMergeCapability] = useState(null);
  const listRef = useRef(null);
  const { byProjectId, error: productionStatusError, refreshNow: refreshProductionStatus } = useBatchFactoryProductionStatus(batch);
  useEffect(() => {
    let active = true;
    getBatchFactoryMergeCapability().then(result => active && setMergeCapability(result)).catch(error => active && setMergeCapability({ ready: false, reason: error.message || "无法读取服务器合并能力" }));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const intakeId = new URLSearchParams(window.location.search).get("intake");
        if (intakeId) {
          const { intake } = await getBatchFactoryIntake(intakeId);
          let activeBatch = null;
          if (intake?.batchId) {
            activeBatch = (await getBatchFactoryBatch(intake.batchId)).batch || null;
          } else if (intake?.items?.length) {
            const models = await loadBatchFactoryVideoModels();
            const model = models.find(
              (entry) => entry.requiresImageInput !== true && Number(entry.maxVideoDuration) >= 1,
            );
            if (!model) throw new Error("请先在设置中配置可用的文生视频模型");
            const created = await createBatchFactoryBatch({
              name: intake.name,
              sourceIntakeId: intake.id,
              mode: "original",
              items: intake.items,
              settings: {
                videoModelId: model.id,
                videoModelVersionId: model.versionId,
                videoModelName: model.name,
                maxVideoDuration: model.maxVideoDuration,
                fixedSingleVideo: false,
                aspectRatio: "9:16",
                prefixMode: "auto",
                style: "高质量动漫短视频",
              },
            });
            activeBatch = created.batch || null;
          }
          if (!disposed && activeBatch) setBatch(activeBatch);
          const url = new URL(window.location.href);
          url.searchParams.delete("intake");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
          return;
        }
        const { batches } = await listBatchFactoryBatches();
        if (!batches?.[0]) return;
        const detail = await getBatchFactoryBatch(batches[0].id);
        if (!disposed) setBatch(detail.batch || null);
      } catch (_) {
        /* Empty-state frame remains usable. */
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  const entries = useMemo(() => mapItems(batch, byProjectId), [batch, byProjectId]);
  const summary = summarise(entries);
  const selected = entries.find((item) => item.id === selectedId) || entries[0] || null;
  const canProduceSelected = Boolean(
    batch?.id &&
    selected?.id &&
    Number.isInteger(Number(batch?.settings?.videoModelId)) &&
    Number(batch.settings.videoModelId) > 0,
  );
  const currentItems =
    currentFilter === "全部"
      ? entries
      : entries.filter((item) => item.displayStatus === currentFilter);
  useEffect(() => {
    if (!selectedId && entries[0]) setSelectedId(entries[0].id);
  }, [entries, selectedId]);
  function locateStatus(label) {
    const matching =
      label === "全部"
        ? entries
        : entries.filter((item) => item.displayStatus === label);
    const next =
      label === currentFilter
        ? (filterPosition + 1) % Math.max(1, matching.length)
        : 0;
    setCurrentFilter(label);
    setFilterPosition(next);
    if (!matching[next]) return;
    setSelectedId(matching[next].id);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector(`[data-batch-item-id="${matching[next].id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }
  function selectBook(id) {
    setSelectedId(id);
    const index = currentItems.findIndex((item) => item.id === id);
    if (index >= 0) setFilterPosition(index);
  }
  async function startDirector() {
    if (!batch?.id) return;
    setStarting(true);
    try {
      const result = await startBatchFactoryBatch(batch.id);
      setBatch(result.batch);
      message.success("已提交导演任务，状态中心会随队列结果刷新。");
    } catch (error) {
      message.error(error.message || "启动导演失败");
    } finally {
      setStarting(false);
    }
  }
  async function generatePendingVideos() {
    const modelId = Number(batch?.settings?.videoModelId);
    if (!batch?.id || !Number.isInteger(modelId) || modelId < 1) return;
    setGenerating(true);
    try {
      await generateBatchFactoryBatch(batch.id, modelId);
      const refreshed = await getBatchFactoryBatch(batch.id);
      setBatch(refreshed.batch);
      message.success("待生成 VIDEO 已提交生产队列。");
    } catch (error) {
      message.error(error.message || "提交视频生成失败");
    } finally {
      setGenerating(false);
    }
  }
  async function refreshActiveBatch() {
    if (!batch?.id) return;
    const refreshed = await getBatchFactoryBatch(batch.id);
    setBatch(refreshed.batch);
    refreshProductionStatus();
  }
  async function retryCurrentBookVideo() {
    const modelId = Number(batch?.settings?.videoModelId);
    if (
      !batch?.id ||
      !selected?.id ||
      !Number.isInteger(modelId) ||
      modelId < 1
    )
      return;
    try {
      await generateBatchFactoryVideos(batch.id, selected.id, modelId, {
        force: true,
      });
      await refreshActiveBatch();
      message.success("已重新提交当前小说的视频生成任务。");
    } catch (error) {
      message.error(error.message || "重新提交视频失败");
    }
  }
  async function viewVideoPrompt(choice) {
    if (!batch?.id || !selected?.id || choice === "merged") return;
    const video = (selected.directorResult?.storyboard || []).find(
      (entry, index) =>
        String(entry.id || index + 1).padStart(2, "0") === String(choice),
    );
    if (!video) return message.warning("该 VIDEO 还没有可查看的提示词");
    try {
      const result = await compileBatchFactoryVideo(
        batch.id,
        selected.id,
        video.id,
      );
      Modal.info({
        title: `VIDEO ${String(video.id).padStart(2, "0")} 提示词 · ${result.prefix?.key || video.prefix_key || "general_anime"} · 前缀版本 ${result.prefix?.preset?.version || 0}`,
        width: 760,
        content: (
          <pre className="bf-preview-prompt">
            {result.payload?.prompt || "暂无提示词"}
          </pre>
        ),
      });
    } catch (error) {
      message.error(error.message || "读取提示词失败");
    }
  }
  async function mergeCurrentBook(payload) {
    if (!payload.projectId || !payload.bookId || !payload.mediaIds.length) return;
    setMerging(true);
    try {
      const result = await mergeBatchFactoryVideos(payload);
      message.success(`合并完成：${result.filename || `${payload.bookId}.mp4`}`);
      refreshProductionStatus();
    } catch (error) {
      message.error(error.message || "合并当前小说失败");
    } finally {
      setMerging(false);
    }
  }
  async function mergeAllCompleted() {
    if (mergeCapability?.ready !== true) return message.warning(mergeCapability?.reason || "视频合并服务尚未就绪");
    const candidates = entries.map(item => {
      const states = (item.directorResult?.storyboard || []).map((_, index) => resolveBatchFactoryVideoProduction(item, index, byProjectId[String(item.production?.projectId)] || null));
      const mediaIds = states.map(state => Number(state?.media?.id || 0));
      return { item, mediaIds, ready: states.length > 0 && states.every(state => state?.status === "succeeded") && mediaIds.every(id => id > 0) && /^\d+$/.test(String(item.bookId || "")) };
    }).filter(candidate => candidate.ready && !candidate.item.production?.mergedAt);
    if (!candidates.length) return message.info("当前没有可合并的已完成小说");
    setMerging(true); let success = 0;
    try { for (const candidate of candidates) { await mergeBatchFactoryVideos({ projectId: Number(candidate.item.production.projectId), bookId: String(candidate.item.bookId), mediaIds: candidate.mediaIds, speed: 1.5 }); success += 1; } await refreshActiveBatch(); refreshProductionStatus(); message.success(`批量合并完成：${success} 本`); }
    catch (error) { message.error(error.message || "批量合并失败"); } finally { setMerging(false); }
  }
  return (
    <div className="bf-preview-page">
      <header className="bf-preview-header">
        <div className="bf-preview-heading">
          <div>
            <Button
              type="text"
              icon={<ArrowLeft size={16} />}
              onClick={() => {
                window.history.pushState({}, "", "/shuihuo-production");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              返回水货生产
            </Button>
            <h1>
              批量工厂{" "}
              <small>统一设置一次，批量生产；特殊小说再单独调整。</small>
            </h1>
          </div>
          <Button
            type="primary"
            icon={<Sparkles size={15} />}
            onClick={() => setIntakeOpen(true)}
          >
            新建批次
          </Button>
        </div>
      </header>
      <main>
        <section className="bf-preview-batch-bar">
          <div className="bf-preview-batch-meta">
            <strong>批次</strong>
            <b>{batch?.name || "待创建批次"}</b>
            <span>· {entries.length} 本小说</span>
            <button
              aria-label="编辑批次"
              disabled
              title="批次名称编辑需要持久化接口后开放"
            >
              <FileText size={14} />
            </button>
            <div className="bf-preview-tabs">
              <Button
                type="primary"
                icon={<Settings2 size={15} />}
                disabled={!batch?.id}
                title={batch?.id ? "打开生产统一设置" : "请先新建或导入批次"}
                onClick={() => setSettingsOpen(true)}
              >
                生产统一设置
              </Button>
              <Button icon={<Upload size={15} />} onClick={() => Modal.info({ title: "发布统一设置", content: "121 上传发布尚未接入。本轮先完成小说导入、导演、VIDEO 生产和合并闭环。" })}>
                发布统一设置
              </Button>
            </div>
          </div>
          <div className="bf-preview-summaries">
            <div>
              生产： <b>{summaryText(batch)}</b>
            </div>
            <div>
              发布： <b>本期暂不支持上传发布</b>
            </div>
          </div>
          <div className="bf-preview-actions">
            <Button
              icon={<Settings2 size={15} />}
              disabled={!batch?.id}
              title={batch?.id ? "打开高级生产设置" : "请先新建或导入批次"}
              onClick={() => setSettingsOpen(true)}
            >
              高级设置
            </Button>
            <Button
              type="primary"
              icon={<Play size={15} />}
              loading={starting}
              disabled={!batch?.id}
              onClick={startDirector}
            >
              开始导演
            </Button>
            <Button
              icon={<Sparkles size={15} />}
              loading={generating}
              disabled={
                !batch?.id ||
                !summary["待生成"] ||
                !Number(batch.settings?.videoModelId)
              }
              onClick={generatePendingVideos}
            >
              生成待生成 <small>{summary["待生成"]}</small>
            </Button>
            <Button
              icon={<RotateCcw size={15} />}
              loading={merging}
              disabled={!entries.some(item => item.displayStatus === "待合并")}
              onClick={mergeAllCompleted}
            >
              合并待合并 <small>{summary["待合并"]}</small>
            </Button>
          </div>
        </section>
        <section className="bf-preview-status">
          <div className="bf-preview-status-title">
            <strong>批次状态中心</strong>
            <span>按小说计数 · 点击连续定位</span>
          </div>
          <div className="bf-preview-status-grid">
            {STATUS_ORDER.map((label) => (
              <button
                key={label}
                className={`${label === "异常" ? "is-danger" : ""} ${currentFilter === label ? "is-active" : ""}`}
                onClick={() => locateStatus(label)}
              >
                <span>{label}</span>
                <b>{summary[label]}</b>
              </button>
            ))}
          </div>
          <div className="bf-preview-abnormal">
            <span>
              当前筛选：<b>{currentFilter}</b> {currentItems.length} 本{" "}
              {currentItems.length
                ? `· ${Math.min(filterPosition + 1, currentItems.length)}/${currentItems.length}`
                : ""}
            </span>
            {currentItems.map((item) => (
              <button key={item.id} onClick={() => selectBook(item.id)}>
                {String(item.index).padStart(2, "0")}　{item.title}　
                {item.bookId ? <span>Book ID {item.bookId}</span> : null}
                {item.displayStatus === "异常" ? <em>需要处理</em> : null}
              </button>
            ))}
          </div>
        </section>
        <div className="bf-preview-grid" ref={listRef}>
          {entries.length ? <BookList entries={entries} selectedId={selected?.id} onSelect={selectBook} /> : <aside className="bf-preview-books bf-preview-empty"><div className="bf-preview-section-title"><span>小说列表</span><small>0/0</small></div><div className="bf-preview-empty-copy"><FolderOpen size={28} /><strong>暂无小说</strong><span>点击右上角“新建批次”上传或粘贴 TXT / MD</span><Button type="primary" onClick={() => setIntakeOpen(true)}>导入小说</Button></div></aside>}
          <CurrentBook
            item={selected}
            onRetry={retryCurrentBookVideo}
            canProduce={canProduceSelected}
            onSettings={() => setSettingsOpen(true)}
          />
          <VideoOperations
            item={selected}
            onRetry={retryCurrentBookVideo}
            onViewPrompt={viewVideoPrompt}
            canProduce={canProduceSelected}
            projectStatus={byProjectId[String(selected?.production?.projectId)] || null}
            mergeCapability={mergeCapability}
            onMerge={mergeCurrentBook}
            merging={merging}
          />
          <aside className="bf-preview-rail">
            <h3>
              视频生成进度 <ChevronDown size={15} />
            </h3>
            <div className="bf-preview-ring">
              <Progress
                type="circle"
                percent={
                  entries.length
                    ? Math.round(
                        ((summary["待合并"] + summary["已合并"]) /
                          entries.length) *
                          100,
                      )
                    : 0
                }
                strokeColor="#4b7cff"
                trailColor="#20304b"
                format={() => (
                  <>
                    <b>VIDEO</b>
                    <small>全批次进度</small>
                  </>
                )}
              />
            </div>
            <ul>
              <li>
                <i className="dot orange" />
                待生成 <b>{summary["待生成"]}</b>
              </li>
              <li>
                <i className="dot blue" />
                排队中 <b>{summary["排队中"]}</b>
              </li>
              <li>
                <i className="dot purple" />
                生成中 <b>{summary["视频生成中"]}</b>
              </li>
              <li>
                <i className="dot green" />
                已合并 <b>{summary["已合并"]}</b>
              </li>
              <li>
                <i className="dot red" />
                异常 <b>{summary["异常"]}</b>
              </li>
            </ul>
            <p>这里始终显示全批次进度，不随当前书切换。</p>
            {productionStatusError ? <p className="bf-preview-status-error">视频状态刷新失败：{productionStatusError}</p> : null}
            <div className="bf-preview-merge">
              <h3>
                批量合并 <ChevronDown size={15} />
              </h3>
              <label>合并范围</label>
              <Select
                value="全部已完成小说"
                options={[
                  {
                    value: "全部已完成小说",
                    label: `全部已完成小说（${summary["已合并"] + summary["待合并"]}）`,
                  },
                ]}
              />
              <label>成品时长处理</label>
              <div className="bf-preview-segment">
                <b>倍速</b>
                <span>跟随音频时长</span>
              </div>
              <Select
                value="1.5x"
                options={[{ value: "1.5x", label: "1.5x" }]}
              />
              <Button type="primary" block loading={merging} disabled={!entries.some(item => item.displayStatus === "待合并")} onClick={mergeAllCompleted}>
                合并全部已完成小说
              </Button>
            </div>
          </aside>
        </div>
      </main>
      <BatchIntakeDrawer
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        onCreated={(created) => {
          setBatch(created);
          setSelectedId(created.items?.[0]?.id || "");
          setCurrentFilter("全部");
          setFilterPosition(0);
        }}
      />
      <ProductionSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} batch={batch} entries={entries} onSaved={setBatch} />
    </div>
  );
}
export default BatchFactoryPreviewPage;
