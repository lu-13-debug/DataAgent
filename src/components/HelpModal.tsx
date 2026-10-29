import { ArrowRight, Download, Info } from 'lucide-react';
import { useAuth } from '../auth-context';
import { ANALYSIS_COST } from '../product-state';
import { downloadText, Modal } from './ui';

export function HelpModal({ close, section = 'general', onReviewOnboarding, onStartCollaborative, canStart = true, onShortcuts }: {
  close: () => void; section?: 'general' | 'collaboration'; onReviewOnboarding: () => void; onStartCollaborative: () => void; canStart?: boolean; onShortcuts: () => void;
}) {
  const { runtime } = useAuth();
  const cloud = runtime.mode === 'cloud';
  const collaboration = section === 'collaboration';
  const steps = collaboration ? [
    { title: '先检查数据与范围', text: '工作流检查字段、时间与数据质量，再整理分析计划。' },
    { title: '由你确认分析计划', text: '在“确认并继续”之前，可以检查范围、补充版本更新或运营活动背景。' },
    { title: '计算指标并整理发现', text: '指标由分析引擎计算，配置模型后可选择 AI 辅助解读。' },
    { title: '确认后生成报告', text: '报告生成前再次等待你确认，完成后可阅读、下载或打印。' },
  ] : [
    { title: '先读一份示例报告', text: '了解关键指标、数据依据和建议，阅读不扣额度。' },
    { title: '上传或选择数据', text: '在数据源页上传 CSV / Excel，或先选择示例数据。' },
    { title: '确认范围，生成报告', text: `协作模式会在两个关键步骤等待确认；每次真实分析消耗 ${ANALYSIS_COST} 服务额度。` },
  ];
  return <Modal title={collaboration ? '协作流程说明' : '使用指南'} subtitle={collaboration ? '只读了解流程，再决定是否开始一次真实分析。' : '先看示例，再用自己的数据得到报告。'} close={close}>
    <div className="modal-body guide-body">
      {collaboration ? <div className="readonly-guide" role="note"><Info size={18} /><div><strong>只读说明，不会运行任务或扣除额度。</strong><p>新建真实分析需 {ANALYSIS_COST} 额度，须在新建弹窗中确认；选择 AI 时，模型费用另由你的 API 账户支付。</p></div></div>
        : <button className="button secondary review-onboarding" onClick={onReviewOnboarding}>重看三步清单<ArrowRight size={14} /></button>}
      {steps.map((step, index) => <div className="guide-step" key={step.title}><span>{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></div>)}
      {!collaboration && <button className="text-button" onClick={onShortcuts}>查看快捷键（?）<ArrowRight size={14} /></button>}
      {!collaboration && <details className="guide-details"><summary>问题反馈与诊断</summary><p>可前往 <a href="https://github.com/lu-13-debug/DataAgent/issues" target="_blank" rel="noopener noreferrer">GitHub Issues 提交反馈</a>。桌面版可在顶部“帮助”菜单中选择“复制诊断信息”，包含客户端版本、当前服务地址和日志目录；信息不会自动发送，请检查后自行决定是否提供。</p></details>}
      {!collaboration && <details className="guide-details"><summary>数据字段、保存位置与导出说明</summary><p>玩家表：user_id、registered_at；活跃表：user_id、event_time；支付表：order_id、user_id、paid_at、amount、currency、status。支持常见中文别名。</p><p>{cloud ? '上传数据和报告保存在当前服务，并按账号隔离；API Key 只保留在本次登录会话的服务端内存中。' : '数据和报告保存在本机；API Key 只保留在本次服务进程内存中。'}额度为试用账本，暂不提供真实支付充值。</p><p>完整报告支持 Markdown 下载，以及打印 / 保存 PDF。模型只接收业务背景与聚合指标。</p></details>}
      {collaboration && !canStart && <p className="quota-notice" role="note">可继续阅读说明。当前额度不足，开始真实分析需 {ANALYSIS_COST} 额度。</p>}
    </div>
    <div className="modal-footer guide-footer">
      {collaboration ? <><button className="button secondary" onClick={close}>返回报告</button><button className="button primary" disabled={!canStart} onClick={onStartCollaborative}>新建协作分析 · {ANALYSIS_COST} 额度<ArrowRight size={14} /></button></>
        : <><button className="button secondary" onClick={() => downloadText('users.csv', 'user_id,registered_at,channel\nplayer_001,2026-10-01T10:00:00+08:00,自然新增\n')}><Download size={14} />下载玩家表模板</button><button className="button primary" onClick={close}>返回工作台</button></>}
    </div>
  </Modal>;
}
