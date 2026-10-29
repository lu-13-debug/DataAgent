import { useState } from 'react';
export function EvidenceText({ text }: { text: string }) {
  const [highlighted, setHighlighted] = useState(false);
  return <button type="button" className="evidence-text" aria-label={`${highlighted ? '取消高亮' : '高亮'}数据依据：${text}`} aria-pressed={highlighted} disabled={!text.trim()} onClick={() => setHighlighted(value => !value)}>{highlighted ? <mark>{text}</mark> : text}<span className="evidence-action-label">{highlighted ? '已高亮' : '高亮依据'}</span></button>;
}
