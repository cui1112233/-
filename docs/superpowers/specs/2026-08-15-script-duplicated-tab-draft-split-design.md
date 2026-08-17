# 剧本复制标签页草稿自动拆分设计

## 目标

解决浏览器“复制标签页”会复制 `sessionStorage` 的问题：复制出的剧本页不得继续使用原标签页的草稿 ID，也不得覆盖原页面的小说、人物、场景或输出。

## 根因

当前剧本草稿使用 `sessionStorage` 中的 `qiantie:script-draft-tab-id` 作为标签页 ID。浏览器复制标签页时会复制该会话存储，因此原页面与复制页面拥有相同 ID，并读写同一个账号草稿键。

## 方案

剧本页挂载时使用 `BroadcastChannel('qiantie:script-draft-tabs')` 进行占用探测。

1. 页面读取当前 `tabId` 后，生成一次随机 `instanceId`；
2. 页面发送 `probe` 消息：`{ type: 'probe', tabId, instanceId }`；
3. 已打开的剧本页若持有相同 `tabId` 且 `instanceId` 不同，发送 `occupied` 响应；
4. 探测窗口内收到 `occupied` 的页面视为复制标签页：生成新的 `tabId`，覆盖当前标签自己的 `sessionStorage` 值；
5. 复制页在切换到新 ID 后重新加载该 ID 的草稿。由于新 ID 没有独立草稿，沿用当前旧草稿迁移规则初始化；原标签页的 ID 与草稿完全不变；
6. 未收到响应的页面保留当前 ID，因此普通刷新、普通导航离开再返回同一个标签页仍恢复原草稿。

## 约束

- 探测只在 `/script` 页面挂载时执行。
- 使用短暂等待窗口；检测完成后关闭 `BroadcastChannel`，不保留跨页监听器。
- 浏览器不支持 `BroadcastChannel` 时，不阻断页面；维持现有 `sessionStorage` 行为。
- 当前页面在 ID 被拆分前不得自动保存，避免复制页在探测期间覆盖原草稿。
- 复制页拆分后，后续保存、TXT 导入、实体编辑、生成输出与页面退出保存均使用新 ID。
- 不修改 `saveHistory`、AI 请求、后端协议、历史数据结构或草稿存储键格式。
- 不增加草稿列表、项目命名、跨标签同步或用户可见提示。

## 验证

- 同 tabId 的两个模拟页面可通过占用探测识别复制页；复制页拿到新 ID，原页面 ID 不变；
- 无占用响应时保留原 ID；
- `BroadcastChannel` 不可用时不会抛出；
- ScriptPage 在完成 ID 探测后才调用 `loadScriptDraft` 与启动自动保存；
- 原标签页与复制标签页分别保存小说 A / B 后，刷新各自只恢复自己的内容；
- 历史保存调用仍不带 `tabId`。
