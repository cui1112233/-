import { Button, Form, Input, Modal, Popconfirm, Select, Segmented, Space, Switch, Typography, message } from 'antd';
import { AudioLines, Copy, Download, FileText, Pencil, Plus, RefreshCw, Settings2, Star, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteScriptConstraintPrompt, extractCharactersAndScenes, generateScript, getConstraintPresetTexts, listScriptConstraintPrompts, listScriptPresetCatalog, saveScriptConstraintPrompt, updateScriptConstraintPrompt } from '../../shared/api/generation';
import { saveHistory } from '../../shared/api/history';
import { getConfig } from '../../shared/api/config';
import { playTaskSound } from '../../shared/notifications/taskSound';
import { textToSpeech } from '../../shared/api/tts';
import { getCurrentUsername } from '../../shared/api/auth';
import { PET_APPLY_EVENT, PET_PREVIEW_EVENT, dispatchPetContext, dispatchPetState } from '../../shared/pet/stacky';
import { getScriptDraftTabId, loadScriptDraft, saveScriptDraft } from './scriptDraftStorage';
import { DEFAULT_SCRIPT_CONSTRAINTS, constraintsForFormat, normalizeScriptConstraints } from './scriptConstraints';
import { filterExtractionPresets, selectAvailableExtractionPreset } from './scriptExtractionPresets';
import { createEntity, entityData, normalizeExtractInfo, toGenerationEntities } from './scriptEntities';
import { applyEntityEnrichment, compactEntitySummary, entityName, normalizeEntityEnrichment } from './scriptEntityEnrichment';
import { getShotCards, joinShotCards, splitContinuousTimeline } from './scriptShotOutput';
import { getSelectedShotMatches, getShotCardStarts, replaceAllSelectedShotMatches, replaceSelectedShotMatch } from './scriptShotReplace';
import { ShotOutputCards } from '../components/ShotOutputCards';
import { createScriptVideo } from '../../shared/api/scriptVideo';

function extractJSON(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return JSON.parse(match[1].trim());
    throw error;
  }
}

function aiText(response) {
  if (typeof response === 'string') return response;
  const candidates = [response, response?.data, response?.result, response?.response];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.output_text === 'string') return candidate.output_text;
    if (candidate.人物设定 || candidate.人物 || candidate.角色设定 || candidate.characters) return candidate;

    const content = candidate?.choices?.[0]?.message?.content
      ?? candidate?.choices?.[0]?.delta?.content
      ?? candidate?.message?.content
      ?? candidate?.content;

    if (typeof content === 'string' || (content && typeof content === 'object' && !Array.isArray(content))) return content;
    if (Array.isArray(content)) {
      return content
        .map(item => typeof item === 'string' ? item : item?.text || item?.content || '')
        .join('');
    }
  }

  return '';
}

function normalizeExtraction(data) {
  const asList = value => Array.isArray(value) ? value : value ? [value] : [];
  const source = data?.data || data?.result || data || {};
  return normalizeExtractInfo({
    characters: asList(source.人物设定 || source.人物 || source.角色设定 || source.characters),
    scenes: asList(source.场景设定 || source.场景 || source.scene_options || source.scenes)
  });
}

function formatEntity(item) {
  const value = entityData(item);
  if (typeof value === 'string') return value;
  return value?.角色名称 || value?.场景名称 || value?.名称 || value?.name || value?.场景 || value?.scene || '未命名对象';
}

function visualFields(item) {
  const value = entityData(item);
  if (typeof value === 'string') return [{ key: '描述', label: '设定 / 描述', value }];
  const labels = { name: '名称', 名称: '名称', 人物: '名称', 场景: '名称', scene: '名称', 角色名称: '名称', 场景名称: '名称', identity: '身份', 身份: '身份', appearance: '外形', 外形: '外形', 外观描述: '外形', personality: '性格', 性格: '性格', relation: '关系', 关系: '关系', time: '时段', 时段: '时段', atmosphere: '氛围', 氛围: '氛围', 氛围概述: '氛围', description: '设定 / 描述', 描述: '设定 / 描述', 场景描述: '设定 / 描述' };
  return Object.entries(value || {}).map(([key, fieldValue]) => ({ key, label: labels[key] || key, value: typeof fieldValue === 'string' ? fieldValue : JSON.stringify(fieldValue) }));
}

