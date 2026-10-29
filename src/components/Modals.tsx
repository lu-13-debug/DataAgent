import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, Database, FileSpreadsheet, Gamepad2, GitBranch, KeyRound, MessageSquare, Plus, ShieldCheck, Sparkles, UploadCloud, WandSparkles, X, Zap } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth-context';
import type { Dataset, Domain, Mode, Settings, Skill, Task, Wallet } from '../types';
import { Checked, downloadText, Modal, number, Spinner } from './ui';
import { analysisAccess, ANALYSIS_COST } from '../product-state';

export { NewAnalysis } from './NewAnalysis';
export { SettingsModal } from './ModelSettings';
export { DataPreview } from './DataPreview';
export function DomainModal({ domains, close }: { domains: Domain[]; close: () => void }) { return <Modal title="分析领域说明" subtitle="当前工作空间使用游戏运营指标、Skill 与报告模板。" close={close}><div className="modal-body domain-options">{domains.map(d => <div className={`domain-option ${d.enabled ? 'selected' : ''}`} key={d.id}><span className="domain-icon">{d.id === 'game' ? <Gamepad2 size={22} /> : <Database size={22} />}</span><div><strong>{d.name}</strong><p>{d.description}</p></div><span className={d.enabled ? 'green-tag' : 'tiny-tag'}>{d.enabled ? '当前领域' : '暂未开放'}</span></div>)}<p className="field-help">首版专注游戏研发与运营。后续领域会独立配置数据规范和分析工作流。</p></div><div className="modal-footer"><span /><button className="button primary" onClick={close}>继续游戏分析<ArrowRight size={15} /></button></div></Modal>; }
export function SkillModal({ skill, close }: { skill: Skill; close: () => void }) { return <Modal title={skill.name} subtitle={`${skill.category} · v${skill.version}`} close={close}><div className="modal-body"><div className="skill-detail-icon"><GitBranch size={28} /></div><p className="skill-description">{skill.description}</p><div className="skill-detail-row"><span>能力状态</span><strong className="green-text">已启用</strong></div><div className="skill-detail-row"><span>执行方式</span><strong>{skill.id.includes('report') || skill.id.includes('insight') ? '计算结果 + 可选 AI 解读' : '确定性数据计算'}</strong></div><div className="skill-detail-row"><span>适用工作流</span><strong>游戏运营诊断</strong></div><div className="settings-notice"><ShieldCheck size={18} /><p>工作流会根据可用数据调用该能力。每个阶段保留执行记录和结果摘要，缺少必要数据时明确跳过。</p></div></div><div className="modal-footer"><span className="subtle-label">{skill.id}</span><button className="button primary" onClick={close}>了解了</button></div></Modal>; }
export { HelpModal } from './HelpModal';
