# Yadi 共用视频模型接入说明

## 目标

Yadi 是模型/凭据基础设施，不是剧本生成或批量工厂的业务逻辑。

固定原则：

- 用户只在「个人中心 → 视频生成模型」保存一次 Yadi OpenAPI Key。
- 剧本生成的分镜卡与批量工厂的 VIDEO 任务共同读取当前账号这一份 Key。
- 剧本生成与批量工厂仍然是两条独立业务链，不共享导演 Prompt、状态机或页面逻辑。
- 浏览器、任务 input snapshot、日志、模型目录响应都不得包含保存后的明文 API Key。

## 用户操作

1. 打开「个人中心」。
2. 进入「视频生成模型」。
3. 在「Yadi 视频生成」卡片输入令牌管理创建的 `sk-yadi-...` API Key。
4. 点击「保存视频模型密钥」。
5. 页面只返回「已配置 / 未配置」，不会回显旧 Key。
6. 保存后，剧本生成和批量工厂选择 Yadi 模型即可生成视频。
7. 用户可在个人中心清除 Key；清除后新的 Yadi 任务会在进入队列前被拒绝。

Cookie、Yadi 主站登录态、控制台登录 token 都不是 OpenAPI 视频任务凭据，不能保存为该 Key。

## 模型

系统迁移自动注册：

- stable model key: `yadi-yd2-0-fast`
- display name: `YD2.0 Fast（Yadi 文生视频）`
- adapter: `yadi_video`
- upstream model: `yd2.0-fast`
- resolution: `720p`
- max VIDEO duration: `15s`
- aspect ratio: `9:16` / `16:9`
- credential ref: `user:yadi`

当前 `yd2.0-fast` 以文生视频方式提供给批量工厂，因此不要求参考图。Yadi OpenAPI 本身支持 `image_urls`；未来新增需要参考图的模型时，应在独立模型能力中声明，而不是修改批量工厂的导演逻辑。

## OpenAPI

创建：

```text
POST https://ydapi.yadiai.cn/openapi/v1/video/create
Authorization: Bearer <当前任务用户保存的 Yadi API Key>
Content-Type: application/json
```

请求：

```json
{
  "model": "yd2.0-fast",
  "prompt": "当前 VIDEO 最终编译提示词",
  "duration": "15",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "image_urls": [],
  "video_urls": [],
  "audio_urls": []
}
```

创建返回 `taskId` 后，将 provider task ID 保存到当前 Qiantie task。

结果查询：

```text
GET https://ydapi.yadiai.cn/openapi/v1/video/tasks/{taskId}/result
Authorization: Bearer <同一任务用户保存的 Yadi API Key>
```

Poller 按任务 `user_id` 重新解析当前账号密钥，成功后下载远端视频并写入 Qiantie 对象存储和 media 记录。

## 密钥安全

表：`shuihuo_user_model_credentials`

唯一键：

```text
(user_id, credential_ref)
```

Yadi 使用：

```text
credential_ref = user:yadi
```

密钥使用 AES-GCM 加密后保存。GET API 只返回：

```json
{
  "provider": "yadi",
  "configured": true
}
```

不会返回密钥正文。

任务只记录：

```text
userId
modelId
modelVersionId
prompt
duration
aspectRatio
providerTaskId
```

不会把 API Key 写进任务 input/output snapshot。

## 任务链

```text
用户点击生成视频
→ 根据 modelId 获取 Yadi model version
→ 检查当前 user_id 是否已配置 user:yadi
→ 未配置：立即返回“请先在个人中心配置 Yadi 视频生成 API Key”
→ 已配置：建立/排队 Qiantie task
→ Worker 根据 task.UserID 取密钥
→ POST Yadi create
→ 保存 taskId
→ Yadi Poller 查询 result
→ 下载最终视频
→ 写入 Qiantie media
→ 前端沿现有任务状态/播放器展示结果
```

因此：

```text
剧本生成分镜卡 → createTask → Yadi
批量工厂 VIDEO → createTask/createBatchTasks → Yadi
```

两边共享的只有 `model + user credential + task worker/poller`。

## 批量工厂行为

批量工厂仍按自己的独立规则运行：

```text
小说01 VIDEO01
→ VIDEO02
→ VIDEO03
→ 小说02 VIDEO01
→ ...
```

选择 Yadi 后，每个 VIDEO 的 `compiledPrompt` 在提交前动态生成，再作为 Yadi `prompt`。统一设置里的画幅和 VIDEO 秒数进入 Yadi `aspect_ratio` / `duration`。

Yadi Key 不属于「生产统一设置」，因为它是当前账号级凭据；用户不需要给每个批次重复配置。

## 剧本生成行为

剧本生成保留现有分镜卡的「生成视频」交互。只要该交互通过 Shuihuo Production 的视频 task 接口提交选中的 `modelId`，选择 `yadi-yd2-0-fast` 时会自动走同一个 Yadi adapter 和当前用户 Key。

不要在 ScriptPage 或分镜卡组件里增加第二个 Yadi API Key 输入框。

## 返回结构兼容

用户提供的接口文档明确创建返回 `taskId`，但尚未提供生产环境完整 JSON 示例。当前 adapter 对以下常见包装做兼容：

- `taskId`
- `task_id`
- `data.taskId`
- `data.task_id`
- `result.taskId`
- `id`

状态与最终视频 URL 同样支持常见顶层/`data`/`result` 包装。

正式线上冒烟时，应使用真实 Yadi Key 发起一个最小任务，保存真实 create/result 响应样例；如字段与当前兼容解析不同，只修改 Yadi adapter，不修改剧本生成或批量工厂业务层。

## 合并前检查

- 前端可以构建。
- Go 所有 package 可以编译。
- Yadi provider 单测通过。
- 用户密钥 AES-GCM 单测通过。
- 原 Batch Factory tests 通过。
- 没有任何 `sk-yadi-...` 真密钥提交到 Git。
- 没有修改 master；本功能只在 `09-batch-factory-independent-pipeline`。