export function ScriptPage() {
  const [form] = Form.useForm();
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(60);
  const [regeneratingEntities, setRegeneratingEntities] = useState(false);
  const [regeneratingOutput, setRegeneratingOutput] = useState(false);
  const [generationStage, setGenerationStage] = useState('idle');
  const [extractInfo, setExtractInfo] = useState(() => normalizeExtractInfo());
  const [output, setOutput] = useState('');
  const [revisionPreview, setRevisionPreview] = useState({ open: false, summary: '', currentOutput: '', candidateOutput: '' });
  const [previousOutput, setPreviousOutput] = useState('');
  const [editingOutput, setEditingOutput] = useState(false);
  const [selectedShotIndexes, setSelectedShotIndexes] = useState(new Set());
  const [generatingShotIndexes, setGeneratingShotIndexes] = useState(() => new Set());
  const [shotReplaceOpen, setShotReplaceOpen] = useState(false);
  const [shotFindText, setShotFindText] = useState('');
  const [shotReplaceText, setShotReplaceText] = useState('');
  const [shotMatchIndex, setShotMatchIndex] = useState(0);
  const [activeEntity, setActiveEntity] = useState(null);
  const [fullscreenEditor, setFullscreenEditor] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(null);
  const [narrating, setNarrating] = useState(false);
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [instructionModalOpen, setInstructionModalOpen] = useState(false);
  const [pendingExtractionPreset, setPendingExtractionPreset] = useState('standard');
  const [constraintModalOpen, setConstraintModalOpen] = useState(false);
  const [constraints, setConstraints] = useState(DEFAULT_SCRIPT_CONSTRAINTS);
  const [draftConstraints, setDraftConstraints] = useState(DEFAULT_SCRIPT_CONSTRAINTS);
  const [constraintCatalog, setConstraintCatalog] = useState([]);
  const [constraintTexts, setConstraintTexts] = useState({});
  const [personalConstraintPrompts, setPersonalConstraintPrompts] = useState({});
  const [loadingPersonalConstraintPrompts, setLoadingPersonalConstraintPrompts] = useState({});
  const [savingConstraintCategory, setSavingConstraintCategory] = useState('');
  const [editingPersonalPromptId, setEditingPersonalPromptId] = useState('');
  const [editingPersonalPromptName, setEditingPersonalPromptName] = useState('');
  const [personalPromptNameModal, setPersonalPromptNameModal] = useState({ open: false, category: '', name: '' });
  const [extractionPresets, setExtractionPresets] = useState([]);
  const [loadingExtractionPresets, setLoadingExtractionPresets] = useState(true);
  const [extractionPresetError, setExtractionPresetError] = useState('');
  const selectedFormat = Form.useWatch('format', form);
  const selectedMode = Form.useWatch('mode', form);
  const selectedDuration = Form.useWatch('duration', form);
  const novelText = Form.useWatch('novelText', form) || '';
  useEffect(() => { setSelectedShotIndexes(new Set()); }, [selectedFormat]);
  const shotCards = useMemo(() => {
    const parsed = getShotCards(selectedFormat, output);
    if (parsed.length) return parsed;
    // 分段开头：模型输出的是连续时间轴（无 ### 分镜标题），按所选秒数自动切段显示为卡片
    if (selectedMode === 'segmented' && selectedFormat !== 'shortdrama' && output) {
      const seconds = selectedDuration === '15s' ? 15 : 10;
      const segments = splitContinuousTimeline(output, seconds);
      if (segments.length >= 2) return segments;
    }
    return parsed;
  }, [selectedMode, selectedFormat, selectedDuration, output]);
  const shotCardStarts = useMemo(() => getShotCardStarts(output, shotCards), [output, shotCards]);
  const selectedShotMatches = useMemo(
    () => getSelectedShotMatches(output, shotCards, selectedShotIndexes, shotFindText),
    [output, shotCards, selectedShotIndexes, shotFindText]
  );
  const activeShotMatch = selectedShotMatches[shotMatchIndex] || null;
  useEffect(() => {
    setShotMatchIndex(index => selectedShotMatches.length ? Math.min(index, selectedShotMatches.length - 1) : 0);
  }, [selectedShotMatches.length]);
  const isShotCardView = shotCards.length > 0 && !editingOutput;
  const workbenchRef = useRef(null);
  const draftReadyRef = useRef(false);
  const draftUsernameRef = useRef(getCurrentUsername());
  const draftTabIdRef = useRef(getScriptDraftTabId(window.sessionStorage));
  const requestGenerationRef = useRef({ workflow: 0, narrate: 0 });
  const sourceGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const sourceAudioUrlRef = useRef('');

  function beginRequest(kind) {
    return {
      kind,
      requestId: ++requestGenerationRef.current[kind],
      sourceGeneration: sourceGenerationRef.current
    };
  }

  function isCurrentRequest(request) {
    return mountedRef.current
      && requestGenerationRef.current[request.kind] === request.requestId
      && sourceGenerationRef.current === request.sourceGeneration;
  }

  function invalidateRequests() {
    sourceGenerationRef.current += 1;
  }

  function clearNovelText() {
    form.setFieldValue('novelText', '');
    persistDraft({ ...form.getFieldsValue(), novelText: '' });
  }

  function replaceSourceAudio(nextUrl) {
    if (sourceAudioUrlRef.current) URL.revokeObjectURL(sourceAudioUrlRef.current);
    sourceAudioUrlRef.current = nextUrl;
    setSourceAudioUrl(nextUrl);
  }

  function snapshotDraft(values = form.getFieldsValue()) {
    return {
      values: {
        mode: values.mode || 'continuous',
        format: values.format || 'storyboard',
        duration: values.duration || '10s',
        novelText: values.novelText || '',
        extractionPreset: values.extractionPreset || 'standard'
      },
      constraints: normalizeScriptConstraints(constraints),
      extractInfo,
      output,
      editingOutput,
      generationStage: generationStage === 'extracting' || generationStage === 'generating' ? 'idle' : generationStage
    };
  }

  function persistDraft(values, overrides = {}) {
    if (!draftReadyRef.current) return;
    saveScriptDraft(window.localStorage, draftUsernameRef.current, draftTabIdRef.current, {
      ...snapshotDraft(values),
      ...overrides
    });
  }

  function updateOutputDraft(nextOutput, preserveSelectedShots = false) {
    setOutput(nextOutput);
    if (!preserveSelectedShots) setSelectedShotIndexes(new Set());
    else {
      const nextCards = getShotCards(selectedFormat, nextOutput);
      setSelectedShotIndexes(current => new Set([...current].filter(index => index < nextCards.length)));
    }
    persistDraft(undefined, { output: nextOutput });
  }

  function replaceCurrentShotMatch() {
    if (!activeShotMatch) return;
    const nextOutput = replaceSelectedShotMatch(output, activeShotMatch, shotReplaceText);
    updateOutputDraft(nextOutput, true);
  }

  function replaceAllShotMatches() {
    if (!selectedShotMatches.length) return;
    const nextOutput = replaceAllSelectedShotMatches(output, selectedShotMatches, shotReplaceText);
    updateOutputDraft(nextOutput, true);
  }

  async function copyText(text) {
    if (!text) return message.warning('没有可复制的内容');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('copy failed');
      }
      message.success('已复制');
    } catch {
      message.error('复制失败，请检查浏览器权限');
    }
  }

  async function generateVideoForShot(card, index) {
    const prompt = String(card || '').trim();
    if (!prompt) return message.warning('该分镜没有可生成的视频提示词');
    setGeneratingShotIndexes(current => new Set([...current, index]));
    try {
      const result = await createScriptVideo({ prompt });
      message.success(`已提交第 ${index + 1} 条分镜的视频任务（任务 ID：${result.taskId}）`);
    } catch (error) {
      message.error(error.message || '视频任务提交失败');
    } finally {
      setGeneratingShotIndexes(current => {
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    }
  }

  useEffect(() => {
    const restoredDraft = loadScriptDraft(window.localStorage, draftUsernameRef.current, draftTabIdRef.current);
    if (restoredDraft) {
      form.setFieldsValue(restoredDraft.values);
      setExtractInfo(normalizeExtractInfo(restoredDraft.extractInfo));
      setOutput(typeof restoredDraft.output === 'string' ? restoredDraft.output : '');
      setEditingOutput(Boolean(restoredDraft.editingOutput));
      setGenerationStage(restoredDraft.generationStage || 'idle');
      setConstraints(normalizeScriptConstraints(restoredDraft.constraints));
      setDraftConstraints(normalizeScriptConstraints(restoredDraft.constraints));
    }

    // Wait for restored React state to commit before allowing auto-save.
    const readyTimer = window.setTimeout(() => {
      draftReadyRef.current = true;
      if (restoredDraft) {
        saveScriptDraft(window.localStorage, draftUsernameRef.current, draftTabIdRef.current, restoredDraft);
      } else {
        persistDraft();
      }
    }, 0);

    return () => {
      window.clearTimeout(readyTimer);
      draftReadyRef.current = false;
    };
  }, [form]);

  useEffect(() => {
    if (!draftReadyRef.current) return;
    persistDraft();
  }, [extractInfo, output, editingOutput, generationStage, constraints]);

  useEffect(() => {
    let active = true;
    getConfig()
      .then(config => {
        if (!active) return;
        setSoundEnabled(config.notifications?.soundEnabled !== false);
        setSoundVolume(Number.isFinite(config.notifications?.soundVolume) ? config.notifications.soundVolume : 60);
      })
      .catch(() => {});
    const handleNotificationsUpdated = event => {
      setSoundEnabled(event.detail?.soundEnabled !== false);
      setSoundVolume(Number.isFinite(event.detail?.soundVolume) ? event.detail.soundVolume : 60);
    };
    window.addEventListener('qiantie:notifications-updated', handleNotificationsUpdated);
    return () => {
      active = false;
      window.removeEventListener('qiantie:notifications-updated', handleNotificationsUpdated);
    };
  }, []);

  useEffect(() => {
    let active = true;
    listScriptPresetCatalog()
      .then(result => {
        if (!active) return;
        const catalog = Array.isArray(result?.catalog) ? result.catalog : [];
        setConstraintCatalog(catalog);
        const presets = filterExtractionPresets(catalog);
        setExtractionPresets(presets);
        const selected = selectAvailableExtractionPreset(form.getFieldValue('extractionPreset'), presets);
        if (selected) form.setFieldValue('extractionPreset', selected);
        setExtractionPresetError(selected ? '' : '暂无已发布的提取指令');
      })
      .catch(() => {
        if (!active) return;
        setConstraintCatalog([]);
        setExtractionPresets([]);
        setExtractionPresetError('提取指令加载失败，请刷新或联系管理员');
        message.warning('系统预设加载失败。');
      })
      .finally(() => { if (active) setLoadingExtractionPresets(false); });
    return () => { active = false; };
  }, [form]);

  useEffect(() => {
    const saveBeforeLeave = () => persistDraft();
    window.addEventListener('pagehide', saveBeforeLeave);
    return () => window.removeEventListener('pagehide', saveBeforeLeave);
  }, [extractInfo, output, editingOutput, generationStage]);

  function syncPetContext(novelText = form.getFieldValue('novelText')) {
    const characterCount = extractInfo.characters.length;
    const sceneCount = extractInfo.scenes.length;
    const stageLabel = {
      idle: '等待提取人物与场景',
      extracting: '正在提取人物与场景',
      extracted: '已提取，等待确认后生成剧本',
      generating: '正在生成剧本',
      complete: '剧本已生成',
      error: '上一次处理失败'
    }[generationStage] || '等待处理';
    dispatchPetContext({
      page: '剧本生成',
      pagePath: '/script',
      summary: `当前阶段：${stageLabel}；人物 ${characterCount} 个；场景 ${sceneCount} 个；剧本结果：${output.trim() ? '已生成' : '未生成'}`,
      entities: {
        characterCount,
        sceneCount,
        generationStage,
        hasOutput: Boolean(output.trim())
      },
      actions: generationStage === 'extracted'
        ? ['检查人物与场景', '编辑人物与场景', '生成剧本']
        : ['提取人物与场景', '检查当前剧本', '生成剧本'],
      novelText: String(novelText || ''),
      extracted: extractInfo,
      scriptOutput: output
    });
  }

  useEffect(() => {
    syncPetContext();
  }, [extractInfo, output, generationStage]);

  useEffect(() => {
    function openRevisionPreview(event) {
      const candidateOutput = String(event.detail?.candidateOutput || '').trim();
      if (!output.trim() || !candidateOutput) return;
      setRevisionPreview({
        open: true,
        summary: String(event.detail?.summary || '').trim(),
        currentOutput: output,
        candidateOutput
      });
    }
    window.addEventListener(PET_PREVIEW_EVENT, openRevisionPreview);
    return () => window.removeEventListener(PET_PREVIEW_EVENT, openRevisionPreview);
  }, [output]);

  useEffect(() => () => {
    mountedRef.current = false;
    invalidateRequests();
    if (sourceAudioUrlRef.current) URL.revokeObjectURL(sourceAudioUrlRef.current);
    sourceAudioUrlRef.current = '';
  }, []);

  function addTextFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const novelText = String(reader.result || '').trim();
      form.setFieldValue('novelText', novelText);
      persistDraft({ ...form.getFieldsValue(), novelText });
      syncPetContext(novelText);
      message.success('TXT 原文已添加');
    };
    reader.onerror = () => message.error('TXT 文件读取失败');
    reader.readAsText(file);
    event.target.value = '';
  }

  async function narrateSource() {
    const input = String(form.getFieldValue('novelText') || '').trim();
    if (!input) return message.warning('请先输入或添加小说原文');
    const requestId = beginRequest('narrate');
    setNarrating(true);
    dispatchPetState('working');
    try {
      const config = await getConfig();
      const blob = await textToSpeech({ input, ...(config.tts || {}) });
      if (!isCurrentRequest(requestId)) return;
      const nextAudioUrl = URL.createObjectURL(blob);
      if (!isCurrentRequest(requestId)) {
        URL.revokeObjectURL(nextAudioUrl);
        return;
      }
      replaceSourceAudio(nextAudioUrl);
      message.success('已按当前配音预设生成原文配音');
      dispatchPetState('success');
    } catch (error) {
      if (!isCurrentRequest(requestId)) return;
      message.error(error.message || '原文配音失败');
      dispatchPetState('error');
    } finally {
      if (isCurrentRequest(requestId)) setNarrating(false);
    }
  }

  function handleResizeStart(event) {
    if (event.button !== 0 || !workbenchRef.current) return;

    event.preventDefault();
    const workbench = workbenchRef.current;

    function resize(moveEvent) {
      const rect = workbench.getBoundingClientRect();
      const minLeft = 320;
      const minRight = 460;
      const dividerWidth = 8;
      const nextWidth = Math.min(
        rect.width - minRight - dividerWidth,
        Math.max(minLeft, moveEvent.clientX - rect.left)
      );
      setLeftPanelWidth(nextWidth);
    }

    function finishResize() {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finishResize);
      document.body.classList.remove('is-resizing');
    }

    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finishResize, { once: true });
  }

  async function extractEntities(novelText) {
    const extractionPreset = selectAvailableExtractionPreset(form.getFieldValue('extractionPreset'), extractionPresets);
    if (!extractionPreset) throw new Error(extractionPresetError || '暂无已发布的提取指令');
    const extractResponse = await extractCharactersAndScenes(novelText, extractionPreset);
    const extraction = normalizeExtraction(extractJSON(aiText(extractResponse)));
    if (!extraction.characters.length && !extraction.scenes.length) {
      throw new Error('模型未返回人物或场景，请检查提取模板或重试');
    }
    return extraction;
  }

  async function handleExtract(values) {
    const requestId = beginRequest('workflow');
    setExtractInfo(normalizeExtractInfo());
    setOutput('');
    setSelectedShotIndexes(new Set());
    setEditingOutput(false);
    setExtracting(true);
    setGenerationStage('extracting');
    dispatchPetState('working');
    try {
      const extraction = await extractEntities(values.novelText);
      if (!isCurrentRequest(requestId)) return;
      setExtractInfo(extraction);
      setGenerationStage('extracted');
      message.success(`已提取 ${extraction.characters.length} 个人物和 ${extraction.scenes.length} 个场景`);
      playTaskSound('success', soundEnabled, soundVolume);
      dispatchPetState('success');
    } catch (error) {
      if (!isCurrentRequest(requestId)) return;
      setGenerationStage('error');
      message.error(error.message || '人物与场景提取失败');
      playTaskSound('warning', soundEnabled, soundVolume);
      dispatchPetState('error');
    } finally {
      if (isCurrentRequest(requestId)) setExtracting(false);
    }
  }

  async function regenerateEntities() {
    const novelText = String(form.getFieldValue('novelText') || '').trim();
    if (!novelText) return message.warning('请先输入或添加小说原文');
    const requestId = beginRequest('workflow');
    setRegeneratingEntities(true);
    setGenerationStage('extracting');
    dispatchPetState('working');
    try {
      const extraction = await extractEntities(novelText);
      if (!isCurrentRequest(requestId)) return;
      setExtractInfo(extraction);
      setGenerationStage('extracted');
      message.success('人物与场景已重新提取');
      dispatchPetState('success');
    } catch (error) {
      if (!isCurrentRequest(requestId)) return;
      setGenerationStage('error');
      message.error(error.message || '人物与场景重生失败');
      dispatchPetState('error');
    } finally {
      if (isCurrentRequest(requestId)) setRegeneratingEntities(false);
    }
  }

  async function generateOutput() {
    const values = form.getFieldsValue();
    if (!extractInfo.characters.length && !extractInfo.scenes.length) return message.warning('请先提取人物与场景');
    const requestId = beginRequest('workflow');
    setGenerating(true);
    setGenerationStage('generating');
    dispatchPetState('working');
    setEditingOutput(false);
    try {
      const entities = toGenerationEntities(extractInfo);
      const scriptResponse = await generateScript({
        mode: values.mode,
        format: values.format,
        duration: values.duration,
        novelText: values.novelText,
        ...entities,
        constraints: constraintsForFormat(constraints, values.format)
      });
      const nextOutput = aiText(scriptResponse);

      if (!isCurrentRequest(requestId)) return;

      try {
        await saveHistory({
          id: 'react-' + Date.now().toString(36),
          mode: values.mode,
          format: values.format,
          formatName: { storyboard: '画布模式', shortdrama: '剧本模式', screenplay: '剧情模式', shotlist: '分镜模式', q版: 'Q版模式' }[values.format] || '剧本',
          duration: values.duration,
          output: nextOutput
        });
      } catch (error) {
        if (!isCurrentRequest(requestId)) return;
        message.warning('生成成功，但保存历史失败');
      }
      if (!isCurrentRequest(requestId)) return;
      updateOutputDraft(nextOutput);
      setGenerationStage('complete');
      message.success('生成完成');
      playTaskSound('success', soundEnabled, soundVolume);
      dispatchPetState('success');
    } catch (error) {
      if (!isCurrentRequest(requestId)) return;
      setGenerationStage('error');
      message.error(error.message || '剧本生成失败');
      playTaskSound('warning', soundEnabled, soundVolume);
      dispatchPetState('error');
    } finally {
      if (isCurrentRequest(requestId)) setGenerating(false);
    }
  }

  async function regenerateOutput() {
    setRegeneratingOutput(true);
    try {
      await generateOutput();
    } finally {
      setRegeneratingOutput(false);
    }
  }

  function closeRevisionPreview() {
    setRevisionPreview({ open: false, summary: '', currentOutput: '', candidateOutput: '' });
  }

  function applyRevisionPreview() {
    const nextOutput = revisionPreview.candidateOutput.trim();
    if (!nextOutput) return;
    if (revisionPreview.currentOutput !== output) {
      closeRevisionPreview();
      message.warning('当前剧本已变化，请重新让 CM 生成修改稿。');
      return;
    }
    setPreviousOutput(output);
    updateOutputDraft(nextOutput);
    setEditingOutput(true);
    closeRevisionPreview();
    message.success('CM 的修改稿已应用，可撤销一次。');
  }

  function undoLastRevision() {
    if (!previousOutput) return;
    updateOutputDraft(previousOutput);
    setEditingOutput(true);
    setPreviousOutput('');
    message.success('已撤销 CM 的本次修改。');
  }

  // 分段开头：把模型输出的连续时间轴按所选秒数机械切段合并（对齐小说面板“按秒数分段并合并”）
  function handleMergeSegments() {
    const seconds = selectedDuration === '15s' ? 15 : 10;
    const segments = splitContinuousTimeline(output, seconds);
    if (segments.length < 2) {
      message.warning('当前输出不是可切分的连续时间轴，或时长不足两段。');
      return;
    }
    const merged = segments.join('\n\n---\n\n');
    setPreviousOutput(output);
    updateOutputDraft(merged);
    message.success(`已按 ${seconds}s 切分为 ${segments.length} 段。`);
  }

  function invalidateEntityOutput(nextInfo) {
    setOutput('');
    setEditingOutput(false);
    setSelectedShotIndexes(new Set());
    setGenerationStage(nextInfo.characters.length || nextInfo.scenes.length ? 'extracted' : 'idle');
  }

  function openEntityEditor(type, id) {
    setActiveEntity({ type, id, isNew: false });
    setFullscreenEditor(false);
  }

  function addEntity(type) {
    const data = type === 'characters'
      ? { 名称: '', 身份: '', 外形: '', 性格: '' }
      : { 名称: '', 时段: '', 氛围: '', 描述: '' };
    setActiveEntity({ type, id: '', isNew: true, data });
    setFullscreenEditor(false);
  }

  function updateActiveEntity(fields) {
    if (!activeEntity) return;
    setExtractInfo(current => {
      const normalized = normalizeExtractInfo(current);
      const items = [...normalized[activeEntity.type]];
      const currentIndex = items.findIndex(item => item.id === activeEntity.id);
      if (activeEntity.isNew) items.push(createEntity(fields));
      else if (currentIndex !== -1) items[currentIndex] = { ...items[currentIndex], data: fields };
      const next = { ...normalized, [activeEntity.type]: items };
      invalidateEntityOutput(next);
      return next;
    });
  }

  function deleteActiveEntity() {
    if (!activeEntity || activeEntity.isNew) return;
    setExtractInfo(current => {
      const normalized = normalizeExtractInfo(current);
      const next = {
        ...normalized,
        [activeEntity.type]: normalized[activeEntity.type].filter(item => item.id !== activeEntity.id),
        protagonistIds: activeEntity.type === 'characters'
          ? normalized.protagonistIds.filter(id => id !== activeEntity.id)
          : normalized.protagonistIds
      };
      invalidateEntityOutput(next);
      return next;
    });
    setActiveEntity(null);
  }

  function toggleProtagonist(id) {
    setExtractInfo(current => {
      const normalized = normalizeExtractInfo(current);
      const protagonistIds = normalized.protagonistIds.includes(id)
        ? normalized.protagonistIds.filter(item => item !== id)
        : [...normalized.protagonistIds, id];
      const next = { ...normalized, protagonistIds };
      invalidateEntityOutput(next);
      return next;
    });
  }

  function constraintOptions(category) {
    return constraintCatalog
      .filter(item => item.constraintCategory === category)
      .map(item => ({ label: item.name, value: item.id }));
  }

  function constraintPresetBody(category, presetId) {
    if (!constraintCatalog.some(item => item.constraintCategory === category && item.id === presetId)) return '';
    return String(constraintTexts[presetId] || '').trim();
  }

  async function loadConstraintPresetText(category, presetId) {
    if (!presetId || !constraintCatalog.some(item => item.constraintCategory === category && item.id === presetId)) return '';
    if (constraintTexts[presetId]) return String(constraintTexts[presetId]).trim();
    try {
      const result = await getConstraintPresetTexts([presetId]);
      const body = String(result.texts?.[presetId] || '').trim();
      setConstraintTexts(current => ({ ...current, ...(result.texts || {}) }));
      return body;
    } catch {
      message.warning('系统预设提示词读取失败');
      return '';
    }
  }

  async function loadPersonalConstraintPrompts(category) {
    setLoadingPersonalConstraintPrompts(current => ({ ...current, [category]: true }));
    try {
      const result = await listScriptConstraintPrompts(category);
      setPersonalConstraintPrompts(current => ({ ...current, [category]: Array.isArray(result?.prompts) ? result.prompts : [] }));
    } catch {
      message.warning('我的提示词加载失败');
    } finally {
      setLoadingPersonalConstraintPrompts(current => ({ ...current, [category]: false }));
    }
  }

  function updateDraftConstraint(category, patch) {
    setDraftConstraints(current => ({ ...current, [category]: { ...current[category], ...patch } }));
  }

  async function selectSystemConstraint(category, presetId) {
    const body = await loadConstraintPresetText(category, presetId);
    updateDraftConstraint(category, { source: 'system', presetId: presetId || '', personalPromptId: '', body });
  }

  function selectPersonalConstraint(category, promptId) {
    const prompt = (personalConstraintPrompts[category] || []).find(item => item.id === promptId);
    if (!prompt) {
      updateDraftConstraint(category, { source: 'draft', personalPromptId: '' });
      return;
    }
    updateDraftConstraint(category, { source: 'personal', presetId: '', personalPromptId: prompt.id, body: prompt.body });
  }

  async function savePersonalConstraint(category, name) {
    const body = String(draftConstraints[category]?.body || '').trim();
    if (!body) return message.warning('请先填写提示词内容');
    if (name !== null && !String(name || '').trim()) return message.warning('请输入提示词名称');
    setSavingConstraintCategory(category);
    try {
      const prompt = editingPersonalPromptId
        ? await updateScriptConstraintPrompt(editingPersonalPromptId, { name, body })
        : await saveScriptConstraintPrompt({ category, name, body });
      const saved = prompt?.prompt;
      if (!saved) throw new Error('保存失败');
      await loadPersonalConstraintPrompts(category);
      updateDraftConstraint(category, { source: 'personal', presetId: '', personalPromptId: saved.id, body: saved.body });
      setEditingPersonalPromptId('');
      setEditingPersonalPromptName('');
      setPersonalPromptNameModal({ open: false, category: '', name: '' });
      message.success(name === null ? '当前草稿已保存' : '已保存到我的提示词');
    } catch (error) {
      message.error(error.message || '提示词保存失败');
    } finally {
      setSavingConstraintCategory('');
    }
  }

  async function deletePersonalConstraint(category, id) {
    try {
      await deleteScriptConstraintPrompt(id);
      await loadPersonalConstraintPrompts(category);
      if (draftConstraints[category]?.personalPromptId === id) updateDraftConstraint(category, { source: 'draft', personalPromptId: '', body: '' });
      message.success('已删除我的提示词');
    } catch (error) {
      message.error(error.message || '删除失败');
    }
  }

  function openConstraints() {
    const next = normalizeScriptConstraints(constraints);
    setDraftConstraints(next);
    ['prefix', 'quality', 'restriction', 'negative'].forEach(category => {
      loadPersonalConstraintPrompts(category);
      const value = next[category];
      if (value.enabled && value.source === 'system') loadConstraintPresetText(category, value.presetId);
    });
    setConstraintModalOpen(true);
  }

  function saveConstraints() {
    const next = normalizeScriptConstraints(draftConstraints);
    setConstraints(next);
    setConstraintModalOpen(false);
    persistDraft(undefined, { constraints: next });
  }

  const activeItem = activeEntity?.isNew
    ? activeEntity.data
    : activeEntity ? extractInfo[activeEntity.type].find(item => item.id === activeEntity.id) : null;
  const canGenerateScript = generationStage === 'extracted' || generationStage === 'complete';
  const constraintsAllowed = selectedFormat !== 'shortdrama';
  const extractionPreset = selectAvailableExtractionPreset(form.getFieldValue('extractionPreset'), extractionPresets);
  const selectedExtractionPreset = extractionPresets.find(item => item.id === extractionPreset);
  const extractionPresetName = selectedExtractionPreset?.name || extractionPresetError || '正在加载提取指令';
  const extractionUnavailable = loadingExtractionPresets || Boolean(extractionPresetError) || !extractionPresets.length;

  return (
    <Form
      className="script-workbench-form"
      form={form}
      initialValues={{ mode: 'continuous', format: 'storyboard', duration: '10s', extractionPreset: 'standard' }}
      onFinish={handleExtract}
      onValuesChange={(changed, allValues) => {
        persistDraft(allValues);
        if (Object.hasOwn(changed, 'novelText')) {
          invalidateRequests();
          setExtracting(false);
          setGenerating(false);
          setRegeneratingEntities(false);
          setRegeneratingOutput(false);
          setNarrating(false);
          syncPetContext(changed.novelText);
        }
      }}
    >
      <div
        ref={workbenchRef}
        className="script-workbench utility-workbench"
        style={leftPanelWidth ? { gridTemplateColumns: `${leftPanelWidth}px 8px minmax(460px, 1fr)` } : undefined}
      >
        <div className="script-left">
        <div className="script-left-scroll">
          <div className="script-chat-shell">
            <div className="script-source-input">
              <Form.Item name="novelText" rules={[{ required: true, message: '请先粘贴小说原文' }]}>
                <Input.TextArea className="script-chat-textarea" rows={10} placeholder="粘贴小说原文，开始构思... ✦" />
              </Form.Item>
              {novelText ? (
                <button
                  type="button"
                  className="script-source-clear"
                  aria-label="清空小说原文"
                  title="清空小说原文"
                  onClick={clearNovelText}
                >×</button>
              ) : null}
            </div>
            <div className="script-chat-options">
              <div className="script-chat-tools">
                <label className="script-file-button" title="添加 TXT 原文">
                  <FileText size={17} strokeWidth={1.8} aria-hidden="true" />
                  <input type="file" accept=".txt,text/plain" onChange={addTextFile} />
                </label>
                <button type="button" aria-label="切换人物场景提取指令" title="切换指令" onClick={() => {
                  setPendingExtractionPreset(extractionPreset);
                  setInstructionModalOpen(true);
                }} disabled={extractionUnavailable}><Plus size={17} strokeWidth={1.8} aria-hidden="true" /></button>
                <button type="button" aria-label="配音原文" title="按当前配音预设生成原文配音" onClick={narrateSource} disabled={narrating}><AudioLines size={17} strokeWidth={1.8} aria-hidden="true" /></button>
              </div>
              <Button className="script-chat-submit" type="primary" htmlType="submit" loading={extracting} disabled={generating || extractionUnavailable} aria-label="提取人物与场景" icon={<WandSparkles size={16} strokeWidth={1.8} aria-hidden="true" />}>
                <span>{generationStage === 'extracting' ? '提取中...' : '提取'}</span>
              </Button>
            </div>
          </div>

          <div className="script-instruction-status">当前提取指令：{extractionPresetName}</div>
          {extracting ? <div className="script-generation-stage" role="status">正在提取人物与场景...</div> : null}
          {!extracting && generationStage === 'extracted' ? <div className="script-generation-stage">人物与场景已提取，请检查、编辑或重生后，再点击右侧“生成剧本”。</div> : null}

          <EntitySection title="人物" type="characters" count={extractInfo.characters.length} items={extractInfo.characters} protagonistIds={extractInfo.protagonistIds} onAdd={() => addEntity('characters')} onEdit={id => openEntityEditor('characters', id)} onToggleProtagonist={toggleProtagonist} onRegenerate={regenerateEntities} regenerating={regeneratingEntities} />
          <EntitySection title="场景" type="scenes" count={extractInfo.scenes.length} items={extractInfo.scenes} onAdd={() => addEntity('scenes')} onEdit={id => openEntityEditor('scenes', id)} onRegenerate={regenerateEntities} regenerating={regeneratingEntities} />
        </div>
      </div>
        <div
          className="script-resize-handle"
          role="separator"
          aria-label="调整左右面板宽度"
          aria-orientation="vertical"
          onPointerDown={handleResizeStart}
        />
        <div className="script-right">
        <div className="script-tabs">
          <Form.Item name="mode" noStyle>
            <Segmented
              options={[
                { label: '连续开头', value: 'continuous' },
                { label: '爆款开头', value: 'hook' },
                { label: '分段开头', value: 'segmented' }
              ]}
            />
          </Form.Item>
          <div style={{ flex: 1 }} />
          <Form.Item name="duration" noStyle>
            <Segmented options={['10s', '15s']} />
          </Form.Item>
        </div>
        <div className="script-toolbar">
          <Form.Item name="format" noStyle>
            <Select
              style={{ width: 140 }}
              options={[
                { label: '画布模式', value: 'storyboard' },
                { label: '剧本模式', value: 'shortdrama' },
                { label: '剧情模式', value: 'screenplay' },
                { label: '分镜模式', value: 'shotlist' },
                { label: 'Q版模式', value: 'q版' }
              ]}
            />
          </Form.Item>
          <Button
            className="script-constraint-button"
            icon={<Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={openConstraints}
            disabled={!constraintsAllowed}
            title={constraintsAllowed ? '约束设置' : '剧本模式不支持视频提示词约束设置'}
          >约束设置</Button>
          <Space>
            <Button type="primary" icon={<WandSparkles size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={generateOutput} loading={generating} disabled={extracting || !canGenerateScript || (!extractInfo.characters.length && !extractInfo.scenes.length)}>生成剧本</Button>
            <Button icon={<Copy size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => copyText(isShotCardView ? shotCards.join('\n\n') : output)} disabled={!output}>复制</Button>
            <Button disabled={!isShotCardView || !selectedShotIndexes.size} onClick={() => setShotReplaceOpen(true)}>查找替换</Button>
            <Button icon={<Pencil size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => { setSelectedShotIndexes(new Set()); setEditingOutput(value => !value); }} disabled={!output}>{editingOutput ? '完成编辑' : '编辑'}</Button>
            <Button onClick={undoLastRevision} disabled={!previousOutput}>撤销本次修改</Button>
            <Button
              aria-label="重新生成剧本"
              title="重新生成剧本"
              icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={regenerateOutput}
              loading={regeneratingOutput}
              disabled={!output || !canGenerateScript}
            />
            <Button icon={<Download size={16} strokeWidth={1.8} aria-hidden="true" />} disabled={!output}>导出</Button>
            {selectedMode === 'segmented' && selectedFormat !== 'shortdrama' && output ? (
              <Button icon={<Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleMergeSegments}>按秒分段并合并</Button>
            ) : null}
          </Space>
        </div>
        <div className="script-output">
          {sourceAudioUrl && <audio className="script-source-audio" controls src={sourceAudioUrl} />}
          {output ? (
            isShotCardView ? <ShotOutputCards
              cards={shotCards}
              duration={form.getFieldValue('duration')}
              selectedIndexes={selectedShotIndexes}
              onToggle={index => setSelectedShotIndexes(current => {
                const next = new Set(current);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
              })}
              onToggleAll={() => setSelectedShotIndexes(current => current.size === shotCards.length ? new Set() : new Set(shotCards.map((_, index) => index)))}
              onCopy={copyText}
              onCopySelected={() => copyText(joinShotCards(shotCards, selectedShotIndexes))}
              onGenerateVideo={generateVideoForShot}
              generatingIndexes={generatingShotIndexes}
              output={output}
              activeMatch={shotReplaceOpen ? activeShotMatch : null}
              cardStarts={shotCardStarts}
            /> : <Input.TextArea className="legacy-output" value={output} rows={24} readOnly={!editingOutput} onChange={event => updateOutputDraft(event.target.value)} />
          ) : generating ? (
            <CmLoader />
          ) : (
            <div className="script-empty legacy-panel-card">
              <div className="script-empty-card">
                <span className="script-empty-dot" aria-hidden="true" />
                <span className="script-empty-ray" aria-hidden="true" />
                <span className="script-empty-line script-empty-line--top" aria-hidden="true" />
                <span className="script-empty-line script-empty-line--bottom" aria-hidden="true" />
              </div>
              <div className="script-empty-title">准备创作</div>
              <div className="script-empty-copy">先提取人物与场景，确认后再生成剧本</div>
            </div>
          )}
        </div>
        </div>
      </div>
      <Modal
        title="替换已选分镜文字"
        open={shotReplaceOpen}
        onCancel={() => setShotReplaceOpen(false)}
        footer={null}
      >
        <Typography.Paragraph>已选 {selectedShotIndexes.size} 条分镜</Typography.Paragraph>
        <Form.Item label="查找内容">
          <Input value={shotFindText} onChange={event => { setShotFindText(event.target.value); setShotMatchIndex(0); }} />
        </Form.Item>
        <Form.Item label="替换为">
          <Input value={shotReplaceText} onChange={event => setShotReplaceText(event.target.value)} />
        </Form.Item>
        {!shotFindText ? <Typography.Text type="secondary">请输入查找内容</Typography.Text> : !selectedShotMatches.length ? <Typography.Text type="secondary">未找到匹配内容</Typography.Text> : (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            找到内容：“{shotFindText}” · 分镜 {activeShotMatch.cardIndex + 1} · {shotMatchIndex + 1} / {selectedShotMatches.length}
          </Typography.Paragraph>
        )}
        <Space wrap style={{ marginTop: 16 }}>
          <Button disabled={!selectedShotMatches.length} onClick={() => setShotMatchIndex(index => (index - 1 + selectedShotMatches.length) % selectedShotMatches.length)}>上一个</Button>
          <Button disabled={!selectedShotMatches.length} onClick={() => setShotMatchIndex(index => (index + 1) % selectedShotMatches.length)}>下一个</Button>
          <Button disabled={!activeShotMatch} onClick={replaceCurrentShotMatch}>替换当前</Button>
          <Button type="primary" disabled={!selectedShotMatches.length} onClick={replaceAllShotMatches}>全部替换</Button>
        </Space>
      </Modal>
      <Modal
        title="CM 修改预览"
        open={revisionPreview.open}
        onCancel={closeRevisionPreview}
        onOk={applyRevisionPreview}
        okText="应用修改"
        cancelText="放弃修改"
        width={1100}
      >
        {revisionPreview.summary ? <Typography.Paragraph>{revisionPreview.summary}</Typography.Paragraph> : null}
        <div className="cm-revision-preview">
          <section>
            <Typography.Title level={5}>当前剧本</Typography.Title>
            <Input.TextArea value={revisionPreview.currentOutput} rows={24} readOnly />
          </section>
          <section>
            <Typography.Title level={5}>CM 修改稿</Typography.Title>
            <Input.TextArea value={revisionPreview.candidateOutput} rows={24} readOnly />
          </section>
        </div>
      </Modal>
      <Modal
        title="切换人物与场景提取指令"
        open={instructionModalOpen}
        onCancel={() => setInstructionModalOpen(false)}
        onOk={() => {
          form.setFieldValue('extractionPreset', pendingExtractionPreset);
          setInstructionModalOpen(false);
          persistDraft({ ...form.getFieldsValue(), extractionPreset: pendingExtractionPreset });
        }}
        okText="保存"
      >
        <Form.Item label="提取方案">
          <Select
            value={pendingExtractionPreset}
            onChange={setPendingExtractionPreset}
            options={extractionPresets.map(item => ({ label: `${item.name} · v${item.version}`, value: item.id }))}
          />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          {selectedExtractionPreset?.description || extractionPresetError || '管理员发布后可在此选择提取指令。'}
        </Typography.Paragraph>
      </Modal>
      <Modal
        title="约束设置"
        open={constraintModalOpen}
        onCancel={() => setConstraintModalOpen(false)}
        onOk={saveConstraints}
        okText="保存并启用"
        width={720}
      >
        <div className="script-constraint-section">
          <Space align="center">
            <Switch
              checked={draftConstraints.enabled}
              onChange={enabled => setDraftConstraints(current => ({ ...current, enabled }))}
            />
            <Typography.Text strong>启用本次及后续剧本输出约束</Typography.Text>
          </Space>
        </div>
        {[
          ['prefix', '画面前缀词'],
          ['quality', '画质约束'],
          ['restriction', '画面限制'],
          ['negative', '负面提示词']
        ].map(([category, label]) => (
          <ConstraintCategoryEditor
            key={category}
            category={category}
            label={label}
            value={draftConstraints[category]}
            systemOptions={constraintOptions(category)}
            personalPrompts={personalConstraintPrompts[category] || []}
            loadingPersonalPrompts={loadingPersonalConstraintPrompts[category]}
            saving={savingConstraintCategory === category}
            editingPersonalPromptId={editingPersonalPromptId}
            onChange={patch => updateDraftConstraint(category, patch)}
            onSelectSystem={presetId => selectSystemConstraint(category, presetId)}
            onSelectPersonal={promptId => selectPersonalConstraint(category, promptId)}
            onSaveDraft={() => { setEditingPersonalPromptId(''); setEditingPersonalPromptName(''); savePersonalConstraint(category, null); }}
             onSaveNamed={() => setPersonalPromptNameModal({ open: true, category, name: editingPersonalPromptName })}
             onEditPersonal={prompt => {
               setEditingPersonalPromptId(prompt.id);
               setEditingPersonalPromptName(prompt.name || '');
               updateDraftConstraint(category, { source: 'draft', presetId: '', personalPromptId: '', body: prompt.body });
             }}
            onDeletePersonal={id => deletePersonalConstraint(category, id)}
          />
        ))}
        <Typography.Paragraph className="script-constraint-help" type="secondary">
          可以只选择一个类别，也可以不选择任何类别。关闭总开关后会保留当前选择，但后续生成不会注入约束。
        </Typography.Paragraph>
      </Modal>
      <Modal
        title={editingPersonalPromptId ? '编辑我的提示词' : '保存为我的提示词'}
        open={personalPromptNameModal.open}
        onCancel={() => {
          setPersonalPromptNameModal({ open: false, category: '', name: '' });
          setEditingPersonalPromptId('');
          setEditingPersonalPromptName('');
        }}
        onOk={() => savePersonalConstraint(personalPromptNameModal.category, personalPromptNameModal.name.trim())}
        okText="保存"
        confirmLoading={savingConstraintCategory === personalPromptNameModal.category}
      >
        <Input
          autoFocus
          maxLength={80}
          placeholder="请输入提示词名称"
          value={personalPromptNameModal.name}
          onChange={event => setPersonalPromptNameModal(current => ({ ...current, name: event.target.value }))}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          将当前提示词内容保存到您的账号。保存后可在任何设备登录继续使用，最近一次用于生成会排在最前。
        </Typography.Paragraph>
      </Modal>
      <EntityEditor
        entity={activeItem}
        type={activeEntity?.type}
        isNew={Boolean(activeEntity?.isNew)}
        open={Boolean(activeEntity)}
        fullscreen={fullscreenEditor}
        onClose={() => setActiveEntity(null)}
        onToggleFullscreen={() => setFullscreenEditor(value => !value)}
        novelText={form.getFieldValue('novelText')}
        extractionPreset={extractionPreset}
        existingEntitySummary={compactEntitySummary(extractInfo, activeEntity?.isNew ? '' : activeEntity?.id)}
        onChange={updateActiveEntity}
        onDelete={deleteActiveEntity}
      />
    </Form>
  );
}

export default ScriptPage;

function ConstraintCategoryEditor({ category, label, value, systemOptions, personalPrompts, loadingPersonalPrompts, saving, editingPersonalPromptId, onChange, onSelectSystem, onSelectPersonal, onSaveDraft, onSaveNamed, onEditPersonal, onDeletePersonal }) {
  const isSystem = value.source === 'system';
  const selectedPersonalPrompt = personalPrompts.find(item => item.id === value.personalPromptId);
  return (
    <div className="script-constraint-section">
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text strong>{label}</Typography.Text>
        <Switch checked={value.enabled} onChange={enabled => onChange({ enabled })} />
      </Space>
      {value.enabled ? <>
        <Segmented
          block
          options={[{ label: '系统预设', value: 'system' }, { label: '我的提示词', value: 'personal' }]}
          value={isSystem ? 'system' : 'personal'}
          onChange={source => onChange(source === 'system'
            ? { source: 'system', personalPromptId: '' }
            : { source: value.personalPromptId ? 'personal' : 'draft', presetId: '' })}
          style={{ marginTop: 10 }}
        />
        {isSystem ? <Select
          allowClear
          placeholder="选择系统预设"
          options={systemOptions}
          value={value.presetId || undefined}
          onChange={onSelectSystem}
          style={{ width: '100%', marginTop: 8 }}
        /> : <>
          <Select
            allowClear
            loading={loadingPersonalPrompts}
            placeholder="选择我的提示词，或直接编辑当前草稿"
            options={personalPrompts.map(item => ({ label: item.name || '未命名个人副本', value: item.id }))}
            value={value.personalPromptId || undefined}
            onChange={onSelectPersonal}
            style={{ width: '100%', marginTop: 8 }}
          />
          {selectedPersonalPrompt ? <Space size={8} wrap style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => onEditPersonal(selectedPersonalPrompt)}>编辑所选提示词</Button>
            <Popconfirm title="确认删除该个人提示词？" onConfirm={() => onDeletePersonal(selectedPersonalPrompt.id)}><Button size="small" danger>删除</Button></Popconfirm>
          </Space> : null}
        </>}
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>提示词内容</Typography.Text>
        <Input.TextArea
          rows={6}
          placeholder="选择系统预设后可在此编辑完整提示词内容，保存不会影响系统预设。"
          value={value.body}
          onChange={event => onChange({ source: 'draft', personalPromptId: '', body: event.target.value })}
          style={{ marginTop: 6 }}
        />
        <Space wrap style={{ marginTop: 10 }}>
          <Button loading={saving} onClick={onSaveDraft}>保存当前草稿</Button>
          <Button type="primary" loading={saving} onClick={onSaveNamed}>{editingPersonalPromptId ? '保存编辑' : '保存为我的提示词'}</Button>
        </Space>
        {editingPersonalPromptId ? <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>正在编辑个人提示词，保存后会覆盖该条记录。</Typography.Text> : null}
      </> : null}
    </div>
  );
}

