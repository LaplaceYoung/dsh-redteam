import React from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { errorMessage } from '../management-ui/shared.js';

export const conversationPath = '/api/redteam/conversation-workspace';
export const conversationUrl = (id: string, action = '') => `${conversationPath}/conversations/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
export const jsonBody = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) });
export const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

/** Async results belong to the mounted scope; switching scopes never updates its successor. */
export function useOperation() {
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const mounted = React.useRef(true), locked = React.useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = React.useCallback(async (work: () => Promise<void>, success = '') => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); if (mounted.current) setNotice(success); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }, []);
  return { busy, error, notice, run, setError, setNotice };
}

export function ConfirmDelete({ label, description, disabled, onConfirm }: {
  label: string; description: string; disabled?: boolean; onConfirm(): Promise<void>;
}) {
  const [confirm, setConfirm] = React.useState(false);
  return confirm ? <div className="tw-gap" role="group" aria-label={`确认${label}`}><p>{description}</p><div className="tw-actions">
    <Button size="sm" disabled={disabled} onClick={() => { void onConfirm().then(() => setConfirm(false)); }}>确认{label}</Button>
    <Button size="sm" disabled={disabled} onClick={() => setConfirm(false)}>取消</Button>
  </div></div> : <Button size="sm" disabled={disabled} onClick={() => setConfirm(true)}>{label}</Button>;
}
