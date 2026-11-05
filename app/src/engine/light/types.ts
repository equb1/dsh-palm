/**
 * 轻引擎的类型。
 *
 * 目标（docs/23 · M1）：会话 / 流式 / 审批 / 提问，外加一个能落真实工作区的
 * 工具集。协议层沿用 `app/src/protocol`，所以界面不认识「轻引擎」这个东西，
 * 它只认识 Capabilities 和事件。
 */
import type { Approval, ModelChoice, RiskLevel, Turn } from '../../protocol';
import type { SandboxFs } from '../fs/sandbox';
import type { ShellRunner } from '../shell/bash';

/** 目前只做 OpenAI 兼容的 chat/completions（DeepSeek、OpenRouter、Ollama 都是这个形状） */
export interface LightModelConfig {
  /** 例如 https://api.deepseek.com/v1（不带 /chat/completions） */
  baseURL: string;
  apiKey: string;
  /** 账号模式的 token（`x-dsh-auth-token`），与 apiKey 二选一 */
  authToken?: string;
  model: string;
  /** 展示名，例如 DeepSeek */
  providerName?: string;
  /** 模型是否会输出 reasoning_content（deepseek-reasoner / 部分开源模型） */
  reasoning?: boolean;
}

/** 生图返回格式：auto 不传 response_format，b64_json / url 显式要求 */
export type ImageResponseFormat = 'auto' | 'b64_json' | 'url';

/** 生图渠道（可选）。和文本模型分开配，因为官方账号默认没有图像模型。 */
export interface LightImageConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  /** 默认 1024x1024 */
  size?: string;
  /** 默认 auto：不传 response_format，两种返回都接受 */
  responseFormat?: ImageResponseFormat;
}

export type PermissionPreset = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  /** workspace-write 下要不要弹审批 */
  needsApproval?: boolean;
  /** 审批卡上显示什么（标题 / 原文 / 风险 / 一句话解释） */
  describeApproval?(args: Record<string, unknown>): {
    title: string;
    command: string;
    risk: RiskLevel;
    summary: string;
  };
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ToolContext {
  /** 工作区沙箱（真实目录） */
  fs: SandboxFs;
  bash: ShellRunner;
  permission: PermissionPreset;
  /** 生图渠道；没配时 generate_image 会返回可读错误 */
  image?: LightImageConfig;
  requestApproval(input: {
    title: string;
    command: string;
    risk: RiskLevel;
    summary: string;
  }): Promise<'approve' | 'reject'>;
  askUser(question: AskQuestion): Promise<AskAnswer>;
  signal: AbortSignal;
}

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  id?: string;
  header?: string;
  question: string;
  options?: AskOption[];
  multiSelect?: boolean;
}

export interface AskAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

/** 引擎内部的一次运行（一次 send 对应一次 run） */
export interface LightRun {
  sessionId: string;
  runId: string;
  /**
   * 当前这一步的取消令牌。steer 只中断这一步（换一个新的继续跑），
   * stop 则把它连同整个 run 一起结束。
   */
  step: AbortController;
  /** 为什么 abort：stop = 用户点停止；steer = 插话后继续 */
  abortKind: 'stop' | 'steer' | null;
  finished: boolean;
}

export interface StoredSession {
  id: string;
  title: string;
  presetId: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  permission: PermissionPreset;
  model?: ModelChoice;
  turns: Turn[];
  history: ChatMessage[];
  /** E2：运行中收到的下一条消息，等当前 run 结束自动开始 */
  queued?: string[];
}

export interface LightPendingApproval {
  approval: Approval;
  resolve(decision: 'approve' | 'reject'): void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface LightPendingQuestion {
  approval: Approval;
  resolve(answer: AskAnswer): void;
  timer?: ReturnType<typeof setTimeout>;
}