function CmLoader() {
  return (
    <div className="cm-loader" role="status" aria-live="polite">
      <svg className="cm-loader-defs" aria-hidden="true">
        <defs>
          <linearGradient id="cm-blue">
            <stop stopColor="#973bed" />
            <stop offset="1" stopColor="#007cff" />
          </linearGradient>
          <linearGradient id="cm-green">
            <stop stopColor="#00e0ed" />
            <stop offset="1" stopColor="#00da72" />
          </linearGradient>
        </defs>
      </svg>
      <div className="cm-loader-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" data-letter="C" aria-hidden="true">
          <path
            className="cm-loader-dash"
            pathLength="360"
            stroke="url(#cm-blue)"
            strokeWidth="8"
            strokeLinecap="round"
            d="M52 14C47.2 8.2 39.9 5 32 5C17.1 5 5 17.1 5 32s12.1 27 27 27c7.9 0 15.2-3.2 20-9"
          />
        </svg>
        <svg viewBox="0 0 64 64" data-letter="M" aria-hidden="true">
          <path
            className="cm-loader-dash"
            pathLength="360"
            stroke="url(#cm-green)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 57V7l25 31L57 7v50"
          />
        </svg>
      </div>
      <strong>正在生成剧本</strong>
      <span>正在提取人物、场景并组织剧情</span>
    </div>
  );
}

