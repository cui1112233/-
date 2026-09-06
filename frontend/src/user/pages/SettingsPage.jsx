import { Button, Form, Input, List, Select, Slider, Switch, Typography, message } from 'antd';
import { Download, FolderOpen, RefreshCw, Save, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConfig, saveConfig } from '../../shared/api/config';
import { getCurrentUsername } from '../../shared/api/auth';
import { apiRequest } from '../../shared/api/client';
import { executorVersionStatus, fetchExecutorReleaseManifest } from '../../shared/api/executorRelease';
import { PET_COMPANION_SETTINGS_EVENT, readCompanionSpeechState, writeCompanionSpeechState } from '../../shared/pet/companionSpeech';
import { DEFAULT_PET_ID, dispatchPetSelection, getPetDefinition, getPetOptions, previewPetSelection } from '../../shared/pet/petCatalog';

const petOptions = getPetOptions();

export function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [savingSection, setSavingSection] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [listing, setListing] = useState(false);
  const [restoreReport, setRestoreReport] = useState(null);
  const [fileList, setFileList] = useState(null);
  const [localExecutors, setLocalExecutors] = useState([]);
  const [loadingExecutors, setLoadingExecutors] = useState(false);
  const [executorRelease, setExecutorRelease] = useState(null);
  const [loadingExecutorRelease, setLoadingExecutorRelease] = useState(false);
  const [executorReleaseError, setExecutorReleaseError] = useState('');
  const [pairing, setPairing] = useState(null);
  const [companionActive, setCompanionActive] = useState(() => readCompanionSpeechState(getCurrentUsername()).active);
  const username = getCurrentUsername();
  const soundEnabled = Form.useWatch('soundEnabled', form);
  const soundVolume = Form.useWatch('soundVolume', form);
  const soundVolumePercent = Number.isFinite(soundVolume) ? Math.round(soundVolume) : 60;

  useEffect(() => {
    setCompanionActive(readCompanionSpeechState(username).active);
  }, [username]);

  async function loadLocalExecutors() {
    setLoadingExecutors(true);
    try {
      const result = await apiRequest('/api/shuihuo-production/local-executors', { suppressGlobalError: true });
      setLocalExecutors(Array.isArray(result.executors) ? result.executors : []);
    } catch (error) {
      message.error(error.message || '读取本地执行器失败');
    } finally { setLoadingExecutors(false); }
  }

  async function loadExecutorRelease({ silent = false } = {}) {
    setLoadingExecutorRelease(true);
    try {
      const release = await fetchExecutorReleaseManifest();
      setExecutorRelease(release);
      setExecutorReleaseError('');
    } catch (error) {
      setExecutorRelease(null);
      setExecutorReleaseError(error.message || '读取执行器版本信息失败');
      if (!silent) message.error(error.message || '读取执行器版本信息失败');
    } finally {
      setLoadingExecutorRelease(false);
    }
  }

  async function refreshLocalExecutorStatus() {
    await Promise.all([loadLocalExecutors(), loadExecutorRelease()]);
  }

  useEffect(() => {
    loadLocalExecutors();
    loadExecutorRelease({ silent: true });
  }, []);

  async function createLocalExecutorPairing() {
    try {
      const result = await apiRequest('/api/shuihuo-production/local-executors/pairings', { method: 'POST', body: JSON.stringify({ platform: 'doubao' }), suppressGlobalError: true });
      setPairing(result);
      message.success('配对码已生成，请在本地执行器中输入');
    } catch (error) { message.error(error.message || '生成配对码失败'); }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getConfig()
      .then(config => {
        if (!alive) return;
        form.setFieldsValue({
          storageRoot: config.storageRoot || '',
          petId: getPetDefinition(config.pet).id,
          soundEnabled: config.notifications?.soundEnabled !== false,
          soundVolume: Number.isFinite(config.notifications?.soundVolume) ? config.notifications.soundVolume : 60,
          petVisible: config.notifications?.petVisible !== false
        });
      })
      .catch(error => message.error(error.message || '读取设置失败'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [form]);

  async function saveSection(section) {
    let values;
    try {
      if (section === 'workspace') {
        const result = await form.validateFields(['petId', 'soundEnabled', 'soundVolume', 'petVisible']);
        values = {
          pet: result.petId,
          notifications: {
            soundEnabled: result.soundEnabled !== false,
            soundVolume: Number.isFinite(result.soundVolume) ? result.soundVolume : 60,
            petVisible: result.petVisible !== false
          }
        };
      } else if (section === 'storage') {
        const result = await form.validateFields(['storageRoot']);
        values = { storageRoot: result.storageRoot || '' };
      }
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '保存失败');
      return;
    }

    setSavingSection(section);
    try {
      const saved = await saveConfig(values);
      if (section === 'workspace') {
        window.dispatchEvent(new CustomEvent('qiantie:notifications-updated', { detail: saved.notifications }));
        dispatchPetSelection(saved.pet || values.pet);
      }
      message.success(`${({ workspace: '工作台设置', storage: '本地存储' })[section]}已保存`);
    } catch (error) {
      message.error(error.message || '保存失败');
    } finally {
      setSavingSection(null);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    setRestoreReport(null);
    try {
      const report = await apiRequest('/api/storage/restore', { method: 'POST' });
      setRestoreReport(report);
      message.success(`恢复完成：剧本并入 ${report.scriptResults?.added ?? 0} 条`);
    } catch (error) {
      message.error(error.message || '恢复失败');
    } finally {
      setRestoring(false);
    }
  }

  async function handleList() {
    setListing(true);
    setFileList(null);
    try {
      const list = await apiRequest('/api/storage/list');
      setFileList(list);
    } catch (error) {
      message.error(error.message || '读取文件清单失败');
    } finally {
      setListing(false);
    }
  }

  return (
    <div className="utility-page settings-page">
      <div className="settings-workbench">
        <div className="settings-heading">
          <div>
            <Typography.Title level={3}>工作台设置</Typography.Title>
            <Typography.Paragraph>管理前贴桌面宠物、工作提醒、本地视频执行器与服务器归档。模型服务统一在个人中心配置。</Typography.Paragraph>
          </div>
          <span className="settings-status">本账号配置</span>
        </div>
      <Form
        className="settings-form"
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={{ storageRoot: '', petId: DEFAULT_PET_ID, soundEnabled: true, soundVolume: 60, petVisible: true }}
      >
        <section className="settings-section settings-model-section" aria-labelledby="settings-model-title">
          <div>
            <h2 id="settings-model-title">工作台与桌面宠物</h2>
            <p>管理桌面宠物和工作完成提醒。</p>
          </div>
          <Form.Item label="前贴宠物" name="petId">
            <Select options={petOptions} onChange={value => previewPetSelection(value)} />
          </Form.Item>
          <Form.Item label="提示音" name="soundEnabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary">用于在剧本人物/场景提取完成、剧本生成完成时提醒；提取或生成失败（如网络、404、鉴权错误）时播放警示音。</Typography.Paragraph>
          <Form.Item label="提示音音量">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Form.Item name="soundVolume" noStyle>
                <Slider min={0} max={100} step={1} value={soundVolume} disabled={!soundEnabled} tooltip={{ formatter: value => `${value}%` }} style={{ flex: 1 }} />
              </Form.Item>
              <Typography.Text>{soundVolumePercent}%</Typography.Text>
            </div>
          </Form.Item>
          <Form.Item label="显示桌面宠物" name="petVisible" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary">控制右下角桌面宠物是否显示，关闭后可减少界面干扰。</Typography.Paragraph>
          <PetPreview form={form} />
          <Form.Item label="宠物主动说话" valuePropName="checked">
            <Switch checked={companionActive} onChange={checked => {
              setCompanionActive(checked);
              writeCompanionSpeechState(username, { ...readCompanionSpeechState(username), active: checked, nextIdleAt: 0 });
              window.dispatchEvent(new CustomEvent(PET_COMPANION_SETTINGS_EVENT, { detail: { active: checked, username } }));
            }} />
          </Form.Item>
          <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('workspace')} loading={savingSection === 'workspace'}>保存工作台与宠物</Button>
        </section>

        <section className="settings-section settings-storage-section" aria-labelledby="settings-storage-title">
          <div>
            <h2 id="settings-storage-title">服务器归档文件夹</h2>
            <p>指定服务器保存剧本、小说与制作工程的归档目录，留空表示关闭；不会改变网页用户的浏览器下载位置。</p>
          </div>
          <Form.Item label="服务器归档路径" name="storageRoot" extra="必须是服务器可访问的绝对路径；留空表示关闭服务器归档。">
            <Input placeholder="例如 /data/qiantie-archive" />
          </Form.Item>
          <div className="settings-storage-actions">
            <Button type="primary" icon={<Save size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={() => saveSection('storage')} loading={savingSection === 'storage'}>保存存储设置</Button>
            <Button icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleRestore} loading={restoring}>恢复</Button>
            <Button icon={<FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={handleList} loading={listing}>查看文件清单</Button>
          </div>
          {restoreReport && (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>恢复报告</Typography.Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--legacy-muted)', fontSize: 13, lineHeight: 1.7 }}>
                <li>剧本生成：找到 {restoreReport.scriptResults?.found ?? 0} 个，新并入历史 {restoreReport.scriptResults?.added ?? 0} 条</li>
                <li>小说获取：{restoreReport.novelFetch?.found ?? 0} 个文件</li>
                <li>改编小说：{restoreReport.novelAdapt?.found ?? 0} 个文件</li>
                <li>制作工程：{restoreReport.projects?.found ?? 0} 个项目</li>
              </ul>
              {Array.isArray(restoreReport.errors) && restoreReport.errors.length > 0 && (
                <Typography.Paragraph type="danger" style={{ margin: '8px 0 0', fontSize: 13 }}>错误：{restoreReport.errors.join('；')}</Typography.Paragraph>
              )}
            </div>
          )}
          {fileList && (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong>文件清单</Typography.Text>
              <List
                size="small"
                style={{ marginTop: 8 }}
                dataSource={[
                  { key: 'scriptResults', title: '剧本生成', files: fileList.scriptResults || [] },
                  { key: 'novelFetch', title: '小说获取', files: fileList.novelFetch || [] },
                  { key: 'novelAdapt', title: '改编小说', files: fileList.novelAdapt || [] },
                  { key: 'projects', title: '制作工程', projects: fileList.projects || [] }
                ]}
                renderItem={group => (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <Typography.Text strong>{group.title}（{group.projects ? group.projects.length : group.files.length}）</Typography.Text>
                      <List
                        size="small"
                        dataSource={group.projects || group.files}
                        locale={{ emptyText: '（空）' }}
                        renderItem={item => (
                          <List.Item style={{ padding: '2px 0', borderBottom: 'none' }}>
                            {group.projects
                              ? `${item.name}/（${(item.files || []).length} 个文件）`
                              : `${item.name}（${item.size}B）`}
                          </List.Item>
                        )}
                      />
                    </div>
                  </List.Item>
                )}
              />
            </div>
          )}
        </section>

        <section className="settings-section settings-executor-section" aria-labelledby="settings-executor-title">
          <div>
            <h2 id="settings-executor-title">豆包本地执行器</h2>
            <p>本机账号登录状态只保存在本地，平台仅接收任务状态和视频结果。请先下载客户端，再生成配对码完成绑定。</p>
          </div>
          <div className="settings-executor-layout">
            <div className="settings-executor-status">
              <div className="settings-executor-icon"><Video size={20} /></div>
              <div>
                <strong>本机视频执行通道</strong>
                <span>{localExecutors.length} 台已配对 · {localExecutors.filter(item => item.online).length} 台在线</span>
                <span>最新稳定版：{executorRelease?.latestVersion || '暂不可用'}{executorRelease?.minimumVersion ? ` · 最低支持版：${executorRelease.minimumVersion}` : ''}</span>
              </div>
            </div>
            {executorReleaseError ? <Typography.Paragraph type="warning" style={{ margin: 0 }}>版本信息暂不可用，请刷新后再下载。</Typography.Paragraph> : null}
            {localExecutors.length > 0 ? (
              <List
                size="small"
                dataSource={localExecutors}
                renderItem={item => {
                  const versionState = executorVersionStatus(item.version, executorRelease || {});
                  const versionLabel = !executorRelease
                    ? '发布信息暂不可用'
                    : !versionState.versionKnown
                      ? '版本未知'
                      : versionState.updateRequired
                        ? '必须更新'
                        : versionState.updateAvailable
                          ? '有新版本'
                          : '已是最新';
                  return (
                    <List.Item>
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <div>
                          <Typography.Text strong>{item.name || '本地执行器'}</Typography.Text>
                          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                            {item.online ? '在线' : '离线'} · 当前版本：{item.version || '未知'}
                          </Typography.Paragraph>
                        </div>
                        <Typography.Text type={versionState.updateRequired ? 'danger' : versionState.updateAvailable ? 'warning' : 'secondary'}>{versionLabel}</Typography.Text>
                      </div>
                    </List.Item>
                  );
                }}
              />
            ) : null}
            {pairing ? <p className="settings-executor-pairing">请在本地执行器中输入配对码：<strong>{pairing.code}</strong></p> : null}
            <div className="settings-executor-actions">
              <Button href="yizhan-executor://open">打开执行器</Button>
              <Button icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />} onClick={refreshLocalExecutorStatus} loading={loadingExecutors || loadingExecutorRelease}>刷新状态</Button>
              <Button type="primary" onClick={createLocalExecutorPairing}>生成配对码</Button>
              <Button icon={<Download size={16} strokeWidth={1.8} aria-hidden="true" />} href={executorRelease?.downloads?.mac || undefined} disabled={!executorRelease?.downloads?.mac} loading={loadingExecutorRelease}>下载 Mac 版</Button>
              <Button icon={<Download size={16} strokeWidth={1.8} aria-hidden="true" />} href={executorRelease?.downloads?.windows || undefined} disabled={!executorRelease?.downloads?.windows} loading={loadingExecutorRelease}>下载 Windows 版{executorRelease?.latestVersion ? ` v${executorRelease.latestVersion}` : ''}</Button>
            </div>
          </div>
        </section>

      </Form>
      </div>
    </div>
  );
}

function PetPreview({ form }) {
  const petId = Form.useWatch('petId', form) || DEFAULT_PET_ID;
  const pet = getPetDefinition(petId);
  return (
    <div className="settings-pet-preview" aria-label={`当前前贴宠物 ${pet.displayName}`}>
      <div className="settings-pet-frame">
        <img src={pet.spritesheetPath} alt={pet.displayName} style={{ imageRendering: pet.renderMode === 'smooth' ? 'auto' : undefined }} />
      </div>
      <div>
        <Typography.Text strong>{pet.displayName}</Typography.Text>
        <Typography.Paragraph type="secondary">{pet.description}</Typography.Paragraph>
      </div>
    </div>
  );
}

export default SettingsPage;
