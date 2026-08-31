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
import { useEffect, useMemo, useState } from 'react';
import { BatchFactoryV11ConstraintEditor } from './BatchFactoryV11ConstraintEditor';
import { SHOWCASE_BATCH_SETTINGS } from './showcaseData';
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
  batchSettings = SHOWCASE_BATCH_SETTINGS,
  initialPatch = {},
  onClose,
  onSave
}) {
  const [patch, setPatch] = useState(initialPatch);

  useEffect(() => {
    if (!open) return;
    setPatch({ ...initialPatch });
  }, [open, book?.id]);

  const displayValue = useMemo(() => ({ ...batchSettings, ...patch }), [batchSettings, patch]);
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

  function save() {
    onSave?.(patch);
    onClose?.();
  }

  return <Modal
    title={<Space><Settings2 size={18} /><span>当前小说设置</span></Space>}
    width={760}
    open={open}
    onCancel={onClose}
    destroyOnClose={false}
    footer={<Space>
      <Button icon={<RotateCcw size={14} />} onClick={() => setPatch({})}>恢复全部继承</Button>
      <Button type="primary" icon={<Save size={14} />} onClick={save}>保存当前小说设置</Button>
    </Space>}
  >
    <div className="bf11-scoped-settings">
      <InheritanceHeader level={book?.title || '当前小说'} parentLabel="继承批次" count={count} />
      <Typography.Text type="secondary">Book ID {book?.bookId || '—'} · 当前小说只保存自己修改的字段，不复制整套生产统一设置。</Typography.Text>

      <Divider orientation="left">配置版本</Divider>
      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>版本配置</Typography.Text><Typography.Text type="secondary">默认跟随当前批次冻结版本。</Typography.Text></div>
        <Select
          value={hasOwn(patch, 'configVersion') ? patch.configVersion : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('configVersion') : setField('configVersion', value)}
          options={[
            { value: 'inherit', label: `跟随批次 · ${batchSettings.configVersion || '当前版本'}` },
            { value: 'v3.5', label: '批量配置 V3.5' },
            { value: 'v3.2', label: '批量配置 V3.2' },
            { value: 'v3.1', label: '批量配置 V3.1' }
          ]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>视频画幅</Typography.Text><Typography.Text type="secondary">当前小说可覆盖批次默认画幅。</Typography.Text></div>
        <SparseChoice
          inheritedLabel={`跟随 ${batchSettings.aspectRatio || '9:16'}`}
          value={hasOwn(patch, 'aspectRatio') ? patch.aspectRatio : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('aspectRatio') : setField('aspectRatio', value)}
          options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>固定单 VIDEO</Typography.Text><Typography.Text type="secondary">通常跟随批次；特殊小说可以单独覆盖。</Typography.Text></div>
        <SparseChoice
          inheritedLabel="跟随批次"
          value={!hasOwn(patch, 'fixedSingleVideo') ? 'inherit' : (patch.fixedSingleVideo ? 'on' : 'off')}
          onChange={value => value === 'inherit' ? inheritField('fixedSingleVideo') : setField('fixedSingleVideo', value === 'on')}
          options={[{ value: 'on', label: '开启' }, { value: 'off', label: '关闭' }]}
        />
      </div>

      <Divider orientation="left">约束设置</Divider>
      <BatchFactoryV11ConstraintEditor
        value={displayValue}
        onChange={applyConstraint}
        inherited={count === 0}
        scopeLabel={`当前小说 · ${book?.title || '未选择'}`}
      />

      <Alert
        type="info"
        showIcon
        message="继承关系"
        description="系统默认 → 生产统一设置 → 当前小说 → 单 VIDEO。点击“恢复全部继承”会删除当前小说 sparse override，而不是复制父级当前值。"
      />
    </div>
  </Modal>;
}

export function VideoSettingsDrawer({
  open,
  book,
  video,
  parentSettings = SHOWCASE_BATCH_SETTINGS,
  modelMaxDuration = 15,
  initialPatch = {},
  onClose,
  onSave
}) {
  const [patch, setPatch] = useState(initialPatch);
  const [durationMode, setDurationMode] = useState('inherit');

  useEffect(() => {
    if (!open) return;
    setPatch({ ...initialPatch });
    setDurationMode(hasOwn(initialPatch, 'duration') ? 'custom' : 'inherit');
  }, [open, video?.id]);

  const displayValue = useMemo(() => ({ ...parentSettings, ...patch }), [parentSettings, patch]);
  const count = sparseCount(patch);
  const maxDuration = Math.max(1, Number(modelMaxDuration || 1));
  const customDuration = Number(patch.duration || video?.duration || 0);
  const durationChanged = hasOwn(patch, 'duration') && Number(patch.duration) !== Number(video?.duration || 0);
  const durationIncompatible = hasOwn(patch, 'duration') && customDuration > maxDuration;

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
    else if (!hasOwn(patch, 'duration')) setField('duration', Number(video?.duration || Math.min(10, maxDuration)));
  }

  function save() {
    onSave?.(patch);
    onClose?.();
  }

  const assetOptions = {
    characters: (book?.assets?.characters || []).map(name => ({ label: name, value: name })),
    scenes: (book?.assets?.scenes || []).map(name => ({ label: name, value: name })),
    props: (book?.assets?.props || []).map(name => ({ label: name, value: name }))
  };

  return <Drawer
    title={<Space><Video size={18} /><span>单 VIDEO 设置</span></Space>}
    width={720}
    open={open}
    onClose={onClose}
    destroyOnClose={false}
    extra={<Button type="primary" icon={<Save size={14} />} onClick={save}>保存 VIDEO 设置</Button>}
  >
    <div className="bf11-scoped-settings">
      <InheritanceHeader level={`${book?.title || '当前小说'} · ${video?.label || 'VIDEO'}`} parentLabel="继承当前小说 / 批次" count={count} />
      <Typography.Text type="secondary">VIDEO ID {video?.id || '—'} · VIDEO 是最高覆盖层，未修改字段继续跟随上层。</Typography.Text>

      <Divider orientation="left">VIDEO 基础覆盖</Divider>
      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>VIDEO 时长</Typography.Text><Typography.Text type="secondary">修改时长需要重新导演 / 重排 Shot 时间轴，不能只替换数字。当前模型上限 {maxDuration}s。</Typography.Text></div>
        <Space direction="vertical" align="end">
          <Segmented
            value={durationMode}
            onChange={setDurationChoice}
            options={[{ value: 'inherit', label: `跟随当前 ${video?.duration || 0}s` }, { value: 'custom', label: '单独设置' }]}
          />
          {durationMode === 'custom' ? <InputNumber
            min={1}
            max={maxDuration}
            value={customDuration}
            onChange={value => setField('duration', Number(value || 1))}
            addonAfter="秒"
          /> : null}
        </Space>
      </div>

      {(durationChanged || durationIncompatible) ? <Alert
        type={durationIncompatible ? 'error' : 'warning'}
        showIcon
        message={durationIncompatible ? `当前设置超过模型最大 ${maxDuration}s` : '时长修改后需要重新导演'}
        description={durationIncompatible
          ? '不能把旧 VIDEO 方案直接提交给能力不足的模型。请降低时长或重新选择兼容模型并重新导演。'
          : '第二阶段接入后，保存时长变化会标记当前 VIDEO Director revision 失效，并要求重新导演 / 重排 Shot 时间轴。'}
      /> : null}

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>视频画幅</Typography.Text><Typography.Text type="secondary">单段可覆盖当前小说 / 批次画幅。</Typography.Text></div>
        <SparseChoice
          inheritedLabel="跟随上层"
          value={hasOwn(patch, 'aspectRatio') ? patch.aspectRatio : 'inherit'}
          onChange={value => value === 'inherit' ? inheritField('aspectRatio') : setField('aspectRatio', value)}
          options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]}
        />
      </div>

      <div className="bf11-scoped-setting-row">
        <div><Typography.Text strong>字幕规则</Typography.Text><Typography.Text type="secondary">默认继承上层字幕策略。</Typography.Text></div>
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
        <div><Typography.Text strong>负面提示词处理</Typography.Text><Typography.Text type="secondary">单 VIDEO 默认在上层负面词基础上追加，也可完全替换。</Typography.Text></div>
        <Segmented
          value={patch.negativeMergeMode || 'append'}
          onChange={negativeMergeMode => setField('negativeMergeMode', negativeMergeMode)}
          options={[{ value: 'append', label: '追加' }, { value: 'replace', label: '完全替换' }]}
        />
      </div>

      <Divider orientation="left">当前 VIDEO 使用资产</Divider>
      <div className="bf11-video-assets-editor">
        <div><Typography.Text strong>人物</Typography.Text><Checkbox.Group options={assetOptions.characters} value={patch.characterRefs || video?.characters || []} onChange={characterRefs => setField('characterRefs', characterRefs)} /></div>
        <div><Typography.Text strong>场景</Typography.Text><Checkbox.Group options={assetOptions.scenes} value={patch.sceneRefs || video?.scenes || []} onChange={sceneRefs => setField('sceneRefs', sceneRefs)} /></div>
        <div><Typography.Text strong>道具</Typography.Text><Checkbox.Group options={assetOptions.props} value={patch.propRefs || video?.props || []} onChange={propRefs => setField('propRefs', propRefs)} /></div>
      </div>

      <Divider orientation="left">约束设置</Divider>
      <BatchFactoryV11ConstraintEditor
        value={displayValue}
        onChange={applyConstraint}
        inherited={count === 0}
        scopeLabel={`${video?.label || '当前 VIDEO'} · 最高覆盖层`}
      />

      <Space className="bf11-scoped-footer" wrap>
        <Button icon={<RotateCcw size={14} />} onClick={() => { setPatch({}); setDurationMode('inherit'); }}>恢复全部继承</Button>
        <Tag color="purple">当前层已覆盖 {count} 项</Tag>
        <Typography.Text type="secondary">恢复继承只删除 VIDEO override，不修改上层设置。</Typography.Text>
      </Space>
    </div>
  </Drawer>;
}

export default BookSettingsModal;
