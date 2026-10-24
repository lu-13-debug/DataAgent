import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Store } from './store.js';
import { generateDemo, parseFiles, publicDataset } from './datasets.js';
import { Workflow, publicTask, createTask, demoTask, makeMessage, makeEvent, SKILLS, DOMAINS, PROJECT } from './workflow.js';
import { DEFAULT_SETTINGS, validateSettings, validateKey, chat, redact } from './gateway.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statusError = (message, status = 400) => Object.assign(new Error(message), { status });
const textField = (value, label, max, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw statusError(`${label}必须为${required ? '非空' : ''}文本，最多 ${max} 字`);
  return value.trim();
};
const markdownText = value => String(value ?? '').replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;').replace(/\r/g, '');
function reportMarkdown(task) {
  const r = task.report;
  return [
    `# ${markdownText(r.title)}`, '', `分析期间：${r.period}  |  币种：${r.currency}`, `生成时间：${r.generatedAt}`, `分析来源：${r.source === 'ai' ? '自带 Key 模型 + 本地计算' : '本地确定性分析'}`, '',
    markdownText(r.summary), '', '## 关键指标', '',
    '| 指标 | 数值 | 口径 |', '| --- | --- | --- |',
    ...r.metrics.map(m => `| ${markdownText(m.label)} | ${m.value === null ? '无数据' : `${m.value} ${m.unit}`} | ${markdownText(m.note).replaceAll('|', '\\|')} |`), '',
    '## 观察与证据', '', ...r.findings.flatMap(f => [`### ${markdownText(f.title)}`, markdownText(f.detail), `证据：${markdownText(f.evidence)}`, '']),
    '## 建议', '', ...r.recommendations.map(x => `- ${markdownText(x)}`), '',
    '## 数据质量', '', `记录行数：${r.quality.rows}；质量评分：${r.quality.score}/100`, ...r.quality.issues.map(x => `- ${markdownText(x)}`), '',
    '## 方法与限制', '', ...r.methodology.map(x => `- ${markdownText(x)}`), '',
    '## 分析目标与业务背景', '', markdownText(task.goal), ...task.messages.filter(m => m.role === 'user').map(m => `- ${markdownText(m.content)}`), '',
  ].join('\n');
}

