# 24 · DSH 插件手机兼容矩阵（自动生成快照）

> 2026-11-02 快照 · dsh `0.2.1-rc.5` · 305 个包。
> 由 [`scripts/plugin-compat.ts`](../scripts/plugin-compat.ts) 生成，复跑：
> `node --import tsx scripts/plugin-compat.ts runtime/build/stage/opt/dsh/node_modules`
> 等级定义与兼容策略见 [23-requirements.md](23-requirements.md) 第 4 节。

## 怎么读这张表

1. **等级是"这个包原样能不能在手机上跑"，不是"手机需不需要它"。** 一个包被判 L2，不代表手机端必须用内嵌 Node——也可以由轻引擎自己实现同等服务，然后不安装它。
2. **L1 不等于"独立可跑"。** L1 的包大多只是工具/策略/协议，运行时依赖 L2 的 agent / session / gateway 注入服务；轻引擎要自己把这些服务补齐。
3. **L3 里真正卡核心的是这几类**：会话落盘（`dsh-session-persistence-jsonl`，带原生 zstd 依赖）、终端与子进程（`dsh-terminal*`、`dsh-subprocess-local`、`dsh-native-command`）、沙箱（`dsh-sandbox-local`）、文档转换（`libreoffice-kit`，`engines >=22.19`）、启动器（`dsh`、`dsh-web-app`）。
4. 这份表是**静态扫描**：它看导入、`child_process`、原生扩展、`engines`，不做运行时验证。抽检过几十个包，归类基本合理；边界包（例如只是 `import type` 或字符串里出现关键词）会有误差。
# 24 · DSH 插件手机兼容矩阵（自动生成快照）

> 生成命令：`node --import tsx scripts/plugin-compat.ts runtime\build\stage\opt\dsh\node_modules`
> 扫描包数：305；等级定义见 docs/23-requirements.md 第 4 节。

| 等级 | 含义 | 包数 |
|---|---|---|
| L0 | Web UI：官方 web 前端 + WebView，零改动 | 64 |
| L1 | 纯 JS：轻 TS 引擎 + 内建 shim | 152 |
| L2 | 需 Node 内建：内嵌 Node / 完整引擎 | 59 |
| L3 | 需真实二进制：proot 完整引擎 | 29 |
| L4 | 需桌面能力：电脑端执行 | 0 |
| no-code | 无 JS 代码 | 1 |

## L0（64）

| 包 | 版本 | 判定理由 |
|---|---|---|
| `@deepseek-ai/dsh-client-connection` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-file-upload` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-hmr` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-locale` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-modules` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-product-analytics` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-resources` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-shortcuts` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-agent-preset` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-approval` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-attachment` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-brand-official` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-chat` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-commands` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-conversation` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-cordis` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-deliverables` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-entry-customization` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-goal` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-input-trigger` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-jobs` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-layout` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-message-feedback` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-model-selection` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-open-in-app` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-permission-presets` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-plan` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-plugin-manager` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-plugin-market` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-reference` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-renderer` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-schedule` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-secret-mask` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-session` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-account` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-agent-loop` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-general` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-models` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-session-log` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-shell` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-subagent` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-settings-web-search` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-shortcuts` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar-browser` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar-files` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-sidebar-terminal` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-skill` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-subagent` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-theme` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-tool` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-trajectory` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-user-questions` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-workflow-run` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-client-ui-workspace` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |
| `@deepseek-ai/dsh-web-frontend` | 0.2.1-rc.5 | web UI 包（官方 web 前端里渲染） |

## L1（152）

| 包 | 版本 | 判定理由 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.5 | 只用轻内建：url |
| `@deepseek-ai/cordis-plugin-group` | 1.0.5 | 纯 JS |
| `@deepseek-ai/cordis-plugin-include` | 1.0.10 | 只用轻内建：path, url |
| `@deepseek-ai/cordis-plugin-timer` | 1.1.7 | 纯 JS |
| `@deepseek-ai/cosmokit` | 1.8.6 | 纯 JS |
| `@deepseek-ai/dsh-acp-app` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-agent-default-model` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-agent-preset` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-agent-preset-registry` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-agent-tool-presentation` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-api-account-controller` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-api-job-controller` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-api-remote-access` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-api-settings-controller` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-api-workspace-files` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-attachment` | 0.2.1-rc.5 | 只用轻内建：buffer |
| `@deepseek-ai/dsh-authorization` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-base` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-bash-sandbox` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-brand` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-chunked-list` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-cmdline` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-command-compact` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-command-feedback` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-command-goal` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-commands` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-compaction` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-compaction-image-offload` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-config-editor` | 0.2.1-rc.5 | 只用轻内建：path, util |
| `@deepseek-ai/dsh-cordis-client-runner` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-credentials` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-credentials-local` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-deepseek-account` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-deque` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-api-speech-to-text` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-auto-review` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-badge-skill-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-client-ui-cot-translation` | 0.2.1-rc.5 | 只用轻内建：events |
| `@deepseek-ai/dsh-experimental-client-ui-voice-input` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-cot-translation-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-inspector-profile` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-plugin-market-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-ralph-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-session-inspector` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-session-search` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-session-titles-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-speech-to-text` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-terminal-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-tool-worktree` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-file-reference` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-file-reference-local` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-fs` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-fs-observation-policy` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-fs-sandbox` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-goal-round-driver` | 0.2.1-rc.5 | 只用轻内建：util |
| `@deepseek-ai/dsh-harness-dev-context` | 0.2.1-rc.5 | 只用轻内建：url |
| `@deepseek-ai/dsh-host-directory-picker` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-host-frontend-static` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-host-plugin-inventory` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-http-proxy` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-jobs` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-launch-environment` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-llm-deepseek-account` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-llm-deepseek-api-key` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-mcp-resources` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-output-retention` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-package-manifest` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-permission-presets` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-persona` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-plan-mode` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-plugin-market-index` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-ptc-runtime` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-sandbox-policy` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-scope` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-sdk-app` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-sdk-minimal` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-format` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-format-catalog` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-format-v0-to-v1` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-session-format-v1-to-v2` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-session-format-v3-to-v4` | 0.2.1-rc.5 | 只用轻内建：path, util |
| `@deepseek-ai/dsh-session-log-deepseek` | 0.2.1-rc.5 | 只用轻内建：buffer |
| `@deepseek-ai/dsh-session-log-export` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-persistence` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-projection` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-projection-cache` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-query` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-reference` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-stats` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-telemetry` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-title` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-title-all-prompts-llm` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-title-llm` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-session-turn-outline` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-shell` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-shell-env` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-skill` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-skill-badge` | 0.2.1-rc.5 | 只用轻内建：url |
| `@deepseek-ai/dsh-spill` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-spill-policy` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-storage` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-storage-domain` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-system-prompt` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-time-context` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-timeout` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-token-meter` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-ask-user` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-bash` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-fs` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-tool-goal` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-jobs` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-present` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-ralph` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-schedule` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-session-query` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-str-replace-editor` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-tool-subagent` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-subagent-control` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-todo` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-web` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-workflow` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-working-directory` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-tool-workspace-dependencies` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/dsh-tools` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-typert-protocol` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-typert-registry` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-user-questions` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-util-code-language` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-util-crypto` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-util-time` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-util-values` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-util-workspace-path` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-web` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-web-deepseek-api` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-web-search-deepseek` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-win32-process` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-workflow` | 0.2.1-rc.5 | 纯 JS |
| `@deepseek-ai/dsh-working-directory` | 0.2.1-rc.5 | 只用轻内建：path |
| `@deepseek-ai/schemastery` | 3.18.5 | 纯 JS |