function EntitySection({ title, type, count, items, protagonistIds = [], onAdd, onEdit, onToggleProtagonist, onRegenerate, regenerating }) {
  const isCharacter = type === 'characters';
  const protagonistIdSet = new Set(protagonistIds);
  return (
    <div className="entity-section legacy-panel-card">
      <div className="entity-section-header">
        <Typography.Text strong>{title}</Typography.Text>
        <Space size={8}>
          <span className="legacy-muted">{count}</span>
          <Button size="small" type="text" className="entity-add-button" onClick={onAdd}>添加{title}</Button>
          <Button
            size="small"
            type="text"
            aria-label={`重新提取${title}`}
            title={`重新提取${title}`}
            icon={<RefreshCw size={15} strokeWidth={1.8} aria-hidden="true" />}
            loading={regenerating}
            onClick={onRegenerate}
          />
        </Space>
      </div>
      <div className="entity-list">
        {items.length === 0 ? (
          <div className="entity-card">可手动添加{title}，或提取后显示{title}信息</div>
        ) : (
          items.map(item => {
            const isProtagonist = protagonistIdSet.has(item.id);
            return <div className="entity-card-row" key={item.id}>
              <button className="entity-card entity-card-button entity-card-main" type="button" onClick={() => onEdit(item.id)}>{formatEntity(item)}</button>
              {isCharacter && <Button
                className="entity-protagonist-toggle"
                type="text"
                aria-label={isProtagonist ? '取消主角标记' : '设为主角'}
                title={isProtagonist ? '取消主角标记' : '设为主角'}
                icon={<Star size={16} fill={isProtagonist ? 'currentColor' : 'none'} />}
                onClick={() => onToggleProtagonist(item.id)}
              />}
            </div>;
          })
        )}
      </div>
    </div>
  );
}

