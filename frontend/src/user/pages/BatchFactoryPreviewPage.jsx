import { updateBatchFactorySettings } from "../../shared/api/batchFactory";
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
  SlidersHorizontal,
  Shuffle,
} from "lucide-react";
import {
  compileBatchFactoryVideo,
  createBatchFactoryBatch,
  generateBatchFactoryVideos,
  generateBatchFactoryBatch,
  getBatchFactoryBatch,
  listBatchFactoryBatches,
  startBatchFactoryBatch,
} from "../../shared/api/batchFactory";
import { loadBatchFactoryVideoModels } from "./batch-factory/BatchFactoryProductionControls";
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
function mapItems(batch) {
  return (batch?.items || []).map((item, index) => ({
    ...item,
    id: item.id || `book-${index}`,
    title: item.title || "未命名小说",
    bookId: item.bookId || "",
    index: index + 1,
    displayStatus: itemStatus(item),
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

function CurrentBook({ item, onRetry, canProduce }) {
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
      "VIDO 提示词",
      storyboard.length
        ? storyboard
            .map(
              (video) =>
                `VIDO${String(video.id).padStart(2, "0")} · ${video.duration_sec || 0}s\n${video.video_desc || ""}`,
            )
            .join("\n\n")
        : "导演完成后会生成分卡 VIDO 提示词。",
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
          disabled
          title="单书生产设置需要 MySQL 配置快照接口后才可保存"
        >
          单书设置
        </Button>
      </div>
      {failed ? (
        <div className="bf-preview-alert">
          <AlertTriangle size={22} />
          <div>
            <strong>存在异常 VIDO</strong>
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

function VideoOverrideModal({ video, open, onClose, onSave }) {
  const [local, setLocal] = useState({});
  useEffect(() => { if (open && video) setLocal({ ...video }); }, [open, video]);
  const set = (key, value) => setLocal(prev => ({ ...prev, [key]: value }));
  const vid = String(video?.id || "").padStart(2, "0");
  return (
    <Modal title={"VIDO" + vid + " 单卡设置覆盖"} open={open} onCancel={onClose} width={560} footer={null} destroyOnClose>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <label>时长模式
            <select className="bf-preview-select" value={local.durationMode || "inherit"} onChange={e => set("durationMode",e.target.value)}>
              <option value="inherit">继承批次设置</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>画幅模式
            <select className="bf-preview-select" value={local.aspectMode || "inherit"} onChange={e => set("aspectMode",e.target.value)}>
              <option value="inherit">继承批次设置</option>
              <option value="custom">自定义</option>
            </select>
          </label>
        </div>
        <div style={{borderTop:"1px solid #1e3348",paddingTop:10}}>
          <strong style={{color:"#8ba4c0",fontSize:13}}>提示词注入覆盖</strong>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.characterEnabled !== false} onChange={e => set("characterEnabled",e.target.checked)} /> 人物</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.sceneEnabled !== false} onChange={e => set("sceneEnabled",e.target.checked)} /> 场景</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.propEnabled !== false} onChange={e => set("propEnabled",e.target.checked)} /> 道具</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.qualityEnabled !== false} onChange={e => set("qualityEnabled",e.target.checked)} /> 画质</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.restrictionEnabled !== false} onChange={e => set("restrictionEnabled",e.target.checked)} /> 限制</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.negativeEnabled !== false} onChange={e => set("negativeEnabled",e.target.checked)} /> 负面</label>
          </div>
        </div>
        <div style={{borderTop:"1px solid #1e3348",paddingTop:10}}>
          <strong style={{color:"#8ba4c0",fontSize:13}}>候选 Prompt 风格</strong>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
            {["realistic","anime","webtoon","emotion"].map(s => (
              <label key={s} className="bf-preview-switch">
                <input type="radio" name="promptStyle" checked={local.promptStyle === s} onChange={() => set("promptStyle",s)} />
                {s === "realistic" ? "稳定写实" : s === "anime" ? "高质量动漫" : s === "webtoon" ? "韩漫商业" : "强情绪爆款"}
              </label>
            ))}
          </div>
        </div>
        <Button type="primary" block onClick={() => { onSave && onSave(local); onClose(); }}>保存覆盖</Button>
      </div>
    </Modal>
  );
}

function VideoOperations({ item, choice, onChoice, onRetry, onViewPrompt, canProduce, onOverride }) {
  const videos = item?.directorResult?.storyboard || [
    { id: "01", duration_sec: 13 },
    { id: "02", duration_sec: 12 },
    { id: "03", duration_sec: 10 },
  ];
  // TTS timing estimation
  const sourceLen = (item?.sourceText || "").length;
  const ttsEstimate = sourceLen > 0 ? Math.ceil(sourceLen / (4 * 1.7)) : 0;
  return (
    <aside className="bf-preview-video-operations">
      <div className="bf-preview-section-title">
        <span>当前书 VIDO</span>
        <small>统一播放器 · 点击切换</small>
      </div>
      <div className="bf-preview-video-section">
        {videos.map((video, index) => {
          const id = String(video.id || index + 1).padStart(2, "0");
          const failed =
            item?.displayStatus === "异常" && index === videos.length - 1;
          return (
            <button
              key={id}
              className={"bf-preview-video-card " + (choice === id ? "is-open" : "")}
              onClick={() => onChoice(id)}
            >
              <Video size={15} />
              <strong>VIDO{id}</strong>
              <span>{video.duration_sec || 10}s</span>
              <Tag color={failed ? "red" : "gold"}>
                {failed ? "失败" : "待生成"}
              </Tag>
              <button className="bf-preview-override-btn" title="单卡设置覆盖" onClick={e => { e.stopPropagation(); onOverride && onOverride(video); }}>
                <SlidersHorizontal size={12} />
              </button>
            </button>
          );
        })}
        <button
          className={"bf-preview-video-card " + (choice === "merged" ? "is-open" : "")}
          onClick={() => onChoice("merged")}
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
            {choice === "merged" ? "合并成片预览" : "VIDO" + choice + " 预览"}
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
        {item?.sourceText ? (
          <div className="bf-preview-tts">
            <small>TTS 测时：约 {ttsEstimate} 秒</small>
            <small>（基于 {sourceLen} 字 × 1.7 倍速）</small>
          </div>
        ) : null}
        <Button
          type="primary"
          block
          onClick={() => message.info("合并功能需要上游 FFmpeg 服务支持，当前模拟状态。")}
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


function ProductionSettingsModal({ open, settings, onClose, onSave, saving }) {
  const [local, setLocal] = useState({});
  useEffect(() => { if (open) setLocal({ ...settings }); }, [open, settings]);
  const set = (key, value) => setLocal(prev => ({ ...prev, [key]: value }));
  return (
    <Modal title="生产统一设置" open={open} onCancel={onClose} width={640} footer={null} destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>视频画幅
            <select className="bf-preview-select" value={local.aspectRatio || '9:16'} onChange={e => set('aspectRatio', e.target.value)}>
              <option value="9:16">9:16（竖屏）</option>
              <option value="16:9">16:9（横屏）</option>
            </select>
          </label>
          <label>前缀模式
            <select className="bf-preview-select" value={local.prefixMode || 'auto'} onChange={e => set('prefixMode', e.target.value)}>
              <option value="auto">AI 自动判断</option>
              <option value="manual">统一手动前缀</option>
            </select>
          </label>
        </div>
        {local.prefixMode === 'manual' ? (
          <label>自定义前缀
            <textarea className="bf-preview-textarea" rows={3} value={local.customPrefix || ''} onChange={e => set('customPrefix', e.target.value)} placeholder="输入统一画面前缀..." />
          </label>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>视频风格
            <select className="bf-preview-select" value={local.style || '高质量动漫短视频'} onChange={e => set('style', e.target.value)}>
              <option value="高质量动漫短视频">高质量动漫短视频</option>
              <option value="写实风格">写实风格</option>
              <option value="韩漫商业">韩漫商业</option>
              <option value="强情绪爆款">强情绪爆款</option>
            </select>
          </label>
          <label>字幕策略
            <select className="bf-preview-select" value={local.subtitlePolicy || 'no_auto_dialogue_subtitles'} onChange={e => set('subtitlePolicy', e.target.value)}>
              <option value="no_auto_dialogue_subtitles">禁止自动对白字幕</option>
              <option value="auto">允许自动字幕</option>
            </select>
          </label>
        </div>
        <div style={{ borderTop: '1px solid #1e3348', paddingTop: 12 }}>
          <strong style={{ color: '#8ba4c0', fontSize: 13 }}>提示词注入开关</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.prefixEnabled !== false} onChange={e => set('prefixEnabled', e.target.checked)} /> 画面前缀</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.characterPromptInjection !== false} onChange={e => set('characterPromptInjection', e.target.checked)} /> 人物 Prompt</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.scenePromptInjection !== false} onChange={e => set('scenePromptInjection', e.target.checked)} /> 场景 Prompt</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.propPromptInjection !== false} onChange={e => set('propPromptInjection', e.target.checked)} /> 道具 Prompt</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.qualityEnabled !== false} onChange={e => set('qualityEnabled', e.target.checked)} /> 画质约束</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.visualRestrictionEnabled !== false} onChange={e => set('visualRestrictionEnabled', e.target.checked)} /> 画面限制</label>
            <label className="bf-preview-switch"><input type="checkbox" checked={local.negativeEnabled !== false} onChange={e => set('negativeEnabled', e.target.checked)} /> 负面提示词</label>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #1e3348', paddingTop: 12 }}>
          <strong style={{ color: '#8ba4c0', fontSize: 13 }}>专业视频约束</strong>
          <label style={{ marginTop: 8, display: 'block' }}>画质约束
            <textarea className="bf-preview-textarea" rows={2} value={local.quality || ''} onChange={e => set('quality', e.target.value)} placeholder="最高画质，细节丰富..." />
          </label>
          <label style={{ marginTop: 8, display: 'block' }}>画面限制
            <textarea className="bf-preview-textarea" rows={2} value={local.restriction || ''} onChange={e => set('restriction', e.target.value)} placeholder="禁止变形、扭曲..." />
          </label>
          <label style={{ marginTop: 8, display: 'block' }}>负面提示词
            <textarea className="bf-preview-textarea" rows={2} value={local.negative || ''} onChange={e => set('negative', e.target.value)} placeholder="低质量、模糊..." />
          </label>
        </div>
        <Button type="primary" block loading={saving} onClick={() => onSave(local)}>保存设置</Button>
      </div>
    </Modal>
  );
}

