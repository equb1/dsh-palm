/**
 * 模型可用性判断（UI 与 store 共用）。
 *
 * 连上引擎 ≠ 能说话：完整引擎的桥在 127.0.0.1 上永远是 connected，
 * 但既没登录 DeepSeek 账号、也没配 API Key / 第三方提供商时，发消息只会拿到
 * MISSING_CREDENTIAL。这里把“有没有可用凭据”算成一个纯函数，顶栏状态点、
 * 抽屉底部、发送前检查都用同一套规则。
 */

export type ReadinessEngineKind = 'remote' | 'proot' | 'light' | null;

export interface ReadinessProvider {
  configured?: boolean;
  displayName?: string;
}

export interface ModelReadinessInput {
  accountStatus: string | null | undefined;
  credentials: Record<string, { configured: boolean }>;
  providers: ReadinessProvider[];
  engineKind: ReadinessEngineKind;
  /** 轻引擎是否已经连上（轻引擎的 providers.list 只在连接后才有数据） */
  lightReady: boolean;
}

export interface ModelReadiness {
  signedIn: boolean;
  hasApiKey: boolean;
  hasProvider: boolean;
  /** true = 登录了账号 / 有 API Key / 有已配置的第三方提供商 */
  modelReady: boolean;
  /** 当前可展示的渠道名，例如 DeepSeek 账号、OpenRouter */
  providerName: string | null;
}

export function modelReadiness(input: ModelReadinessInput): ModelReadiness {
  const signedIn = input.accountStatus === 'credential-stored';
  const hasApiKey = Object.values(input.credentials).some((item) => item.configured === true);
  const configured = input.providers.find((item) => item.configured === true);
  // 轻引擎的 providers.list 只反映当前单渠道；连上且列表非空就说明渠道已落盘
  const hasProvider =
    Boolean(configured) ||
    (input.engineKind === 'light' && input.lightReady && input.providers.length > 0);
  const providerName =
    configured?.displayName ?? input.providers[0]?.displayName ?? (signedIn ? 'DeepSeek 账号' : null);
  return {
    signedIn,
    hasApiKey,
    hasProvider,
    modelReady: signedIn || hasApiKey || hasProvider,
    providerName,
  };
}
