export const modelError = (code, message) => Object.assign(new Error(message), { code, modelFailure: true });
const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function providerUsage(raw, protocol) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {
    protocol, inputTokens: counter(raw.prompt_tokens ?? raw.input_tokens), outputTokens: counter(raw.completion_tokens ?? raw.output_tokens), totalTokens: counter(raw.total_tokens),
    cacheReadInputTokens: counter(raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens),
    cacheCreationInputTokens: counter(raw.cache_creation_input_tokens), reasoningTokens: counter(raw.completion_tokens_details?.reasoning_tokens ?? raw.output_tokens_details?.thinking_tokens),
  };
  return Object.entries(result).some(([key, value]) => key !== 'protocol' && value !== null) ? result : null;
}
export function modelRequest(baseUrl, model, messages, key, maxTokens, connectionTest) {
  const hostname = new URL(baseUrl).hostname;
  if (hostname === 'api.anthropic.com') return {
    protocol: 'anthropic', endpoint: `${baseUrl}/messages`,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21' },
    body: { model, max_tokens: maxTokens, system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n'), messages: messages.filter(message => message.role !== 'system').map(({ role, content }) => ({ role, content })) },
  };
  return {
    protocol: 'chat-completions', endpoint: `${baseUrl}/chat/completions`, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: { model, messages, ...(['api.deepseek.com', 'api.openai.com'].includes(hostname) ? {} : { temperature: 0.2 }),
      ...(connectionTest && hostname === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'].includes(model) ? { thinking: { type: 'disabled' } } : {}),
      ...(hostname === 'api.openai.com' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    },
  };
}
export function httpModelError(status) {
  if (status === 401) return modelError('INVALID_KEY', '模型 Key 无效或已过期；请重新填写该地址对应的 Key。');
  if (status === 403) return modelError('NO_PERMISSION', '没有访问此模型的权限；请在供应商控制台开通权限或选择已授权模型。');
  if (status === 429) return modelError('RATE_LIMITED', '模型服务限流或供应商额度不足；请稍后重试，并检查供应商余额和请求限制。');
  if (status === 404) return modelError('MODEL_UNSUPPORTED', '模型或接口不存在；请重新检测模型，并核对 API 地址和所选模型名称。');
  if (status === 400 || status === 422) return modelError('REQUEST_REJECTED', '模型拒绝当前请求；请核对文本对话能力、缩短业务背景或更换模型。');
  return modelError('UNREACHABLE', `模型服务返回 HTTP ${status}；请稍后重试或检查供应商服务状态。`);
}
export async function readModelResponse(response) {
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw modelError('RESPONSE_TOO_LARGE', '模型返回内容过大；请缩短输出或更换模型。'); }
  let text;
  const reader = response.body?.getReader();
  if (reader) {
    const chunks = []; let size = 0;
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw modelError('RESPONSE_TOO_LARGE', '模型返回内容过大；请缩短输出或更换模型。'); } chunks.push(Buffer.from(value)); }
      text = Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  } else { text = await response.text(); if (Buffer.byteLength(text, 'utf8') > limit) throw modelError('RESPONSE_TOO_LARGE', '模型返回内容过大；请缩短输出或更换模型。'); }
  try { return JSON.parse(text); } catch { throw modelError('PROTOCOL_ERROR', '模型服务未返回有效 JSON；请核对 API 地址是否支持对应的文本对话协议。'); }
}
export function visibleReply(payload, protocol, connectionTest) {
  const claude = protocol === 'anthropic'; const choice = payload?.choices?.[0]; const message = claude ? payload : choice?.message;
  if (!message || typeof message !== 'object' || (claude && !Array.isArray(message.content))) throw modelError('PROTOCOL_ERROR', '模型返回格式不兼容；请核对 API 地址、模型协议或选择文本对话模型。');
  const parts = message.content;
  const content = typeof parts === 'string' ? parts : Array.isArray(parts) ? parts.filter(part => ['text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('') : '';
  const stop = claude ? payload.stop_reason : choice.finish_reason;
  const reasoning = claude ? parts.some(part => part?.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) : typeof message.reasoning_content === 'string' && message.reasoning_content.trim();
  if (['content_filter', 'refusal'].includes(stop) || message.refusal || payload.stop_details?.type === 'refusal') throw modelError('REFUSED', '模型拒绝请求或触发安全过滤；请调整问题或选择其他已授权模型。');
  if (!content.trim() && reasoning) {
    if (connectionTest && ['length', 'max_tokens', 'stop', 'end_turn'].includes(stop)) return '';
    throw modelError('REASONING_ONLY', '模型只返回推理，尚无最终文本；请切换非推理模式、缩短目标或更换模型后重试。');
  }
  if (!connectionTest && ['length', 'max_tokens'].includes(stop)) throw modelError('OUTPUT_TRUNCATED', '模型达到输出上限，最终文本被截断；请缩短目标、关闭推理或更换模型后重试。');
  if (!content.trim()) throw modelError('EMPTY_RESPONSE', '模型未返回最终文本，内容为空；请确认模型支持文本对话或更换模型。');
  return content;
}
