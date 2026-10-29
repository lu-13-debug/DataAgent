export interface ModelProfile { baseUrl: string; model: string; provider: string }
export const providerPresets = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'Chat Completions · 文本对话' },
  { name: 'Claude', baseUrl: 'https://api.anthropic.com/v1', protocol: 'Messages · 文本对话' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'Chat Completions · 文本对话' },
];
export const profileKey = (mode: string, user: string | undefined, origin: string) => `dataagent:model-profiles:v1:${mode}:${encodeURIComponent(origin)}:${mode === 'cloud' ? encodeURIComponent(user || 'anonymous') : 'local'}`;
function clean(value: unknown): ModelProfile | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.baseUrl !== 'string' || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || /[\r\n]/.test(input.model)) return null;
  try {
    const url = new URL(input.baseUrl); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) return null;
    return { baseUrl: url.toString().replace(/\/+$/, ''), model: input.model.trim(), provider: typeof input.provider === 'string' ? input.provider.slice(0, 80) : '自定义接口' };
  } catch { return null; }
}
export function readProfiles(storage: Pick<Storage, 'getItem'>, key: string): ModelProfile[] { try { const input = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(input) ? input.slice(0, 12).map(clean).filter((profile): profile is ModelProfile => Boolean(profile)) : []; } catch { return []; } }
export function writeProfiles(storage: Pick<Storage, 'setItem'>, key: string, profiles: unknown[]) { try { storage.setItem(key, JSON.stringify(profiles.map(clean).filter(Boolean).slice(0, 12))); } catch { /* 存储不可用时保留内存中的非敏感档案。 */ } }
export function modelDiagnosis(error: { code?: string; message?: string }) {
  const cases: Record<string, { title: string; action: string }> = {
    INVALID_KEY: { title: 'Key 无效或已过期', action: '重新填写当前 API 地址对应的 Key，并在供应商控制台核对状态。' },
    NO_PERMISSION: { title: '没有模型访问权限', action: '开通模型权限，或从检测列表选择有权限的模型。' },
    RATE_LIMITED: { title: '供应商限流或额度不足', action: '稍后重试，并检查供应商余额、并发和速率限制。' },
    MODEL_UNSUPPORTED: { title: '模型或接口不支持', action: '重新检测模型，核对地址、协议与文本对话能力。' },
    REQUEST_REJECTED: { title: '模型拒绝当前参数', action: '缩短目标与背景，核对模型能力，或选择其他模型。' },
    OUTPUT_TRUNCATED: { title: '输出被截断', action: '缩短目标、关闭推理模式或更换模型后创建恢复尝试。' },
    REASONING_ONLY: { title: '只有推理，尚无最终答案', action: '选择非推理模式或更换模型；不要把推理内容当作报告。' },
    EMPTY_RESPONSE: { title: '未返回最终文本', action: '检查模型是否支持文本对话；可切换为仅确定性分析。' },
    TIMEOUT: { title: '模型响应超时', action: '检查网络，缩短背景或更换模型；重试前核对已有任务。' },
    PROTOCOL_ERROR: { title: '响应协议不兼容', action: '使用供应商预设核对 API 地址与协议，或联系接口维护者。' },
    INVALID_REPORT: { title: '报告结构不完整', action: '选择支持稳定结构化文本的模型，或仅用确定性分析重跑。' },
  };
  if (error.code && cases[error.code]) return cases[error.code];
  return { title: '连接或模型调用未完成', action: '核对网络、地址、Key 和模型权限；原任务会保留，可选择确定性分析重跑。' };
}