## L2（59）

| 包 | 版本 | 判定理由 |
|---|---|---|
| `@deepseek-ai/cordis-plugin-loader` | 1.0.6 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-acp` | 0.2.1-rc.5 | 需要 Node 内建：crypto, http |
| `@deepseek-ai/dsh-agent` | 0.2.1-rc.5 | 需要 Node 内建：async_hooks |
| `@deepseek-ai/dsh-agent-instructions` | 0.2.1-rc.5 | 需要 Node 内建：fs, crypto |
| `@deepseek-ai/dsh-agent-loop` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-anonymous-user-id` | 0.2.1-rc.5 | 需要 Node 内建：crypto, fs |
| `@deepseek-ai/dsh-api-gateway` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-api-remotes` | 0.2.1-rc.5 | 需要 Node 内建：os |
| `@deepseek-ai/dsh-api-session-controller` | 0.2.1-rc.5 | 需要 Node 内建：os, crypto |
| `@deepseek-ai/dsh-api-workspace-controller` | 0.2.1-rc.5 | 需要 Node 内建：os |
| `@deepseek-ai/dsh-atomic-write` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-attachment-local` | 0.2.1-rc.5 | 需要 Node 内建：crypto, fs |
| `@deepseek-ai/dsh-compaction-basic` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-cordis-host-runner` | 0.2.1-rc.5 | 需要 Node 内建：vm |
| `@deepseek-ai/dsh-deepseek-account-platform` | 0.2.1-rc.5 | 需要 Node 内建：crypto, os |
| `@deepseek-ai/dsh-experimental-translator` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-fs-local` | 0.2.1-rc.5 | 需要 Node 内建：crypto, fs |
| `@deepseek-ai/dsh-goal` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-headless` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-home-paths` | 0.2.1-rc.5 | 需要 Node 内建：os |
| `@deepseek-ai/dsh-host-directory-picker-auto` | 0.2.1-rc.5 | 需要 Node 内建：fs |
| `@deepseek-ai/dsh-host-directory-picker-browse` | 0.2.1-rc.5 | 需要 Node 内建：os |
| `@deepseek-ai/dsh-host-product-telemetry-otel` | 0.2.1-rc.5 | 需要 Node 内建：http |
| `@deepseek-ai/dsh-host-webserver` | 0.2.1-rc.5 | 需要 Node 内建：http, https, net |
| `@deepseek-ai/dsh-jobs-local` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-lazy-require` | 0.2.1-rc.5 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-llm` | 0.2.1-rc.5 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-llm-deepseek` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-llm-pi-ai` | 0.2.1-rc.5 | 需要 Node 内建：os |
| `@deepseek-ai/dsh-llm-retry` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-mcp-client` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-message-feedback` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-office-to-pdf` | 0.2.1-rc.5 | 需要 Node 内建：crypto, os, fs |
| `@deepseek-ai/dsh-otel` | 0.2.1-rc.5 | 需要 Node 内建：zlib |
| `@deepseek-ai/dsh-plugin-manager` | 0.2.1-rc.5 | 需要 Node 内建：crypto, fs, os |
| `@deepseek-ai/dsh-plugin-market` | 0.2.1-rc.5 | 需要 Node 内建：worker_threads |
| `@deepseek-ai/dsh-plugin-package-inventory-deepseek` | 0.2.1-rc.5 | 需要 Node 内建：module, fs |
| `@deepseek-ai/dsh-pwsh-sandbox` | 0.2.1-rc.5 | 需要 Node 内建：fs |
| `@deepseek-ai/dsh-repeat-tool-reminder` | 0.2.1-rc.5 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-sandbox` | 0.2.1-rc.5 | 需要 Node 内建：fs, os |
| `@deepseek-ai/dsh-schedule` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-sdk-protocol` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-session-format-v2-to-v3` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-session-query-sqlite` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-session-telemetry-otel` | 0.2.1-rc.5 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-settings` | 0.2.1-rc.5 | 需要 Node 内建：fs |
| `@deepseek-ai/dsh-skill-filesystem` | 0.2.1-rc.5 | 需要 Node 内建：fs |
| `@deepseek-ai/dsh-skill-office` | 0.2.1-rc.5 | 需要 Node 内建：fs |
| `@deepseek-ai/dsh-spill-local` | 0.2.1-rc.5 | 需要 Node 内建：os, crypto, fs |
| `@deepseek-ai/dsh-storage-json` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-subagent` | 0.2.1-rc.5 | 需要 Node 内建：crypto, fs |
| `@deepseek-ai/dsh-subprocess` | 0.2.1-rc.5 | 需要 Node 内建：net |
| `@deepseek-ai/dsh-tmux-context` | 0.2.1-rc.5 | 需要 Node 内建：module |
| `@deepseek-ai/dsh-tool-skill` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-typert-loader` | 0.2.1-rc.5 | 需要 Node 内建：module, fs |
| `@deepseek-ai/dsh-user-approval` | 0.2.1-rc.5 | 需要 Node 内建：crypto |
| `@deepseek-ai/dsh-web-fetch-http` | 0.2.1-rc.5 | 需要 Node 内建：net |
| `@deepseek-ai/dsh-workflow-ptc` | 0.2.1-rc.5 | 需要 Node 内建：crypto, os, vm |
| `@deepseek-ai/dsh-workspace` | 0.2.1-rc.5 | 需要 Node 内建：crypto |

## L3（29）

| 包 | 版本 | 判定理由 |
|---|---|---|
| `@deepseek-ai/dsh` | 0.2.1-rc.5 | 含原生扩展（.node / node-gyp） |
| `@deepseek-ai/dsh-api-terminal-controller` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-app-boot` | 0.2.1-rc.5 | 含原生扩展（.node / node-gyp） |
| `@deepseek-ai/dsh-bash-local` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-experimental-agent-team` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-experimental-worktree` | 0.2.1-rc.5 | 使用 child_process；调用了外部程序 "git" |
| `@deepseek-ai/dsh-hmr` | 0.2.1-rc.5 | 含原生扩展（.node / node-gyp） |
| `@deepseek-ai/dsh-host-directory-picker-native` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-host-open-in-app` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-native-command` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-ptc-runtime-node` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-pwsh-local` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-sandbox-local` | 0.2.1-rc.5 | 使用 child_process；含原生扩展（.node / node-gyp） |
| `@deepseek-ai/dsh-sandbox-windows-acl` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 0.2.1-rc.5 | 含原生扩展（.node / node-gyp） |
| `@deepseek-ai/dsh-subprocess-local` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-terminal` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-terminal-bash` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-bash-persistent` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-cordis` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-fs-search` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-pwsh` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-tool-terminal` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-web-app` | 0.2.1-rc.5 | 使用 child_process |
| `@deepseek-ai/dsh-workspace-changes` | 0.2.1-rc.5 | 使用 child_process；调用了外部程序 "git" |
| `@deepseek-ai/libreoffice-kit` | 0.1.5 | 使用 child_process；调用了外部程序 "libreoffice"；engines: node >=22.19.0 |
| `@deepseek-ai/node-addon-system` | 0.1.2 | 使用 child_process；engines: node >=20 |

## no-code（1）

| 包 | 版本 | 判定理由 |
|---|---|---|
| `@deepseek-ai/node-addon-system-linux-arm64` | 0.1.2 | 无 JS 代码（数据/样式包）；engines: node >=20 |

