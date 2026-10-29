import { assertId } from './store.js';
import { makeMessage, makeEvent } from './workflow.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const emptyMetadata = () => ({ favorite: false, pinned: false, tags: [], revision: 0 });

export function reportMetadata(store, taskId) {
  const stored = store.get('report-metadata', taskId);
  if (!stored) return undefined;
  const { favorite, pinned, tags, revision } = stored;
  return { favorite, pinned, tags, revision };
}

export function updateReportMetadata(store, task, body) {
  if (task.status !== 'completed' || !task.report) fail('仅已完成且有报告的任务可以整理', 409);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('报告元数据必须为对象');
  const patch = {};
  for (const field of ['favorite', 'pinned']) if (Object.hasOwn(body, field)) {
    if (typeof body[field] !== 'boolean') fail(`${field} 必须为布尔值`);
    patch[field] = body[field];
  }
  if (Object.hasOwn(body, 'tags')) {
    if (!Array.isArray(body.tags) || body.tags.length > 8 || body.tags.some(tag => typeof tag !== 'string' || [...tag.trim()].length > 20)) fail('标签最多 8 项，每项必须为最多 20 字的文本');
    patch.tags = [...new Set(body.tags.map(tag => tag.trim()).filter(Boolean))];
  }
  // Read/merge/write only this small entity under the SQLite write lock. Task state,
  // report, updatedAt and ledger are never rewritten by an organization action.
  return store.atomic(() => {
    const current = reportMetadata(store, task.id) || emptyMetadata();
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    next.revision = current.revision + 1;
    store.put('report-metadata', { id: task.id, ...next });
    return next;
  });
}

export function continuationInput(body) {
  if (body.inheritContext !== undefined && typeof body.inheritContext !== 'boolean') fail('inheritContext 必须为布尔值');
  if (body.sourceTaskId === undefined) {
    if (body.inheritContext !== undefined) fail('继承业务背景时请提供来源报告 sourceTaskId');
    return {};
  }
  assertId(body.sourceTaskId);
  return { sourceTaskId: body.sourceTaskId, inheritContext: body.inheritContext ?? true };
}

export function continueFromReport(task, source, inheritContext) {
  if (source.status !== 'completed' || !source.report) fail('仅已完成且有报告的任务可以继续分析', 409);
  task.sourceTaskId = source.id; task.sourceKind = 'continuation';
  if (inheritContext) {
    const messages = (source.messages || []).filter(message => message.role === 'user');
    if (messages.length + task.messages.length + 1 > 100 || messages.some(message => typeof message.content !== 'string' || message.content.length > 3000) || messages.reduce((total, message) => total + message.content.length, 0) > 300000) fail('来源业务背景超过上下文边界（最多 100 条消息、每条 3000 字、合计 300000 字），请关闭继承后重新整理本次背景；不会截断原背景');
    task.messages.push(makeMessage('system', `已继承来源报告 ${source.id} 的 ${messages.length} 条用户追加业务背景；未继承原模型结论。`), ...messages.map(message => makeMessage('user', message.content)));
  }
  task.events.push(makeEvent('info', '基于报告继续分析', `来源报告 ${source.id}；${inheritContext ? '继承用户追加业务背景' : '不继承追加业务背景'}，本次使用明确选择的数据与目标，重新冻结 20 额度。`));
  return task;
}