function EntityEditor({ entity, type, isNew, open, fullscreen, novelText, extractionPreset, existingEntitySummary, onClose, onToggleFullscreen, onChange, onDelete }) {
  const [fields, setFields] = useState({});
  const [enriching, setEnriching] = useState(false);
  const [enrichment, setEnrichment] = useState(null);
  const [enrichmentError, setEnrichmentError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFields(Object.fromEntries(visualFields(entity).map(field => [field.key, field.value])));
    setEnrichment(null);
    setEnrichmentError('');
  }, [entity, open]);

  const fieldsToRender = visualFields(entity);
  const title = `${isNew ? '添加' : '编辑'}${type === 'characters' ? '人物' : '场景'}`;
  const deleteLabel = type === 'characters' ? '删除人物' : '删除场景';
  const canEnrich = Boolean(String(novelText || '').trim() && entityName(fields));

  async function enrich() {
    if (!canEnrich) return;
    setEnriching(true);
    setEnrichmentError('');
    try {
      const response = await enrichScriptEntity({
        entityType: type === 'characters' ? 'character' : 'scene',
        novelText,
        entity: fields,
        existingEntitySummary,
        extractionPreset
      });
      const result = normalizeEntityEnrichment(response?.enrichment);
      setFields(current => applyEntityEnrichment(current, result));
      setEnrichment(result);
    } catch (error) {
      setEnrichmentError(error.message || '智能补全失败，请稍后重试');
    } finally {
      setEnriching(false);
    }
  }

  return (
    <Modal
      open={open}
      rootClassName="entity-editor-modal"
      title={title}
      width={fullscreen ? '100vw' : 760}
      style={fullscreen ? { top: 0, paddingBottom: 0 } : undefined}
      onCancel={onClose}
      footer={<Space><Button onClick={onToggleFullscreen}>{fullscreen ? '退出全屏' : '全屏编辑'}</Button>{!isNew && <Popconfirm title={`确认${deleteLabel}？`} onConfirm={onDelete}><Button danger className="entity-editor-danger">{deleteLabel}</Button></Popconfirm>}<Button type="primary" onClick={() => { onChange(fields); onClose(); }}>完成</Button></Space>}
    >
      <div className="entity-editor-fields">
        {fieldsToRender.map(field => (
          <Form.Item key={field.key} label={field.label}>
            <Input.TextArea value={fields[field.key] || ''} autoSize={{ minRows: 1, maxRows: 6 }} onChange={event => setFields(current => ({ ...current, [field.key]: event.target.value }))} />
          </Form.Item>
        ))}
      </div>
      <Space wrap style={{ marginTop: 8 }}>
        <Button onClick={enrich} loading={enriching} disabled={!canEnrich}>根据小说智能补全</Button>
        {!String(novelText || '').trim() ? <Typography.Text type="secondary">请先输入小说原文</Typography.Text> : null}
      </Space>
      {enrichmentError ? <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>{enrichmentError}</Typography.Paragraph> : null}
      {enrichment ? <div className="entity-enrichment-result">
        {enrichment.evidence.length ? <EnrichmentList title="原文依据" items={enrichment.evidence} /> : null}
        {enrichment.suggestions.length ? <EnrichmentList title="AI 建议" items={enrichment.suggestions} /> : null}
        {enrichment.uncertainties.length ? <EnrichmentList title="不确定项" items={enrichment.uncertainties} /> : null}
      </div> : null}
    </Modal>
  );
}

function EnrichmentList({ title, items }) {
  return <div style={{ marginTop: 12 }}><Typography.Text strong>{title}</Typography.Text><ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{items.map(item => <li key={item}>{item}</li>)}</ul></div>;
}
