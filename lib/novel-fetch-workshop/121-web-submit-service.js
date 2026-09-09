const crypto = require('node:crypto');
const target = require('../target-upload');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return String(value || '').trim(); }
function idOf(task) { return text(task?.bookId || task?.book_id || task?.id); }
function isFailed(task) { return [task?.status, task?.originalStatus, task?.aiStatus, task?.classifyStatus, task?.error].join(' ').toLowerCase().includes('failed'); }

function normalizeUploadProfiles(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const source = object(item);
    return {
      id: text(source.id || `profile_${index + 1}`),
      name: text(source.name || `配置档 ${index + 1}`),
      enabled: source.enabled !== false,
      platform_id: text(source.platform_id || source.platformId),
      gender: text(source.gender).replace('频', ''),
      style: text(source.style),
      is_default: source.is_default === true,
      config_id: text(source.config_id),
      source: text(source.source),
      advanced: { ...object(source.advanced || source.config_data) }
    };
  }).filter(item => item.id && item.name);
}

function normalizeProfileBindings(value) {
  const source = object(value);
  return Object.fromEntries(['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'].map(version => [version, text(source[version])]));
}

function normalizeStyleCatalog(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(item => ({ id: text(object(item).id ?? object(item).value), name: text(object(item).name ?? object(item).label) }))
    .filter(item => item.id && item.name && !seen.has(`${item.id}:${item.name}`) && (seen.add(`${item.id}:${item.name}`) || true));
}

function styleMapFromCatalog(value) {
  return Object.fromEntries(normalizeStyleCatalog(value).map(item => [item.name, Number(item.id)]).filter(([, id]) => Number.isFinite(id)));
}

function publicWebSubmit(value = {}) {
  const cfg = object(value);
  return {
    enabled: cfg.enabled === true,
    username: text(cfg.username),
    password_masked: cfg.password_masked === true,
    submit_versions: Array.isArray(cfg.submit_versions) && cfg.submit_versions.length ? cfg.submit_versions.map(text).filter(Boolean) : ['ai1'],
    skip_submitted: cfg.skip_submitted !== false,
    min_text_chars: Math.max(0, Math.min(Number(cfg.min_text_chars) || 0, 100000)),
    retry_times: Math.max(0, Math.min(Number(cfg.retry_times) || 1, 5)),
    submit_mode: 'version',
    selected_profile: text(cfg.selected_profile),
    advanced: target.normalizeBookAdvanced(cfg.advanced),
    upload_profiles: normalizeUploadProfiles(cfg.upload_profiles),
    profile_bindings: normalizeProfileBindings(cfg.profile_bindings),
    style_catalog: normalizeStyleCatalog(cfg.style_catalog),
    target: target.TARGET_HOST
  };
}

function normalizeSavedWebSubmit(existingValue, incomingValue) {
  const existing = object(existingValue);
  const incoming = object(incomingValue);
  return {
    enabled: incoming.enabled === true,
    username: text(incoming.username || existing.username),
    password_masked: existing.password_masked === true,
    submit_versions: Array.isArray(incoming.submit_versions) && incoming.submit_versions.length ? incoming.submit_versions.map(text).filter(Boolean) : (Array.isArray(existing.submit_versions) && existing.submit_versions.length ? existing.submit_versions : ['ai1']),
    skip_submitted: incoming.skip_submitted !== false,
    min_text_chars: Math.max(0, Math.min(Number(incoming.min_text_chars ?? existing.min_text_chars) || 0, 100000)),
    retry_times: Math.max(0, Math.min(Number(incoming.retry_times ?? existing.retry_times) || 1, 5)),
    submit_mode: 'version',
    selected_profile: text(incoming.selected_profile ?? existing.selected_profile),
    advanced: target.normalizeBookAdvanced(incoming.advanced ?? existing.advanced),
    upload_profiles: normalizeUploadProfiles(incoming.upload_profiles ?? existing.upload_profiles),
    profile_bindings: normalizeProfileBindings(incoming.profile_bindings ?? existing.profile_bindings),
    style_catalog: normalizeStyleCatalog(incoming.style_catalog ?? existing.style_catalog)
  };
}

