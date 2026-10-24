import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { passwordChangeError } from '../account-validation';
import { useAuth } from '../auth-context';
import { Modal, Spinner } from './ui';

export function AccountModal({ close }: { close: () => void }) {
  const { user, endSession } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validation = passwordChangeError(currentPassword, newPassword, confirmPassword);
    if (validation) { setError(validation); return; }
    setBusy('password');
    setError('');
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      endSession('密码已修改，所有设备的会话均已退出。请使用新密码登录。');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(''); }
  }
  async function logout() {
    if (busy) return;
    setBusy('logout');
    setError('');
    try { await api.logout(); endSession('你已安全退出当前账号。'); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(''); }
  }
  return <Modal title="账号与安全" subtitle="管理当前账号的登录与密码。" close={close}>
    <div className="modal-body account-modal-body">
      <div className="account-summary"><span className="avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user?.displayName}</strong><span>@{user?.username}</span></div><ShieldCheck size={20} /></div>
      <form onSubmit={event => void changePassword(event)} noValidate aria-busy={busy === 'password'}>
        <h3 className="account-section-title"><KeyRound size={16} />修改密码</h3>
        <p className="field-help account-password-note">修改后，所有设备的登录会话都会失效，需要重新登录。</p>
        <label className="field" htmlFor="account-current-password">当前密码<input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={!!busy} required /></label>
        <label className="field" htmlFor="account-new-password">新密码<input id="account-new-password" aria-label="新密码" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={!!busy} required aria-describedby="account-password-help" /><small className="field-help" id="account-password-help">10–128 个字符，空格会原样保留。</small></label>
        <label className="field" htmlFor="account-confirm-password">确认新密码<input id="account-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={!!busy} required /></label>
        {error && <p ref={errorRef} className="form-error auth-error" role="alert" tabIndex={-1}>{error}</p>}
        <button type="submit" className="button primary full-width" disabled={!!busy}>{busy === 'password' ? <Spinner size={15} /> : <KeyRound size={15} />}{busy === 'password' ? '正在修改密码…' : '修改密码并重新登录'}</button>
      </form>
      <p className="account-admin-note">无法登录或需要账号协助，请联系本服务管理员。</p>
    </div>
    <div className="modal-footer"><span className="field-help">退出会清除本次登录会话的模型 Key。</span><button className="button secondary" type="button" onClick={() => void logout()} disabled={!!busy}>{busy === 'logout' ? <Spinner size={15} /> : <LogOut size={15} />}{busy === 'logout' ? '正在退出…' : '退出登录'}</button></div>
  </Modal>;
}
