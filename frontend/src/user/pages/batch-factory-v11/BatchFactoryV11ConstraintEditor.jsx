import { Button, Input, Segmented, Select, Space, Switch, Tag, Typography } from 'antd';
import { BookmarkPlus, ChevronDown, ChevronUp, Layers3 } from 'lucide-react';
import { useMemo, useState } from 'react';

const { TextArea } = Input;

const PRESET_OPTIONS = {
  prefix: [
    { value: 'cinematic-anime', label: '电影感动态分镜 · V3' },
    { value: 'realistic-drama', label: '真人短剧镜头语言 · V2' }
  ],
  quality: [
    { value: 'quality-pro', label: '高质量商业成片 · V4' },
    { value: 'quality-clean', label: '干净稳定画面 · V2' }
  ],
  restriction: [
    { value: 'continuity', label: '人物 / 场景连续性 · V5' },
    { value: 'safe-frame', label: '镜头与构图限制 · V2' }
  ],
  negative: [
    { value: 'negative-standard', label: '标准负面提示词 · V6' },
    { value: 'negative-text', label: '文字 / 水印抑制 · V3' }
  ]
};

const TEXT_CONSTRAINTS = [
  { key: 'prefix', enabledKey: 'prefixEnabled', label: '画面前缀词', description: '随每个 VIDEO 一起注入；自动模式可再叠加统一前缀。', placeholder: '输入统一画面前缀词…' },
  { key: 'quality', enabledKey: 'qualityEnabled', label: '画质约束', description: '控制清晰度、光影、人物稳定性等画质要求。', placeholder: '输入画质约束…' },
  { key: 'restriction', enabledKey: 'restrictionEnabled', label: '画面限制', description: '限制跳轴、服装漂移、构图错误等不希望出现的画面。', placeholder: '输入画面限制…' },
  { key: 'negative', enabledKey: 'negativeEnabled', label: '负面提示词', description: '用于抑制畸形、低清、错误文字、水印等问题。', placeholder: '输入负面提示词…' }
];

function sourceLabel(source) {
  return {
    system: '系统预设',
    personal: '我的提示词',
    draft: '当前草稿'
  }[source] || '当前草稿';
}

function TextConstraintBlock({ definition, value, onChange, inherited, scope, onSaveDraft, onSavePersonalPrompt }) {
  const { key, enabledKey, label, description, placeholder } = definition;
  const enabled = value?.[enabledKey] === true;
  const [source, setSource] = useState('system');
  const [presetId, setPresetId] = useState(PRESET_OPTIONS[key]?.[0]?.value);
  const [expanded, setExpanded] = useState(enabled);
  const body = String(value?.[key] || '');

  async function saveDraft() {
    if (!onSaveDraft) return;
    await onSaveDraft({ key: `constraint:${key}`, kind: 'constraint', scope, content: body });
  }

  async function savePersonalPrompt() {
    if (!onSavePersonalPrompt) return;
    await onSavePersonalPrompt({ name: `我的${label}`, kind: `constraint:${key}`, content: body });
  }

  function toggle(next) {
    onChange({ [enabledKey]: next });
    if (next) setExpanded(true);
  }

  return <section className={`bf11-constraint-block ${enabled ? 'is-enabled' : ''}`}>
    <div className="bf11-constraint-head">
      <div>
        <Space size={7} wrap>
          <Typography.Text strong>{label}</Typography.Text>
          {inherited ? <Tag>继承</Tag> : null}
          {enabled ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag>}
        </Space>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </div>
      <Space size={5}>
        <Switch checked={enabled} onChange={toggle} />
        {enabled ? <Button
          type="text"
          size="small"
          aria-label={`${label}${expanded ? '收起' : '展开'}`}
          icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          onClick={() => setExpanded(current => !current)}
        /> : null}
      </Space>
    </div>

    {enabled && expanded ? <div className="bf11-constraint-editor">
      <Segmented
        block
        value={source}
        onChange={setSource}
        options={[
          { value: 'system', label: '系统预设' },
          { value: 'personal', label: '我的提示词' },
          { value: 'draft', label: '当前草稿' }
        ]}
      />

      {source !== 'draft' ? <Select
        style={{ width: '100%' }}
        value={presetId}
        onChange={setPresetId}
        options={source === 'system'
          ? PRESET_OPTIONS[key]
          : [{ value: `personal-${key}`, label: `我的${label} 01` }]}
      /> : null}

      <div className="bf11-constraint-body-head">
        <Typography.Text strong>提示词内容</Typography.Text>
        <Tag>{sourceLabel(source)}</Tag>
      </div>
      <TextArea
        rows={5}
        value={body}
        onChange={event => onChange({ [key]: event.target.value })}
        placeholder={placeholder}
      />
      <Space wrap>
        <Button disabled={!onSaveDraft} onClick={saveDraft}>保存当前草稿</Button>
        <Button icon={<BookmarkPlus size={14} />} disabled={!onSavePersonalPrompt} onClick={savePersonalPrompt}>保存为我的提示词</Button>
      </Space>
      <Typography.Text type="secondary">当前设置内容会随批次保存；草稿与个人提示词也会写入 V11 Prompt/Draft 库。</Typography.Text>
    </div> : null}
  </section>;
}

