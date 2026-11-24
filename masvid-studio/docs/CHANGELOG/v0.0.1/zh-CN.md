# OpenMotion 0.0.1

为 0.0.1 正式候选包准备的版本说明。新的版本序列从这里开始；历史 0.6.x 包和固定下载地址继续保留。实际发布状态以 GitHub Releases 为准。

## 亮点

- 使用本机 Agent 自己的宿主配置连接 OpenMotion，也可连接预设集成列表之外的受支持本地 Agent。([#460](https://github.com/nexu-io/openmotion/pull/460))
- 生成的媒体保存在工作区素材中，可以预览候选结果，再把选中的素材应用到可编辑工程。([#413](https://github.com/nexu-io/openmotion/pull/413)、[#448](https://github.com/nexu-io/openmotion/pull/448))
- 使用受支持的 OpenDesign 账号模型编辑图片、生成音乐；可用模型和用量取决于已登录账号。([#423](https://github.com/nexu-io/openmotion/pull/423)、[#445](https://github.com/nexu-io/openmotion/pull/445))

## 新增与改进

- 通过紧凑的波形控件直接预听音频。([#391](https://github.com/nexu-io/openmotion/pull/391))
- 在默认源码安装之外，可明确选择 npm 应用安装。候选构建保留包身份和版本说明草稿，便于检查。([#444](https://github.com/nexu-io/openmotion/pull/444)、[#447](https://github.com/nexu-io/openmotion/pull/447)、[#464](https://github.com/nexu-io/openmotion/pull/464))

## 修复

- 修复 Windows 宿主配置及旧工作区安装路径的恢复。([#434](https://github.com/nexu-io/openmotion/pull/434))
- 渲染遇到套接字缓冲区故障时，减少并发后重试。([#443](https://github.com/nexu-io/openmotion/pull/443))

## 升级注意事项

- 发布后使用 `@openmotion/app@latest` 安装，或固定为 `@openmotion/app@0.0.1`。已有 0.6.x 版本范围和锁文件需要明确迁移；修改标签不会自动更新现有安装。

- 明确选择一种安装方式，保留原有工程、凭据和宿主配置，避免混用源码与 npm 安装。
- 正式包使用 prod 模板配置，测试包使用 DEV；仍需具备对应服务的访问条件和账号配置。

## 已知问题

本说明不代表已经完成这份安装包的实际验收。发布前需补充实际未解决问题和支持的平台范围。构建成功不代表线上模板可用、付费模型执行通过或成片声画已完成人工验收。

## 验收重点

验证选定安装包的本地 Agent 连接、模板访问、素材应用、音频预听和 MP4 导出。检查升级后原有工程和宿主配置是否保留，并以正常速度观看、收听最终成片。实际结果保存在内部验收记录中，未测项标为 NOT RUN。
