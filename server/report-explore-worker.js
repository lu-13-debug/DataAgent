import { parentPort, workerData } from 'node:worker_threads';
import { computeExploration } from './report-explore.js';
try { parentPort.postMessage({ result: computeExploration(workerData.dataset, workerData.task, workerData.input) }); }
catch (error) { parentPort.postMessage({ error: error.status && error.status < 500 ? error.message : '源数据无法完成探索统计，请检查日期、币种与数据结构', status: error.status || 400 }); }