function ToggleRow({ label, description, checked, onChange, inherited }) {
  return <div className="bf11-constraint-toggle-row">
    <div>
      <Space size={7} wrap>
        <Typography.Text strong>{label}</Typography.Text>
        {inherited ? <Tag>继承</Tag> : null}
      </Space>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </div>
    <Switch checked={checked} onChange={onChange} />
  </div>;
}

export function BatchFactoryV11ConstraintEditor({
  value = {},
  onChange,
  scopeLabel = '当前批次',
  inherited = false,
  scope = '',
  onSaveDraft,
  onSavePersonalPrompt
}) {
  const normalized = useMemo(() => ({
    injectBaseSettings: value.injectBaseSettings !== false,
    injectCharacterPrompt: value.injectCharacterPrompt !== false,
    injectScenePrompt: value.injectScenePrompt !== false,
    injectPropPrompt: value.injectPropPrompt !== false,
    ...value
  }), [value]);

  function patch(next) {
    onChange?.(next);
  }

  return <div className="bf11-constraints">
    <div className="bf11-constraints-summary">
      <Space>
        <Layers3 size={17} />
        <div>
          <Typography.Text strong>约束设置</Typography.Text>
          <Typography.Text type="secondary">{scopeLabel}</Typography.Text>
        </div>
      </Space>
      <Tag color="purple">打开开关后直接编辑</Tag>
    </div>

    <div className="bf11-constraint-simple-group">
      <ToggleRow
        label="基础设定（人物 / 场景）"
        description="根据当前 VIDEO 实际引用关系注入人物与场景基础设定。"
        checked={normalized.injectBaseSettings === true}
        inherited={inherited}
        onChange={checked => patch({ injectBaseSettings: checked })}
      />
      <ToggleRow
        label="人物 Prompt 注入"
        description="只注入当前 VIDEO 实际引用的人物 Prompt。"
        checked={normalized.injectCharacterPrompt === true}
        inherited={inherited}
        onChange={checked => patch({ injectCharacterPrompt: checked })}
      />
      <ToggleRow
        label="场景 Prompt 注入"
        description="只注入当前 VIDEO 实际引用的场景 Prompt。"
        checked={normalized.injectScenePrompt === true}
        inherited={inherited}
        onChange={checked => patch({ injectScenePrompt: checked })}
      />
      <ToggleRow
        label="道具 Prompt 注入"
        description="只注入当前 VIDEO 实际引用的道具 Prompt。"
        checked={normalized.injectPropPrompt === true}
        inherited={inherited}
        onChange={checked => patch({ injectPropPrompt: checked })}
      />
    </div>

    {TEXT_CONSTRAINTS.map(definition => <TextConstraintBlock
      key={definition.key}
      definition={definition}
      value={normalized}
      inherited={inherited}
      onChange={patch}
      scope={scope}
      onSaveDraft={onSaveDraft}
      onSavePersonalPrompt={onSavePersonalPrompt}
    />)}
  </div>;
}

export default BatchFactoryV11ConstraintEditor;
