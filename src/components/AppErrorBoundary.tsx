import { Component, createRef } from 'react';
import type { ReactNode } from 'react';
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { version } from '../../package.json';
import { buildDiagnostic } from '../diagnostics';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; diagnostic: string; copied: boolean; manual: boolean }> {
  state = { failed: false, diagnostic: '', copied: false, manual: false };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError(error: unknown) { return { failed: true, diagnostic: buildDiagnostic(error, version), copied: false, manual: false }; }
  componentDidCatch() { this.heading.current?.focus(); }
  private copy = async () => {
    try { await navigator.clipboard.writeText(this.state.diagnostic); this.setState({ copied: true, manual: false }); }
    catch { this.setState({ manual: true, copied: false }); }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-error-boundary" id="main-content">
      <div className="error-recovery card"><TriangleAlert size={32} aria-hidden="true" />
        <h1 ref={this.heading} tabIndex={-1}>界面暂时无法显示</h1>
        <p role="alert">请重新载入后再试。如果问题重复出现，可复制诊断信息交给维护人员。</p>
        <div className="recovery-actions"><button className="button primary" onClick={() => window.location.reload()}><RefreshCw size={16} />重新载入</button><button className="button secondary" onClick={() => void this.copy()}><Copy size={16} />复制诊断信息</button></div>
        <p className="field-help">诊断仅含错误码、版本、异常类型和时间，不含 API Key 或业务数据。</p>
        <p className="recovery-status" role="status" aria-live="polite">{this.state.copied ? '诊断信息已复制。' : this.state.manual ? '自动复制不可用，请选择下面的文本并复制。' : ''}</p>
        {this.state.manual && <label className="field">诊断信息<textarea readOnly value={this.state.diagnostic} rows={7} onFocus={event => event.currentTarget.select()} /></label>}
      </div>
    </main>;
  }
}
