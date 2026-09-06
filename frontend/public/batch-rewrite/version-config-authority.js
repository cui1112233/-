// 版本对应配置档：单一权威保存链路。
// app.js 仍保留通用配置/网站提交保存入口；本文件只接管“保存版本配置”按钮，
// 将本次版本选择、AI 槽位、提示词、121 配置档绑定合并为一次 /api/config 持久化。

async function saveVersionConfigAuthority() {
  clearTimeout(workFormSaveTimer);
  workFormSaveTimer = null;

  syncVersionPromptConfigToForm();
  const formState = collectWorkFormState();
  const appConfig = syncFormToAppConfig();
  appConfig.work_form = formState;
  appConfig.web_submit = syncFormToWebSubmitConfig();
  appConfig.knowledge = state.config?.knowledge || {};

  const result = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ app_config: appConfig }),
  });
  if (!result?.config) throw new Error("保存成功但服务端未返回最新版本配置");

  // 服务端回读结果才是权威状态，禁止继续使用保存前的旧 state.config。
  state.config = result.config;
  try {
    localStorage.setItem(WORK_FORM_STORAGE_KEY, JSON.stringify(formState));
  } catch {
    // 浏览器禁用 localStorage 时仍以服务端配置为准。
  }
  return result.config;
}

async function confirmWebSubmitSelectionAuthority() {
  const status = $("webSubmitSelectionStatus");
  const versions = selectedProcessVersions();
  if (!versions.length) {
    if (status) status.textContent = "请至少选择一个文案版本";
    return;
  }

  if (status) status.textContent = "正在保存版本配置...";
  const button = $("confirmWebSubmitSelectionBtn");
  if (button) button.disabled = true;
  try {
    await saveVersionConfigAuthority();
    updateVersionConfigSummary();
    if (status) status.textContent = "版本配置已保存";
    window.setTimeout(closeVersionConfigCard, 120);
  } catch (error) {
    if (status) status.textContent = error.message || "版本配置保存失败";
  } finally {
    if (button) button.disabled = false;
  }
}

function bindVersionConfigAuthority() {
  const button = $("confirmWebSubmitSelectionBtn");
  if (button) button.onclick = confirmWebSubmitSelectionAuthority;
}

// app.js 的 init() 会先同步绑定旧处理器，再在 loadConfig() 处让出事件循环；
// 本脚本紧随 app.js 加载，因此这里覆盖按钮处理器即可确保用户只走单一保存入口。
bindVersionConfigAuthority();
window.setTimeout(bindVersionConfigAuthority, 0);
