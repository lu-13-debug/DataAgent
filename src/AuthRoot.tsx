import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Database, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, onSessionExpired, resetSessionBoundary } from './api';
import { registrationError } from './account-validation';
import { AuthContext } from './auth-context';
import type { Runtime, User } from './types';
import { Logo, Spinner } from './components/ui';

export function AuthRoot({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState(0);
  const endSession = useCallback((message: string) => {
    resetSessionBoundary();
    setUser(null);
    setNotice(message);
    setSession(value => value + 1);
  }, []);

  useEffect(() => onSessionExpired(() => {
    if (runtime?.mode === 'cloud') endSession('登录已失效，请重新登录。');
  }), [runtime?.mode, endSession]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    async function connect() {
      try {
        const next = await api.runtime();
        if (next.serviceName !== 'DataAgent' || !['local', 'cloud'].includes(next.mode) || next.authRequired !== (next.mode === 'cloud')) throw new Error('该地址未提供兼容的 DataAgent 服务，请确认服务配置。');
        const current = next.mode === 'cloud' ? (await api.session()).user : null;
        if (!alive) return;
        resetSessionBoundary();
        setRuntime(next);
        setUser(current);
      } catch (cause) { if (alive) setError((cause as Error).message); }
      finally { if (alive) setLoading(false); }
    }
    void connect();
    return () => { alive = false; };
  }, [attempt]);

  if (loading || error || !runtime) return <div className="app-loading" aria-busy={loading}>
    <div className="loading-brand"><Logo /><strong>DataAgent.</strong></div>
    {error ? <><h2>连接分析服务时遇到问题</h2><p role="alert">{error}</p><button className="button primary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} />重试连接</button><small>请检查网络和所连接的服务地址；服务管理员可检查部署状态。</small></> : <><Spinner size={24} /><p role="status">正在连接你的分析服务…</p></>}
  </div>;

  if (runtime.mode === 'cloud' && !user) return <AuthPage notice={notice} onAuthenticated={next => {
    resetSessionBoundary();
    setNotice('');
    setUser(next);
    setSession(value => value + 1);
  }} />;

  return <AuthContext.Provider key={session} value={{ runtime, user, endSession }}>{children}</AuthContext.Provider>;
}

function AuthPage({ notice, onAuthenticated }: { notice: string; onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const register = mode === 'register';
  useEffect(() => { usernameRef.current?.focus(); }, [mode]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function switchMode(next: 'login' | 'register') { setMode(next); setError(''); setPassword(''); setConfirmPassword(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validation = register ? registrationError({ username, displayName, password, confirmPassword }) : !username || !password ? '请填写用户名和密码。' : password.length > 128 ? '密码不能超过 128 个字符。' : '';
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError('');
    try {
      const result = register ? await api.register({ username, displayName: displayName.trim(), password }) : await api.login({ username, password });
      setPassword('');
      setConfirmPassword('');
      onAuthenticated(result.user);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <div className="auth-layout">
      <section className="auth-intro" aria-label="DataAgent 账号介绍">
        <div className="auth-brand"><Logo /><span>DataAgent<span className="brand-dot">.</span></span></div>
        <span className="auth-eyebrow">从数据出发，为决策而来</span>
        <h1>你的数据，<br />你的下一步<span>。</span></h1>
        <p>连接团队的分析服务，让每一次探索都留在自己的工作空间。</p>
        <div className="auth-features"><div><Database size={18} /><span>数据与报告按账号保存</span></div><div><ShieldCheck size={18} /><span>新账号获赠 500 试用额度</span></div><div><LockKeyhole size={18} /><span>同一服务，换电脑也能继续分析</span></div></div>
        <div className="auth-service"><span className="online-dot" /><span>已连接云端服务<strong>{window.location.host}</strong></span></div>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-switch" aria-label="账号操作"><button type="button" aria-pressed={!register} className={!register ? 'selected' : ''} onClick={() => switchMode('login')} disabled={busy}>登录</button><button type="button" aria-pressed={register} className={register ? 'selected' : ''} onClick={() => switchMode('register')} disabled={busy}>创建账号</button></div>
        <h2 id="auth-title">{register ? '创建你的工作空间' : '欢迎回来'}</h2><p className="auth-subtitle">{register ? '注册后即可使用分析工作台，无需邮箱。' : '登录后，继续查看你的数据与分析报告。'}</p>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={event => void submit(event)} noValidate aria-busy={busy}>
          <label className="field" htmlFor="auth-username">用户名<input id="auth-username" name="username" aria-label="用户名" ref={usernameRef} value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} required aria-describedby="auth-username-help" /><small className="field-help" id="auth-username-help">3–32 个英文字母、数字或下划线，不区分大小写。</small></label>
          {register && <label className="field" htmlFor="auth-display-name">显示名称<input id="auth-display-name" name="displayName" aria-label="显示名称" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="nickname" disabled={busy} required /><small className="field-help">1–40 个字符，可以使用中文。</small></label>}
          <label className="field" htmlFor="auth-password">密码<input id="auth-password" name="password" aria-label="密码" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required aria-describedby={register ? 'auth-password-help' : undefined} />{register && <small className="field-help" id="auth-password-help">10–128 个字符，空格会原样保留。</small>}</label>
          {register && <label className="field" htmlFor="auth-confirm-password">确认密码<input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={busy} required /></label>}
          {error && <p className="form-error auth-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
          <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? <Spinner size={17} /> : <ArrowRight size={17} />}{busy ? register ? '正在创建账号…' : '正在登录…' : register ? '注册并进入工作台' : '登录工作台'}</button>
        </form>
        <p className="auth-help">{register ? '试用额度暂不提供真实支付充值。' : '无法登录时，请联系本服务管理员。'}</p>
      </section>
    </div>
    <footer className="auth-footer">上传数据与报告保存在所连接的服务器，并按账号隔离。模型仅接收业务背景与聚合指标。</footer>
  </main>;
}
