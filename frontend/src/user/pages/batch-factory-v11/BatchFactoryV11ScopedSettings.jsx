import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography
} from 'antd';
import { RotateCcw, Save, Settings2, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BatchFactoryV11ConstraintEditor } from './BatchFactoryV11ConstraintEditor';
import { HelpButton } from './helpContent.jsx';
import { runSaveFlow } from './saveFlow.js';
import './batch-factory-v11-settings.css';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function withoutKey(source, key) {
  const next = { ...(source || {}) };
  delete next[key];
  return next;
}

function sparseCount(value) {
  return Object.keys(value || {}).length;
}

function InheritanceHeader({ level, parentLabel, count }) {
  return <div className="bf11-inheritance-header">
    <div>
      <Typography.Text strong>{level}</Typography.Text>
      <Typography.Text type="secondary">未覆盖字段自动{parentLabel}</Typography.Text>
    </div>
    <Space wrap>
      <Tag>继承{parentLabel.replace('继承', '')}</Tag>
      {count > 0 ? <Tag color="purple">当前层已覆盖 {count} 项</Tag> : <Tag color="green">当前层无覆盖</Tag>}
    </Space>
  </div>;
}

function SparseChoice({ value, inheritedLabel, options, onChange }) {
  return <Segmented
    value={value}
    onChange={onChange}
    options={[{ value: 'inherit', label: inheritedLabel }, ...options]}
  />;
}

export function BookSettingsModal({
  open,
  book,
  initialPatch = {},
  onClose,
  onSave
}) {
  const [patch, setPatch] = useState(initialPatch);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPatch({ ...initialPatch });
  }, [open, book?.id, initialPatch]);

  const count = sparseCount(patch);

  function setField(key, value) {
    setPatch(current => ({ ...current, [key]: value }));
  }

  function inheritField(key) {
    setPatch(current => withoutKey(current, key));
  }

  function applyConstraint(next) {
    setPatch(current => ({ ...current, ...next }));
  }

  async function save() {
    setSaving(true);
    try {
      return await runSaveFlow({ payload: patch, onSave, onClose });
    } finally {
      setSaving(false);
    }
  }

  return <Modal
    title={<Space><Settings2 size={18} /><span>当前小说设置</span><HelpButton topic="settings" /></Space>}
    width={760}
    open={open}
    onCancel={onClose}
    destroyOnClose={false}
    footer={<Space>
      <Button icon={<RotateCcw size={14} />} onClick={() => setPatch({})}>恢复全部继承</Button>
      <Button type="primary" loading={saving} icon={<Save size={14} />} onClick={save}>保存当前小说设置</Button>
    </Space>}
  >
    <div className="bf11-scoped-settings">
      <InheritanceHeader level={book?.title || '当前小说'} parentLabel="继承批次" count={count} />
      <Typography.Text type="secondary">小说 ID {book?.bookId || '—'} · 当前小说只保存自己修改的字段；配置版本由生产统一设置选择，继承后的实际值以服务端设置状态为准。</Typography.Text>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>内容幅度</Typography.Text><Typography.Text type="secondary">当前小说单独控制原文和 AI 分析使用的逻辑行数，默认跟随批次 5 行。</Typography.Text></div>
        <Space>
          <InputNumber min={1} max={10000} value={hasOwn(patch, 'contentLineLimit') ? Number(patch.contentLineLimit) : undefined} placeholder="跟随批次" onChange={value => value == null ? inheritField('contentLineLimit') : setField('contentLineLimit', Number(value))} addonAfter="行" />
          {hasOwn(patch, 'contentLineLimit') ? <Button size="small" onClick={() => inheritField('contentLineLimit')}>跟随批次</Button> : null}
        </Space>
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>视频画幅</Typography.Text><Typography.Text type="secondary">当前小说可写自己的 sparse override。</Typography.Text></div>
        <SparseChoice
          inheritedLabel="跟随批次"
          value={hasOwn(patch, 'aspectRatio') ? patch.aspectRatio : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('aspectRatio') : setField('aspectRatio', value)}
          options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>固定单个视频</Typography.Text><Typography.Text type="secondary">未覆盖时继续交给服务端解析上层设置。</Typography.Text></div>
        <SparseChoice
          inheritedLabel="跟随批次"
          value={!hasOwn(patch, 'fixedSingleVideo') ? 'inherit' : (patch.fixedSingleVideo ? 'on' : 'off')}
          onChange={value => value === 'inherit' ? inheritField('fixedSingleVideo') : setField('fixedSingleVideo', value === 'on')}
          options={[{ value: 'on', label: '开启' }, { value: 'off', label: '关闭' }]}
        />
      </div>

      <Divider orientation="left">约束设置</Divider>
      <BatchFactoryV11ConstraintEditor
        value={patch}
        onChange={applyConstraint}
        inherited={count === 0}
        scopeLabel={`当前小说 · ${book?.title || '未选择'}`}
      />

      <Alert
        type="info"
        showIcon
        message="继承关系"
        description="系统默认 → 生产统一设置 → 当前小说 → 单个视频。页面只编辑当前层局部覆盖，不在浏览器合并实际设置。"
      />
    </div>
  </Modal>;
}

