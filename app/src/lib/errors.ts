/**
 * 把协议层的原始错误翻成人话。
 *
 * 真 dsh 的错误长这样：`session/create -> gateway/invocation-unavailable | no active Remote
 * method exports this endpoint`；直接扔给用户等于没提示。这里按最常见的几类压成一句
 * 「发生了什么 + 怎么办」，识别不了才原样截断。
 */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();

  if (m.includes('no active remote method') || m.includes('invocation-unavailable')) {
    return '这个宿主版本不支持该操作。把宿主上的 dsh 升级一下，或换一种方式。';
  }
  if (m.includes('需要配对码') || m.includes('4001')) {
    return '配对码不对或已过期：重新输入宿主打印的六位码。';
  }
  if (m.includes('econnrefused') || m.includes('连接失败') || m.includes('econnreset')) {
    return '连不上宿主：确认引擎在跑、地址正确，或重新配对。';
  }
  if (m.includes('model-discovery') || (m.includes('401') && m.includes('api key'))) {
    return '服务商拒绝了请求：检查 Base URL 和 API Key 是否有效。';
  }
  if (m.includes('eai_again') || m.includes('enotfound')) {
    return '域名解析失败：检查手机网络，或换个 DNS。';
  }
  if (m.includes('eacces') && m.includes('session')) {
    return '会话写盘失败：引擎的 Android 兼容补丁可能没生效（见设置里的日志）。';
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return '请求超时了，稍等再试。';
  }
  if (m.includes('401')) return '宿主拒绝了请求（401）：可能需要重新登录或配对。';
  if (m.includes('429') || m.includes('rate limit')) return '请求太频繁被限流了，过一会儿再试。';

  return raw.length > 180 ? raw.slice(0, 180) + '…' : raw;
}