export function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  const store = new Store(options.dataDir || process.env.DATAAGENT_DATA_DIR || path.join(root, 'data'));
  let key = '';
  let settings = store.config('settings') || { ...DEFAULT_SETTINGS };
  const getKey = req => options.getKey ? options.getKey(req) || '' : key;
  const setKey = (req, value) => { if (options.setKey) options.setKey(req, value); else key = value; };
  const publicSettings = req => ({ ...settings, hasKey: Boolean(getKey(req)) });
  const workflow = new Workflow(store);
  let activeAsync = 0;
  const trackAsync = handler => async (req, res) => {
    if (activeAsync >= (options.maxAsyncRequests ?? Infinity)) throw statusError('当前账号请求过多，请稍后再试', 429);
    activeAsync++; try { return await handler(req, res); } finally { activeAsync--; }
  };
  app.locals.store = store;
  app.locals.isBusy = () => activeAsync > 0 || workflow.running.size > 0 || store.list('task').some(t => ['running', 'awaiting_approval'].includes(t.status));
  app.locals.close = () => { workflow.close(); key = ''; store.close(); };
  function ensureDemo() {
    let dataset = store.list('dataset').find(x => x.source === 'demo');
    if (!dataset) { dataset = generateDemo(); store.put('dataset', dataset); }
    if (!store.config('bootstrapped')) {
      store.put('task', demoTask(dataset)); store.config('bootstrapped', true);
    }
    return dataset;
  }
  ensureDemo();
  const datasetById = id => { const dataset = store.get('dataset', id); if (!dataset) throw statusError('数据集不存在', 404); return dataset; };
  const taskById = id => { const task = store.get('task', id); if (!task) throw statusError('任务不存在', 404); return task; };
  const taskWallet = task => ({ task: publicTask(task), wallet: store.wallet() });

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (options.networkGuard === false) return next(); // Authenticated cloud parent owns the network boundary.
    const hostname = req.hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) return res.status(403).json({ error: '本地服务仅接受 localhost 访问' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        let parsed;
        try { parsed = new URL(origin); } catch { return res.status(403).json({ error: '请求来源无效' }); }
        const sameOrigin = parsed.origin === `${req.protocol}://${req.get('host')}`;
        const localDev = ['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && ['3000', '3001', '4173', '5173', '5174', '5175'].includes(parsed.port);
        if (!sameOrigin && !localDev) return res.status(403).json({ error: '已拒绝跨站写入请求，请在本地应用内操作' });
      } else if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '已拒绝跨站写入请求' });
    }
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/runtime', (_req, res) => res.json({ mode: 'local', authRequired: false, serviceName: 'DataAgent', version: '1.1.0' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (req, res) => res.json({ project: { ...PROJECT, ...(options.cloud ? { description: '游戏运营数据分析工作台 · 云端个人工作空间' } : {}) }, tasks: store.list('task').map(publicTask), datasets: store.list('dataset').map(publicDataset), wallet: store.wallet(), skills: SKILLS, domains: DOMAINS, settings: publicSettings(req) }));
  const checkDatasetLimit = () => { if (store.list('dataset').length >= (options.maxDatasets ?? Infinity)) throw statusError('每个账号最多保存 20 份数据，请先删除不再使用的数据', 429); };
  app.post('/api/datasets/demo', (_req, res) => {
    checkDatasetLimit();
    const dataset = generateDemo(); store.put('dataset', dataset); res.status(201).json({ dataset: publicDataset(dataset) });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3, fileSize: 20 * 1024 * 1024, fields: 2, parts: 5 } });
  app.post('/api/datasets/upload', upload.array('files', 3), trackAsync(async (req, res) => {
    try {
      checkDatasetLimit();
      const files = req.files?.map(file => {
        // Multipart's default filename charset is Latin-1; browsers commonly send UTF-8 bytes.
        let originalname = file.originalname;
        if ([...originalname].every(char => char.charCodeAt(0) <= 255)) {
          try { originalname = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(originalname, 'latin1')); } catch { /* Genuine Latin-1 filename: keep it. */ }
        }
        return { ...file, originalname };
      });
      const dataset = await parseFiles(files); checkDatasetLimit(); store.put('dataset', dataset); res.status(201).json({ dataset: publicDataset(dataset) });
    }
    catch (error) { throw statusError(error.message, error.status || 400); }
  }));
  app.get('/api/datasets/:id', (req, res) => res.json({ dataset: publicDataset(datasetById(req.params.id)) }));
  app.delete('/api/datasets/:id', (req, res) => {
    const dataset = datasetById(req.params.id);
    if (store.list('task').some(t => t.datasetId === dataset.id && ['running', 'awaiting_approval'].includes(t.status))) throw statusError('该数据集正在被未完成任务使用，请先完成或取消任务', 409);
    store.delete('dataset', dataset.id); res.json({ ok: true });
  });
  app.post('/api/tasks', (req, res) => {
    const input = req.body || {};
    const title = textField(input.title, '任务名称', 100);
    const goal = textField(input.goal, '分析目标', 3000);
    if (!['collaborative', 'automatic'].includes(input.mode)) throw statusError('请选择协作模式或自动模式');
    if (input.domain !== 'game') throw statusError('当前仅开放游戏运营分析');
    if (typeof input.useAI !== 'boolean') throw statusError('useAI 必须为布尔值');
    const dataset = datasetById(input.datasetId);
    const requestKey = getKey(req);
    if (input.useAI) {
      options.assertModelSettings?.(settings);
      if (!requestKey) throw statusError('尚未设置 API Key；请先配置模型或切换为本地分析');
    }
    if (store.list('task').filter(t => ['running', 'awaiting_approval'].includes(t.status)).length >= (options.maxConcurrentTasks ?? Infinity)) throw statusError('每个账号最多同时运行 2 个任务，请先完成或取消现有任务', 429);
    const task = createTask({ ...input, title, goal }, dataset, settings.model);
    store.createTask(task);
    if (task.useAI) workflow.captureModel(task.id, { settings, key: requestKey, fetchImpl: options.fetchImpl || fetch, timeoutMs: options.modelTimeoutMs || 30000 });
    res.status(201).json(taskWallet(task)); workflow.schedule(task.id);
  });
  app.get('/api/tasks/:id', (req, res) => res.json(taskWallet(taskById(req.params.id))));
  app.post('/api/tasks/:id/approve', (req, res) => {
    const message = req.body?.message === undefined ? '' : textField(req.body.message, '消息', 3000, false);
    const stepId = req.body?.stepId;
    if (stepId !== undefined && !['plan', 'report'].includes(stepId)) throw statusError('批准节点必须为 plan 或 report');
    res.json(taskWallet(workflow.approve(taskById(req.params.id), message, stepId)));
  });
  app.post('/api/tasks/:id/message', (req, res) => {
    const message = textField(req.body?.message, '消息', 3000);
    const task = taskById(req.params.id);
    if (!['running', 'awaiting_approval'].includes(task.status)) throw statusError('任务已结束，不能追加业务背景', 409);
    if (task.useAI && workflow.isModelContextLocked(task.id)) throw statusError('模型请求已发出，无法再纳入本次报告；请在下次分析补充业务背景。', 409);
    if (task.messages.length >= 100) throw statusError('单个任务最多 100 条消息');
    task.messages.push(makeMessage('user', message)); task.updatedAt = new Date().toISOString();
    task.events.push(makeEvent('info', '收到业务背景', '业务背景已保存，将在报告阶段读取。'));
    store.put('task', task); res.json({ task: publicTask(task) });
  });
  app.post('/api/tasks/:id/cancel', (req, res) => res.json(taskWallet(workflow.cancel(taskById(req.params.id)))));
  app.get('/api/tasks/:id/report.md', (req, res) => {
    const task = taskById(req.params.id);
    if (task.status !== 'completed' || !task.report) throw statusError('报告尚未完成', 409);
    res.setHeader('Content-Disposition', `attachment; filename="dataagent-report-${task.id}.md"`);
    res.type('text/markdown; charset=utf-8').send(reportMarkdown(task));
  });
  app.get('/api/wallet', (_req, res) => res.json({ wallet: store.wallet(), transactions: store.transactions() }));
  app.get('/api/settings', (req, res) => res.json({ settings: publicSettings(req) }));
  app.put('/api/settings', (req, res) => {
    let next;
    try { next = validateSettings(req.body || {}, settings); options.assertModelSettings?.(next); } catch (error) { throw statusError(error.message); }
    let nextKey = getKey(req);
    if (req.body?.clearKey === true) nextKey = '';
    else if (req.body?.apiKey !== undefined) {
      try { nextKey = validateKey(req.body.apiKey); } catch (error) { throw statusError(error.message); }
    }
    settings = next; setKey(req, nextKey);
    // Persist the allowlisted non-secret settings only. Key always remains in process memory.
    store.config('settings', { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model });
    res.json({ settings: publicSettings(req) });
  });
  app.post('/api/settings/test', trackAsync(async (req, res) => {
    const requestKey = getKey(req);
    try {
      options.assertModelSettings?.(settings);
      await chat({ settings, key: requestKey, fetchImpl: options.fetchImpl || fetch, timeoutMs: options.modelTimeoutMs || 30000, maxTokens: 8, messages: [{ role: 'user', content: '只回复 OK，用于检查连接。' }] });
      res.json({ ok: true, message: '模型连接成功。本次进行了真实的小型模型调用，供应商可能计入用量。' });
    } catch (error) { throw statusError(redact(error.message, requestKey), 400); }
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  const dist = options.distDir || path.join(root, 'dist');
  if (options.serveStatic !== false && existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) res.sendFile(path.join(dist, 'index.html')); else next(); });
  }
  app.use((error, req, res, _next) => {
    let status = error.status || (error instanceof multer.MulterError ? 400 : 500);
    let message = error.message || '服务内部错误';
    if (error instanceof multer.MulterError) message = error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 20MB' : '上传受限：最多 3 个文件，总大小 20MB，请检查文件字段 files';
    if (error.type === 'entity.parse.failed') { status = 400; message = 'JSON 请求格式无效'; }
    if (status >= 500) message = '服务处理失败，请检查数据或重试；敏感错误细节已隐藏';
    res.status(status).json({ error: redact(message, getKey(req)) });
  });
  return app;
}