function PublishSettingsDrawer({ open, settings, onClose, onSave, saving }) {
  const [local, setLocal] = useState({});
  useEffect(() => { if (open) setLocal({ ...settings }); }, [open, settings]);
  const set = (key, value) => setLocal(prev => ({ ...prev, [key]: value }));
  return (
    <Drawer title="发布统一设置" placement="right" width={480} open={open} onClose={onClose} destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>成品合并策略
          <select className="bf-preview-select" value={local.publishMergeStrategy || 'merged'} onChange={e => set('publishMergeStrategy', e.target.value)}>
            <option value="merged">合并成片</option>
            <option value="separate">独立 VIDO</option>
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>倍速
            <select className="bf-preview-select" value={local.publishSpeed || '1.5x'} onChange={e => set('publishSpeed', e.target.value)}>
              <option value="1.0x">1.0x</option>
              <option value="1.2x">1.2x</option>
              <option value="1.5x">1.5x</option>
              <option value="2.0x">2.0x</option>
            </select>
          </label>
          <label>生成数量
            <input className="bf-preview-select" type="number" min={1} max={10} value={local.publishGenerate || 1} onChange={e => set('publishGenerate', Number(e.target.value))} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="bf-preview-switch"><input type="checkbox" checked={local.publishReuse === true} onChange={e => set('publishReuse', e.target.checked)} /> 复用已有成品</label>
          <label className="bf-preview-switch"><input type="checkbox" checked={local.publishFlip === true} onChange={e => set('publishFlip', e.target.checked)} /> 翻转画面</label>
        </div>
        <label>滚动字幕
          <input className="bf-preview-select" value={local.publishScroll || ''} onChange={e => set('publishScroll', e.target.value)} placeholder="如：片尾滚动字幕" />
        </label>
        <label>解压倍速
          <input className="bf-preview-select" value={local.publishUnpack || ''} onChange={e => set('publishUnpack', e.target.value)} placeholder="如：1.2x" />
        </label>
        <label>音调
          <input className="bf-preview-select" value={local.publishPitch || ''} onChange={e => set('publishPitch', e.target.value)} placeholder="如：正常" />
        </label>
        <Button type="primary" block loading={saving} onClick={() => onSave(local)}>保存发布设置</Button>
      </div>
    </Drawer>
  );
}