export function VideoSettingsDrawer({
  open,
  book,
  video,
  modelMaxDuration = 0,
  initialPatch = {},
  onClose,
  onSave
}) {
  const [patch, setPatch] = useState(initialPatch);
  const [durationMode, setDurationMode] = useState('inherit');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPatch({ ...initialPatch });
    setDurationMode(hasOwn(initialPatch, 'duration') ? 'custom' : 'inherit');
  }, [open, video?.id, initialPatch]);

  const count = sparseCount(patch);
  const maxDuration = Number(modelMaxDuration || 0);
  const customDuration = hasOwn(patch, 'duration') ? Number(patch.duration) : undefined;
  const durationIncompatible = maxDuration > 0 && hasOwn(patch, 'duration') && Number(patch.duration) > maxDuration;

  function setField(key, value) {
    setPatch(current => ({ ...current, [key]: value }));
  }

  function inheritField(key) {
    setPatch(current => withoutKey(current, key));
  }

  function applyConstraint(next) {
    setPatch(current => ({ ...current, ...next }));
  }

  function setDurationChoice(value) {
    setDurationMode(value);
    if (value === 'inherit') inheritField('duration');
  }

  async function save() {
    setSaving(true);
    try {
      return await runSaveFlow({ payload: patch, onSave, onClose });
    } finally {
      setSaving(false);
    }
  }

  const assetOptions = {
    characters: (book?.assets?.characters || []).map(name => ({ label: name, value: name })),
    scenes: (book?.assets?.scenes || []).map(name => ({ label: name, value: name })),
    props: (book?.assets?.props || []).map(name => ({ label: name, value: name }))
  };

  return <Drawer
    title={<Space><Video size={18} /><span>单个视频设置</span></Space>}
    width={720}
    open={open}
    onClose={onClose}
    destroyOnClose={false}
    extra={<Button type="primary" loading={saving} icon={<Save size={14} />} onClick={save}>保存视频设置</Button>}
  >
    <div className="bf11-scoped-settings">
      <InheritanceHeader level={`${book?.title || '当前小说'} · ${video?.label || '当前视频'}`} parentLabel="继承当前小说 / 批次" count={count} />
      <Typography.Text type="secondary">视频 ID {video?.id || '—'} · 当前层只保存自己的局部覆盖；实际设置由服务端返回。</Typography.Text>

      <Divider orientation="left">视频基础覆盖</Divider>
      <div className="bf11-scoped-setting-row">
        <div>
          <Typography.Text strong>视频时长</Typography.Text>
          <Typography.Text type="secondary">时长覆盖写入当前视频设置；编排结果是否失效以服务端变更影响为准。{maxDuration > 0 ? `当前模型上限 ${maxDuration}s。` : '模型上限等待服务端能力数据。'}</Typography.Text>
        </div>
        <Space direction="vertical" align="end">
          <Segmented
            value={durationMode}
            onChange={setDurationChoice}
            options={[{ value: 'inherit', label: video?.duration ? `跟随当前 ${video.duration}s` : '跟随当前视频' }, { value: 'custom', label: '单独设置' }]}
          />
          {durationMode === 'custom' ? <InputNumber
            min={1}
            max={maxDuration > 0 ? maxDuration : undefined}
            value={customDuration}
            placeholder="输入秒数"
            onChange={value => value == null ? inheritField('duration') : setField('duration', Number(value))}
            addonAfter="秒"
          /> : null}
        </Space>
      </div>

      {durationIncompatible ? <Alert
        type="error"
        showIcon
        message={`当前设置超过模型最大 ${maxDuration}s`}
        description="当前模型能力上限来自服务端；请降低当前视频的显式时长覆盖。"
      /> : null}

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>视频画幅</Typography.Text><Typography.Text type="secondary">单段可写自己的 sparse override。</Typography.Text></div>
        <SparseChoice
          inheritedLabel="跟随上层"
          value={hasOwn(patch, 'aspectRatio') ? patch.aspectRatio : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('aspectRatio') : setField('aspectRatio', value)}
          options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>字幕规则</Typography.Text><Typography.Text type="secondary">未覆盖时交给服务端解析上层策略。</Typography.Text></div>
        <Select
          value={hasOwn(patch, 'subtitlePolicy') ? patch.subtitlePolicy : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('subtitlePolicy') : setField('subtitlePolicy', value)}
          options={[
            { value: 'inherit', label: '跟随上层' },
            { value: 'forbid-auto-dialogue-subtitle', label: '禁止自动对白字幕' },
            { value: 'allow', label: '允许自动字幕' }
          ]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>负面提示词处理</Typography.Text><Typography.Text type="secondary">只有操作后才写入当前视频设置。</Typography.Text></div>
        <Segmented
          value={patch.negativeMergeMode || 'append'}
          onChange={negativeMergeMode => setField('negativeMergeMode', negativeMergeMode)}
          options={[{ value: 'append', label: '追加' }, { value: 'replace', label: '完全替换' }]}
        />
      </div>

      <Divider orientation="left">当前视频使用资产</Divider>
      <div className="bf11-video-assets-editor">
        <div><Typography.Text strong>人物</Typography.Text><Checkbox.Group options={assetOptions.characters} value={patch.characterRefs || video?.characters || []} onChange={characterRefs => setField('characterRefs', characterRefs)} /></div>
        <div><Typography.Text strong>场景</Typography.Text><Checkbox.Group options={assetOptions.scenes} value={patch.sceneRefs || video?.scenes || []} onChange={sceneRefs => setField('sceneRefs', sceneRefs)} /></div>
        <div><Typography.Text strong>道具</Typography.Text><Checkbox.Group options={assetOptions.props} value={patch.propRefs || video?.props || []} onChange={propRefs => setField('propRefs', propRefs)} /></div>
      </div>

      <Divider orientation="left">约束设置</Divider>
      <BatchFactoryV11ConstraintEditor
        value={patch}
        onChange={applyConstraint}
        inherited={count === 0}
        scopeLabel={`${video?.label || '当前视频'} · 最高覆盖层`}
      />

      <Space className="bf11-scoped-footer" wrap>
        <Button icon={<RotateCcw size={14} />} onClick={() => { setPatch({}); setDurationMode('inherit'); }}>恢复全部继承</Button>
        <Tag color="purple">当前层已覆盖 {count} 项</Tag>
        <Typography.Text type="secondary">保存空 patch 即恢复全部继承；不会修改上层设置。</Typography.Text>
      </Space>
    </div>
  </Drawer>;
}

export default BookSettingsModal;