function htmlText(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
}

function parseTargetStyleCatalog(html) {
  const select = String(html || '').match(/<select\b(?=[^>]*\bid=["']style["'])[^>]*>([\s\S]*?)<\/select>/i);
  if (!select) throw new Error('121 自定义文案页未找到风格下拉框');
  const catalog = [];
  const pattern = /<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  for (let match; (match = pattern.exec(select[1]));) {
    const id = text(match[1]);
    const name = htmlText(match[2]);
    if (id && name && !/请选择|全部/.test(name)) catalog.push({ id, name });
  }
  return normalizeStyleCatalog(catalog);
}

function parseTargetConfigData(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function importedAdvancedFromTarget(raw) {
  const source = object(raw);
  const jieya = object(source.jieya);
  const gunping = object(source.gunping);
  return target.normalizeAdvanced({
    tl5: Number(source.tl5), ziti: source.ziti ?? gunping.ziti, zitidx: source.zitidx ?? gunping.zitidx,
    biaohong: source.biaohong ?? gunping.biaohong, biaohongReuse: source.biaohong_reuse ?? gunping.biaohong_reuse,
    keywords: source.keywords, jieyaNum: source.jieya_num ?? jieya.jieya_num,
    jieyaAiHead: source.jieya_ai_head ?? jieya.jieya_ai_head ?? jieya.ai_head,
    jieyaSpeed: source.jieya_speed ?? jieya.jieya_speed ?? jieya.speed,
    jieyaPitch: source.jieya_pitch ?? jieya.jieya_pitch ?? jieya.pitch,
    gunpingNum: source.gunping_num ?? gunping.gunping_num,
    gunpingSpeed: source.gunping_speed ?? gunping.gunping_speed ?? gunping.speed,
    fontColorStyles: source.font_color_styles ?? jieya.font_color_styles
  });
}

function selectBoundUploadProfile(cfg, version) {
  const profiles = normalizeUploadProfiles(cfg.upload_profiles).filter(item => item.enabled);
  const findProfile = identity => {
    const value = text(identity);
    return profiles.find(item => item.id === value || item.name === value) || null;
  };
  const bound = findProfile(normalizeProfileBindings(cfg.profile_bindings)[version]);
  if (bound) return bound;
  return findProfile(cfg.selected_profile);
}

function selectVersionUploadProfile(cfg, meta, version) {
  const profiles = normalizeUploadProfiles(cfg.upload_profiles).filter(item => item.enabled);
  const chosen = selectBoundUploadProfile(cfg, version);
  if (chosen) return chosen;
  const gender = text(meta?.gender).replace('频', '');
  const platformId = text(meta?.platformId || meta?.platform_id);
  const style = text(meta?.style);
  return profiles.find(item => item.platform_id === platformId && item.gender === gender && item.style === style)
    || profiles.find(item => item.platform_id === platformId && item.gender === gender)
    || profiles.find(item => item.is_default)
    || profiles[0]
    || null;
}

function parseJsonBody(response, label) {
  let data = {};
  try { data = JSON.parse(String(response?.body || '{}')); }
  catch (_) { throw new Error(`${label}返回了非 JSON 数据`); }
  return data;
}

function readTargetField(data, names) {
  const sources = [object(data), object(data?.data), object(data?.result)];
  for (const source of sources) {
    for (const name of names) {
      const value = source[name];
      if (value !== undefined && value !== null && text(value)) return text(value);
    }
  }
  return '';
}

function targetReceipt(data) {
  const result = object(data?.result);
  const success = object(result.success);
  const failed = object(result.failed);
  const successFiles = Array.isArray(success.files) ? success.files : [];
  const failedFiles = Array.isArray(failed.files) ? failed.files : [];
  const successCount = Math.max(0, Number(success.count) || successFiles.length);
  const failedCount = Math.max(0, Number(failed.count) || failedFiles.length);
  const remoteId = readTargetField(data, ['task_id', 'taskId', 'job_id', 'jobId', 'queue_id', 'queueId', 'execution_id', 'executionId']);
  const remoteStatus = readTargetField(data, ['task_status', 'taskStatus', 'job_status', 'jobStatus', 'queue_status', 'queueStatus', 'status']).toLowerCase();
  if (data?.success !== true) throw new Error(data?.message || data?.msg || '121 上传失败');
  if (failedCount > 0) throw new Error(failedFiles.map(item => text(object(item).reason || object(item).message)).filter(Boolean).join('；') || `121 有 ${failedCount} 个文件上传失败`);
  if (Object.keys(result).length > 0 && successCount < 1 && !remoteId && !remoteStatus) throw new Error('121 未确认接收到上传文件');
  return {
    verified: successCount > 0 || Boolean(remoteId) || ['queued', 'queueing', 'running', 'executing', 'created'].includes(remoteStatus),
    upload_success_count: successCount,
    upload_failed_count: failedCount,
    remote_id: remoteId,
    remote_status: remoteStatus,
    message: text(data?.message || data?.msg)
  };
}

function summarizeRemoteBookRecord(data, bookId, fields, advanced) {
  if (data?.success !== true) throw new Error(data?.message || data?.msg || '121 列表核验失败');
  const rows = Array.isArray(data?.data) ? data.data : [];
  const record = rows.find(item => text(object(item).bookid) === text(bookId)) || null;
  if (!record) return { status: '待确认', found: false, detail: '121 上传接口已接收文件，但列表暂未返回该书号记录', mismatches: [] };
  const row = object(record);
  const jianData = parseTargetConfigData(row.jian_data);
  const actual = {
    platform_id: text(row.book_platform),
    gender: text(row.gender),
    style: text(row.style),
    jieya_num: Number(jianData?.jieya?.jieya_num ?? -1),
    gunping_num: Number(jianData?.gunping?.gunping_num ?? -1)
  };
  const expected = {
    platform_id: text(fields.platform_id),
    gender: text(fields.gender),
    style: text(fields.style),
    jieya_num: Number(advanced.jieyaNum),
    gunping_num: Number(advanced.gunpingNum)
  };
  const mismatches = Object.keys(expected).filter(key => expected[key] !== actual[key]);
  return {
    status: mismatches.length ? '待确认' : '完成',
    found: true,
    detail: mismatches.length ? `121 已找到记录，但参数待核对：${mismatches.join('、')}` : '121 后台已找到对应书号，平台、风格与素材数量一致',
    remote_id: text(row.id),
    remote_time: text(row.addtime),
    expected,
    actual,
    mismatches
  };
}

function create121WebSubmitService({
  accountResolver,
  createStore,
  browserClient,
  sessionStore,
  credentialStore,
  baseUrl = `http://${target.TARGET_HOST}/tttadmin`,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  if (typeof createStore !== 'function') throw new Error('createStore is required');
  if (!browserClient) throw new Error('browserClient is required');
  if (!sessionStore || typeof sessionStore.getBrowserSession !== 'function' || typeof sessionStore.setBrowserSession !== 'function') throw new Error('browser session store is required');
  if (!credentialStore || typeof credentialStore.get !== 'function' || typeof credentialStore.set !== 'function') throw new Error('browser credential store is required');
  const normalizedBaseUrl = text(baseUrl).replace(/\/$/, '');

  async function resources(owner) {
    const account = await Promise.resolve(accountResolver(owner));
    if (!account?.username || account.username !== owner) {
      const error = new Error(`账号 ${owner} 不存在或不可用`);
      error.status = 403;
      throw error;
    }
    return { account, store: createStore({ account }) };
  }

  function identity(owner, username) {
    return { owner, baseUrl: normalizedBaseUrl, username: text(username) };
  }

  function saveBrowserReference(owner, username, result) {
    return sessionStore.setBrowserSession(owner, {
      sessionKey: text(result?.sessionKey), targetUsername: text(username), baseUrl: normalizedBaseUrl, status: text(result?.status || 'ready')
    });
  }

  async function current(owner) {
    const { store } = await resources(owner);
    const config = object(await store.getConfig());
    return { store, config, web: normalizeSavedWebSubmit(config.web_submit, config.web_submit) };
  }

  async function ensureSession(owner, { headed = false } = {}) {
    const ref = sessionStore.getBrowserSession(owner);
    if (!ref?.targetUsername) {
      const error = new Error('请先保存账号密码并验证 121 浏览器登录会话');
      error.code = 'BROWSER_SESSION_MISSING';
      error.status = 409;
      throw error;
    }
    const request = { ...identity(owner, ref.targetUsername), headed };
    try {
      const result = await browserClient.test(request);
      saveBrowserReference(owner, ref.targetUsername, result);
      return { request, result };
    } catch (error) {
      const expired = error?.status === 401 || error?.code === 'session_expired' || error?.workerResponse?.status === 'expired';
      if (!expired || headed) throw error;
      const credentials = credentialStore.get(owner);
      if (!credentials?.password || text(credentials.targetUsername) !== text(ref.targetUsername)) {
        const missing = new Error('121 登录会话已失效，请重新保存账号密码');
        missing.code = 'BROWSER_CREDENTIALS_MISSING';
        missing.status = 401;
        throw missing;
      }
      const result = await browserClient.refresh({ ...request, password: credentials.password, headed: false });
      saveBrowserReference(owner, ref.targetUsername, result);
      return { request, result, refreshed: true };
    }
  }

  async function workerAction(owner, action, payload = {}) {
    const ready = await ensureSession(owner);
    return browserClient.action({ ...ready.request, action, payload });
  }

  async function getConfig(owner) {
    const { web } = await current(owner);
    return { settings: publicWebSubmit(web) };
  }

  async function saveConfig(owner, incoming = {}) {
    const { store, config } = await current(owner);
    const received = object(incoming);
    const existing = normalizeSavedWebSubmit(config.web_submit, config.web_submit);
    const web = normalizeSavedWebSubmit(config.web_submit, received);
    const password = typeof received.password === 'string' ? received.password : '';
    const changedUsername = Boolean(text(existing.username)) && text(web.username) !== text(existing.username);
    if (changedUsername && !password) throw new Error('更换 121 用户名后必须重新输入密码并重新登录');
    if (password) {
      if (!web.username) throw new Error('121 用户名不能为空');
      const result = await browserClient.login({ ...identity(owner, web.username), password, headed: false });
      saveBrowserReference(owner, web.username, result);
      credentialStore.set(owner, { targetUsername: web.username, password, baseUrl: normalizedBaseUrl });
      web.password_masked = true;
    }
    await store.saveConfig({ ...config, web_submit: web });
    return { ok: true, settings: publicWebSubmit(web), tasks: await store.listTasks(owner) };
  }

  async function environment(owner) {
    const ref = sessionStore.getBrowserSession(owner);
    if (!ref) return { ok: false, checks: [{ name: '目标站浏览器会话', ok: false, detail: '未登录' }, { name: 'Browser Worker', ok: browserClient.configured === true, detail: browserClient.configured === true ? '已配置' : '未配置' }] };
    try {
      await ensureSession(owner);
      return { ok: true, checks: [{ name: '目标站浏览器会话', ok: true, detail: '已登录' }, { name: 'Browser Worker', ok: true, detail: '会话验证通过' }] };
    } catch (error) {
      return { ok: false, checks: [{ name: '目标站浏览器会话', ok: false, detail: error?.message || '验证失败' }, { name: 'Browser Worker', ok: browserClient.configured === true, detail: browserClient.configured === true ? '已配置' : '未配置' }] };
    }
  }

  async function testVisible(owner) {
    const ref = sessionStore.getBrowserSession(owner);
    if (!ref?.targetUsername) throw new Error('请先保存账号密码并登录目标站');
    const result = await browserClient.test({ ...identity(owner, ref.targetUsername), headed: true });
    saveBrowserReference(owner, ref.targetUsername, result);
    return { ok: result?.ok === true, output: [], result: { checks: { login_session: result?.ok === true, browser_mode: 'headed' }, session_status: result?.status || '' } };
  }

  async function syncConfigs(owner) {
    const { store, config } = await current(owner);
    const response = await workerAction(owner, 'config_list');
    const payload = parseJsonBody(response, '121 配置档接口');
    if (payload.success !== true || !Array.isArray(payload.data)) throw new Error(payload.message || payload.msg || '121 配置档同步失败');
    const web = normalizeSavedWebSubmit(config.web_submit, config.web_submit);
    const styleCatalog = normalizeStyleCatalog(web.style_catalog);
    const styleById = Object.fromEntries([...styleCatalog, ...Object.entries(target.STYLE_ID).map(([name, id]) => ({ id: String(id), name }))].map(item => [String(item.id), item.name]));
    const profiles = payload.data.map((item, index) => {
      const source = object(item);
      const data = parseTargetConfigData(source.config_data);
      const gender = text(data.gender ?? source.gender);
      return {
        id: `121-${text(source.id || index + 1)}`,
        name: text(source.config_name || `121 配置档 ${index + 1}`),
        enabled: true,
        source: '121',
        config_id: text(source.id),
        is_default: Number(source.is_default) === 1,
        platform_id: text(data.platform_id ?? source.platform_id),
        gender: gender === '1' ? '男' : gender === '2' ? '女' : gender.replace('频', ''),
        style: styleById[String(data.style ?? source.style ?? '')] || text(data.style_name || source.style_name),
        advanced: importedAdvancedFromTarget(data)
      };
    }).filter(profile => profile.name && profile.config_id);
    const local = normalizeUploadProfiles(web.upload_profiles).filter(profile => profile.source !== '121');
    const nextWeb = { ...web, upload_profiles: [...local, ...profiles] };
    await store.saveConfig({ ...config, web_submit: nextWeb });
    return { ok: true, settings: publicWebSubmit(nextWeb), groups: profiles, output: [`已从 121 同步 ${profiles.length} 个配置档`] };
  }

  async function syncStyles(owner) {
    const { store, config } = await current(owner);
    const response = await workerAction(owner, 'dashboard');
    const catalog = parseTargetStyleCatalog(response?.body);
    if (!catalog.length) throw new Error('121 未返回可用风格类型');
    const old = Array.isArray(config.styles) ? config.styles : [];
    const styles = catalog.map(item => item.name);
    const nextWeb = { ...normalizeSavedWebSubmit(config.web_submit, config.web_submit), style_catalog: catalog };
    await store.saveConfig({ ...config, styles, web_submit: nextWeb });
    return { ok: true, settings: publicWebSubmit(nextWeb), styles, style_sync: { old_count: old.length, new_count: styles.length, added: styles.filter(name => !old.includes(name)), removed: old.filter(name => !styles.includes(name)) }, output: [`已从 121 同步 ${styles.length} 个风格类型`] };
  }

  async function selectedIds(store, owner, body) {
    const requested = Array.isArray(body?.ids) ? body.ids.map(text).filter(Boolean) : [];
    if (body?.mode === 'selected') return requested;
    const all = await store.listTasks(owner);
    if (body?.mode === 'failed') return all.filter(isFailed).map(idOf).filter(Boolean);
    return all.map(idOf).filter(Boolean);
  }

  async function buildPlan(owner, body = {}) {
    const { store, config } = await current(owner);
    const web = normalizeSavedWebSubmit(config.web_submit, config.web_submit);
    const ids = await selectedIds(store, owner, body);
    const versions = Array.isArray(body?.versions) && body.versions.length ? body.versions.map(text).filter(Boolean) : web.submit_versions;
    const groups = new Map();
    const skipped = [];
    const candidatesByBook = new Map();
    for (const id of ids) {
      const task = await store.getTask(owner, id);
      if (!task?.meta) { skipped.push({ id, status: 'failed', error: '任务不存在' }); continue; }
      for (const version of versions) {
        const content = await store.readVersionText(owner, id, version);
        if (!content) { skipped.push({ id, version, status: 'skipped', error: '未找到正文版本' }); continue; }
        if (web.min_text_chars > 0 && String(content).length < web.min_text_chars) { skipped.push({ id, version, status: 'file_too_small', error: `文案少于 ${web.min_text_chars} 字`, size: Buffer.byteLength(content) }); continue; }
        const done = Array.isArray(task.meta.siteSubmitDoneVersions) ? task.meta.siteSubmitDoneVersions : [];
        const accepted = Array.isArray(task.meta.siteSubmitAcceptedVersions) ? task.meta.siteSubmitAcceptedVersions : [];
        if (web.skip_submitted !== false && done.includes(version)) { skipped.push({ id, version, status: 'skipped', error: '该版本已确认提交' }); continue; }
        if (web.skip_submitted !== false && accepted.includes(version)) { skipped.push({ id, version, status: 'awaiting_confirmation', error: '121 已接收文件但尚未确认生成任务' }); continue; }
        const profile = selectVersionUploadProfile(web, task.meta, version);
        if (!profile) { skipped.push({ id, version, status: 'skipped', error: '版本配置模式：未找到可用的 121 配置档，请先同步配置档' }); continue; }
        const list = candidatesByBook.get(id) || [];
        list.push({ id, version, content, size: Buffer.byteLength(content), task, profile });
        candidatesByBook.set(id, list);
      }
    }
    for (const candidates of candidatesByBook.values()) {
      const allocations = target.distributeBookMaterials(web.advanced, candidates.length);
      candidates.forEach((candidate, index) => {
        const profileAdvanced = Object.keys(object(candidate.profile.advanced)).length ? target.normalizeAdvanced(candidate.profile.advanced) : allocations[index];
        const groupKey = `${text(candidate.task.meta.platformId)}-${text(candidate.task.meta.gender)}-${text(candidate.task.meta.style)}-${candidate.version}-${candidate.profile.id}`;
        const group = groups.get(groupKey) || { group_id: groupKey, group_key: groupKey, status: 'ready', version: candidate.version, summary: { ...candidate.task.meta, profile_id: candidate.profile.id, profile_name: candidate.profile.name }, advanced: profileAdvanced, items: [] };
        group.items.push({ id: candidate.id, version: candidate.version, size: candidate.size, advanced: profileAdvanced, profile_id: candidate.profile.id, profile_name: candidate.profile.name });
        groups.set(groupKey, group);
      });
    }
    return { store, config, web, material_limit: target.PER_BOOK_MATERIAL_LIMIT, groups: [...groups.values()], skipped };
  }

  async function preview(owner, body = {}) {
    const plan = await buildPlan(owner, body);
    return { material_limit: plan.material_limit, groups: plan.groups, skipped: plan.skipped };
  }

  async function submit(owner, body = {}) {
    const plan = await buildPlan(owner, body);
    if (plan.web.enabled !== true) throw new Error('网站提交尚未启用；请先保存账号并勾选“启用网站提交”');
    await ensureSession(owner);
    const submissionId = crypto.randomUUID().slice(0, 8);
    let successGroups = 0;
    let acceptedGroups = 0;
    let failedGroups = 0;
    const styleMap = styleMapFromCatalog(plan.web.style_catalog);
    for (const group of plan.groups) {
      group.group_key = group.group_id;
      group.group_id = `${group.group_id}-${submissionId}`;
      group.status = 'submitting';
      group.started_at = now();
      let groupFailed = false;
      let pending = false;
      for (const item of group.items) {
        const task = await plan.store.getTask(owner, item.id);
        const content = await plan.store.readVersionText(owner, item.id, item.version);
        try {
          const fields = target.buildUploadFields({ platformId: task.meta.platformId, gender: text(task.meta.gender).replace('频', ''), style: task.meta.style, advanced: item.advanced, styleMap });
          const filename = target.buildTargetUploadFilename(item.id);
          const multipart = target.buildMultipart(fields, { filename, content });
          let uploaded;
          let lastError;
          let attempts = 0;
          for (let attempt = 0; attempt <= plan.web.retry_times; attempt += 1) {
            attempts += 1;
            try {
              uploaded = await workerAction(owner, 'upload', { contentType: `multipart/form-data; boundary=${multipart.boundary}`, bodyBase64: multipart.body.toString('base64') });
              lastError = null;
              break;
            } catch (error) { lastError = error; }
          }
          if (lastError) throw lastError;
          const receipt = targetReceipt(parseJsonBody(uploaded, '121 上传接口'));
          try {
            const lookup = parseJsonBody(await workerAction(owner, 'book_list', { bookId: item.id, page: 1, pageSize: 10 }), '121 列表核验');
            receipt.remote_record = summarizeRemoteBookRecord(lookup, item.id, fields, item.advanced);
          } catch (error) {
            receipt.remote_record = { status: '待确认', found: false, detail: error?.message || '121 后台记录核验失败', mismatches: [] };
          }
          if (receipt.verified) {
            await plan.store.updateTaskMeta(owner, item.id, {
              siteSubmitStatus: 'submitted',
              siteSubmitDoneVersions: [...new Set([...(task.meta.siteSubmitDoneVersions || []), item.version])],
              siteSubmitAcceptedVersions: (task.meta.siteSubmitAcceptedVersions || []).filter(version => version !== item.version),
              siteSubmitFailedVersions: (task.meta.siteSubmitFailedVersions || []).filter(version => version !== item.version)
            });
            item.status = 'submitted';
          } else {
            pending = true;
            await plan.store.updateTaskMeta(owner, item.id, {
              siteSubmitStatus: 'accepted_pending',
              siteSubmitAcceptedVersions: [...new Set([...(task.meta.siteSubmitAcceptedVersions || []), item.version])],
              siteSubmitFailedVersions: (task.meta.siteSubmitFailedVersions || []).filter(version => version !== item.version)
            });
            item.status = 'accepted_pending';
          }
          item.attempts = attempts;
          item.remote_receipt = receipt;
          await plan.store.appendSiteSubmitLog(owner, item.id, { version: item.version, status: item.status, remote_receipt: receipt, time: now() });
        } catch (error) {
          groupFailed = true;
          item.status = 'failed';
          item.error = error?.message || '提交失败';
          await plan.store.updateTaskMeta(owner, item.id, {
            siteSubmitStatus: 'failed',
            siteSubmitFailedVersions: [...new Set([...(task?.meta?.siteSubmitFailedVersions || []), item.version])]
          });
          await plan.store.appendSiteSubmitLog(owner, item.id, { version: item.version, status: 'failed', error: item.error, time: now() });
        }
      }
      group.status = groupFailed ? 'failed' : (pending ? 'accepted_pending' : 'submitted');
      if (groupFailed) failedGroups += 1;
      else if (pending) acceptedGroups += 1;
      else successGroups += 1;
      group.completed_at = now();
    }
    return {
      ok: failedGroups === 0,
      material_limit: plan.material_limit,
      groups: plan.groups,
      skipped: plan.skipped,
      success_groups: successGroups,
      accepted_groups: acceptedGroups,
      failed_groups: failedGroups,
      tasks: await plan.store.listTasks(owner),
      summary: { submitted: successGroups, accepted_pending: acceptedGroups, failed: failedGroups }
    };
  }

  return { getConfig, saveConfig, environment, testVisible, syncConfigs, syncStyles, ensureSession, preview, submit };
}

module.exports = { create121WebSubmitService, publicWebSubmit, normalizeSavedWebSubmit, parseTargetStyleCatalog, targetReceipt, summarizeRemoteBookRecord };
