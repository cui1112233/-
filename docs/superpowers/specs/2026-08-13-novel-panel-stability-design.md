# 小说面板稳定化设计

## 目标

修复 V77 小说面板前端已经调用、但 Express 尚未实现的 CharacterCore 接口；让模型请求的等待上限在服务端真正生效；防止同一项目或同一功能的重复请求互相覆盖；把 iframe 中不可用的本地草稿替换为账号隔离的后端草稿。

本次不重写 V77 工作台，不改人物生成语义、分镜质量门或现有项目数据格式。

## 范围

1. 实现 `parse-slots`：仅解析用户填写的强制人物名单，返回稳定槽位、别称和年龄阶段提示；不调用模型，不凭空推断关系。
2. 实现 `project-lease`：按账号、项目和浏览器实例维护内存租约，支持 acquire、heartbeat、release；租约过期后可重新取得。服务重启时租约自然失效，项目数据仍以现有 JSON 存储为准。
3. 实现 `migrate-project`：把旧项目的 `characters` 和已存在的 CharacterCore 数据转换为最小兼容的 CharacterCore 2.0 结构。转换只在打开旧项目时返回，不自动覆盖原项目；保存仍走现有项目接口。
4. 为模型请求增加服务端超时和客户端断开取消。每个上游请求携带 `AbortSignal`；达到当前账号设置的 30-400 秒上限或浏览器断开时，销毁上游连接并返回可区分的错误。
5. 增加按账号 + 业务操作的进行中登记。相同操作尚未完成时返回冲突信息，避免重复点击；不同功能可并行。前端识别冲突后保留当前结果并显示“正在处理”。
6. 增加账号隔离的后端草稿接口。工作台的自动草稿改为节流保存至后端；读取失败时保持空白初始状态，不再尝试 iframe `localStorage`。

## 接口设计

### CharacterCore 兼容接口

- `POST /api/novel-panel/character-core/parse-slots`
  - 输入：`guide_text`、`novel_text`、`source_hash`。
  - 输出：`{ slots, slot_count, source_hash }`。
  - `slots` 保留前端所需的 `slot_id`、`slot_token`、`source_entry`、`display_name`、`base_name`、`aliases`、`age`、`manual_values` 与空的生成字段。
- `POST /api/novel-panel/character-core/project-lease`
  - 输入：`action`、`project_id`、`instance_id`、可选 `force`。
  - 输出：是否取得租约、当前持有实例及到期时间；非持有者不得续租或释放。
- `POST /api/novel-panel/character-core/migrate-project`
  - 输入：旧 `project`、`guide_text`、`novel_text`。
  - 输出：`{ migrated, character_core }`。已有 v2 数据时原样规范化返回。

### 草稿接口

- `GET /api/novel-panel/draft`：返回当前账号最后草稿或 `draft: null`。
- `PUT /api/novel-panel/draft`：保存受大小和 JSON 安全校验约束的草稿快照。
- 草稿只作为“未手动保存项目”的恢复点；明确点击“保存项目”仍是正式项目写入。

## 请求生命周期

1. 前端发送请求时保留现有按钮忙碌状态和 30-400 秒显示。
2. 服务端读取同一账号的面板超时设置，向 `requestUpstream` 传入超时和 `AbortSignal`。
3. 浏览器请求关闭、超时或 Express 响应结束前，上游连接均会被销毁。
4. 同一账号的相同 AI 操作有进行中标识。重复请求返回 HTTP 409 和稳定错误码；已完成或失败后释放标识。
5. 模型 JSON 解析或质量门失败时维持现有约定：返回错误或 `applied: false`，前端不覆盖已有结果。

## 错误处理

- 超时返回 HTTP 504，并明确提示“服务端已停止本次模型请求”。
- 客户端取消不写入项目、不重试。
- 可重试的网络错误由 CharacterCore 保持现有至多一次重试；非幂等模型操作不做后端自动重试。
- 租约冲突返回 HTTP 409，包含持有实例的非敏感标识与可再次取得编辑权的提示。
- 草稿错误不影响正式项目保存；草稿体积或格式异常直接拒绝。

## 测试与验收

1. 单元测试槽位解析、租约获取/续期/释放/过期和旧项目迁移。
2. 契约测试：所有工作台 CharacterCore 路径都有对应 Express 接口。
3. 请求测试：上游超时会销毁连接；同一账号同操作重复请求返回 409；完成后可再次请求。
4. 草稿测试：账号隔离、写入读取和非法草稿拒绝。
5. 运行既有小说面板项目存储、质量门和资产契约测试，并在真实浏览器验证小说面板不再出现 localStorage 安全警告，强制名单人物卡请求不再 404。

## 非目标

- 不引入 Redis、数据库或跨机器队列。
- 不改变模型供应商、API Key 或系统预设词管理。
- 不自动修复模型输出不符合人物或分镜质量门的语义问题。
