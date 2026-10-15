# 公网自动化启动恢复

## 范围

用户授权修复启动故障，并完成、上传 tanglu、zhangying、qiuwanjing 当日三个批次（1+8+8 本）。
操作前各批次无生产任务；不重建批次，不触碰历史完成视频。

## 根因和恢复

- 实际启动接口返回 500；MySQL performance_schema 记录缺少 batch_factory_v11_shuihuo_configs。
- 按运行二进制 7df6290b 内嵌的准确建表语句增加缺表后，启动返回 201。
- tanglu 1 本、zhangying 8 本缺正文，逐书 fetch-original 成功，重新读取确认保存。
- 动态文本提供方实际从 novel_fetch_workshop_configs 读取模型目录，而非批次的 settings。
  原记录只有 snake_case 的 text_model_id，缺少 Go 读取的 modelCatalog/textModelId。
  所以预设选择 custom-a-gemini-3-7-flash 时仍退回旧全局提供方，返回 HTTP 401。
- 保留原 workshop 字段，仅投影已有团队授权目录和当前批次原选模型；未添加新授权。
- 原配置文件所选模型的 /models、最小 chat/completions 真实请求均 200。
- 首次仅恢复 Shuihuo 表和兼容文件目录不能修复实际动态提供方；最终补齐 workshop 投影后，
  任务推进到 audio_planning/assets，尚须逐本验证视频供应商回执与上传回读。

## Git 与备份

schema 修复 551766df，授权恢复脚本 39d9641b（含前序修复），已推送 origin/v88。
脚本不输出凭据；已有非空且冲突的目录拒绝覆盖，保留原配置其它字段。
备份位于 /opt/qiantie/backups/automation/20261015T101552Z 与 models-* 子目录。
其中 SQL/账号模型配置含私密信息，仅留服务器，不进入 Git。
未重建或替换缺失源码的公网 Go 后端，未重启服务。

## 验收边界

启动恢复不等于生产或发布完成。只有真实视频回执、合并成品及视频管理系统回读可证明完成。
当前运行后端完整源码不在 V88；永久修复模型继承和建表启动链仍需收回确切源码。