export function BatchFactoryPreviewPage() {
  const [batch, setBatch] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [currentFilter, setCurrentFilter] = useState("全部");
  const [filterPosition, setFilterPosition] = useState(0);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [videoChoice, setVideoChoice] = useState("merged");
  const [overrideVideo, setOverrideVideo] = useState(null);
  const [columnWidths, setColumnWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bfColumnWidths") || "null") || [180, 1, 1, 200]; }
    catch { return [180, 1, 1, 200]; }
  });
  const resizingRef = useRef(null);
  const listRef = useRef(null);

  function startResize(e, index) {
    e.preventDefault();
    resizingRef.current = { index, startX: e.clientX, startWidths: [...columnWidths], started: false };
    document.addEventListener("pointermove", onResize);
    document.addEventListener("pointerup", stopResize);
  }

  function onResize(e) {
    if (!resizingRef.current) return;
    const ref = resizingRef.current;
    const diff = e.clientX - ref.startX;
    if (!ref.started && Math.abs(diff) < 10) return;
    ref.started = true;
    const { index, startWidths } = ref;
    const dampedDiff = Math.round(diff * 0.5);
    const newWidths = [...startWidths];
    if (index === 0) newWidths[0] = Math.max(120, startWidths[0] + dampedDiff);
    else if (index === 3) newWidths[3] = Math.max(120, startWidths[3] - dampedDiff);
    setColumnWidths(newWidths);
  }

  function stopResize() {
    document.removeEventListener("pointermove", onResize);
    document.removeEventListener("pointerup", stopResize);
    localStorage.setItem("bfColumnWidths", JSON.stringify(columnWidths));
    resizingRef.current = null;
  }
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
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
  const entries = useMemo(() => {
    const items = mapItems(batch);
    return items.length ? items : samples;
  }, [batch]);
  const summary = summarise(entries);
  const selected = entries.find((item) => item.id === selectedId) || entries[0];
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
      message.success("待生成 VIDO 已提交生产队列。");
    } catch (error) {
      message.error(error.message || "提交视频生成失败");
    } finally {
      setGenerating(false);
    }
  }
  async function saveSettings(newSettings) {
    if (!batch?.id) return;
    setSavingSettings(true);
    try {
      const result = await updateBatchFactorySettings(batch.id, newSettings);
      setBatch(result.batch);
      setSettingsOpen(false);
      message.success('生产设置已保存');
    } catch (error) {
      message.error(error.message || '保存设置失败');
    } finally {
      setSavingSettings(false);
    }
  }
  async function savePublishSettings(newSettings) {
    if (!batch?.id) return;
    setSavingSettings(true);
    try {
      const result = await updateBatchFactorySettings(batch.id, newSettings);
      setBatch(result.batch);
      setPublishOpen(false);
      message.success('发布设置已保存');
    } catch (error) {
      message.error(error.message || '保存发布设置失败');
    } finally {
      setSavingSettings(false);
    }
  }
  async function refreshActiveBatch() {
    if (!batch?.id) return;
    const refreshed = await getBatchFactoryBatch(batch.id);
    setBatch(refreshed.batch);
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
    if (!video) return message.warning("该 VIDO 还没有可查看的提示词");
    try {
      const result = await compileBatchFactoryVideo(
        batch.id,
        selected.id,
        video.id,
      );
      Modal.info({
        title: `VIDO${String(video.id).padStart(2, "0")} 提示词`,
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
              type="primary"
              icon={<Settings2 size={15} />}
              onClick={() => setSettingsOpen(true)}
            >
              生产统一设置
            </Button>
            <Button icon={<Upload size={15} />} onClick={() => setPublishOpen(true)}>
              发布统一设置
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
              开始视频
            </Button>
            <Button
              icon={<Upload size={15} />}
              onClick={() => setPublishOpen(true)}
            >
              快速上传
            </Button>
          </div>
        </section>

        <div className="bf-preview-grid" ref={listRef}>
          {/* 第1列：小说列表 */}
          <div className="bf-preview-drag-panel" style={{ flex: `0 0 ${columnWidths[0]}px` }}>
            <div className="bf-preview-resize-handle" onMouseDown={(e) => startResize(e, 0)} />
            <BookList entries={entries} selectedId={selected?.id} onSelect={selectBook} />
          </div>

          {/* 第2列：批次状态中心 + 当前筛选 + 当前小说 */}
          <div className="bf-preview-drag-panel" style={{ flex: "1 1 0%" }}>
            <div className="bf-preview-status-filter">
            <section className="bf-preview-status">
              <div className="bf-preview-status-title"><strong>批次状态中心</strong></div>
              <div className="bf-preview-status-grid">
                {STATUS_ORDER.map((label) => (
                  <button key={label} className={`${label === "异常" ? "is-danger" : ""} ${currentFilter === label ? "is-active" : ""}`} onClick={() => locateStatus(label)}>
                    <span>{label}</span>
                    <b>{summary[label]}</b>
                  </button>
                ))}
              </div>
            </section>
            </div>
            <CurrentBook item={selected} onRetry={retryCurrentBookVideo} canProduce={canProduceSelected} />
          </div>

          {/* 第3列：视频操作 */}
          <div className="bf-preview-drag-panel" style={{ flex: "1 1 0%" }}>
            <VideoOperations item={selected} choice={videoChoice} onChoice={setVideoChoice} onRetry={retryCurrentBookVideo} onViewPrompt={viewVideoPrompt} canProduce={canProduceSelected} onOverride={(video) => setOverrideVideo(video)} />
          </div>

          {/* 第4列：视频生成进度 */}
          <div className="bf-preview-drag-panel" style={{ flex: `0 0 ${columnWidths[3]}px` }}>
            <div className="bf-preview-resize-handle" onMouseDown={(e) => startResize(e, 3)} />
            <aside className="bf-preview-rail">
              <h3>视频生成进度 <ChevronDown size={12} /></h3>
              <ul>
                <li><i className="dot orange" />待生成 <b>{summary["待生成"]}</b></li>
                <li><i className="dot blue" />排队中 <b>{summary["排队中"]}</b></li>
                <li><i className="dot purple" />生成中 <b>{summary["视频生成中"]}</b></li>
                <li><i className="dot green" />已合并 <b>{summary["已合并"]}</b></li>
                <li><i className="dot red" />异常 <b>{summary["异常"]}</b></li>
              </ul>
              <p>全批次进度，不随当前书切换</p>
              <div className="bf-preview-merge">
                <h3>批量合并 <ChevronDown size={12} /></h3>
                <label>合并范围</label>
                <Select value="全部已完成小说" options={[{ value: "全部已完成小说", label: `全部已完成小说（${summary["已合并"] + summary["待合并"]}）` }]} />
                <label>成品时长处理</label>
                <div className="bf-preview-segment"><b>倍速</b><span>跟随音频时长</span></div>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <ProductionSettingsModal
        open={settingsOpen}
        settings={batch?.settings || {}}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        saving={savingSettings}
      />
      <VideoOverrideModal
        video={overrideVideo}
        open={!!overrideVideo}
        onClose={() => setOverrideVideo(null)}
        onSave={(video) => {
          message.success("VIDO" + String(video.id || "").padStart(2,"0") + " 单卡设置已保存");
        }}
      />
      <PublishSettingsDrawer
        open={publishOpen}
        settings={batch?.settings || {}}
        onClose={() => setPublishOpen(false)}
        onSave={savePublishSettings}
        saving={savingSettings}
      />
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
    </div>
  );
}
export default BatchFactoryPreviewPage;