import { useState, type FormEvent } from 'react';
import { api, apiConfigured, messageFor, type Issued } from '../../lib/api';
import { navigate } from '../../lib/router';
import { listSessions, saveSession } from '../../lib/session';

/** Pulls a 6-digit room code out of pasted text such as "방 코드 123456" or an invite link. */
export function extractCode(text: string): string {
  return text.match(/\d{6}/)?.[0] ?? text.replace(/\D/g, '').slice(0, 6);
}

export function Home({ onIssued }: { onIssued: (issued: Issued, nickname: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = listSessions();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'join' && !/^\d{6}$/.test(code)) { setError('방 코드 숫자 6자리를 입력해 주세요.'); return; }
    if (nickname.trim().length < 2) { setError('닉네임을 2자 이상 입력해 주세요.'); return; }
    // Already in this room on this device: go back instead of creating a second seat.
    if (mode === 'join' && rooms.some((r) => r.code === code)) { navigate(`/room/${code}`); return; }
    setBusy(true);
    try {
      const issued = mode === 'create' ? await api.create(nickname) : await api.join(code, nickname);
      saveSession({ ...issued, nickname });
      onIssued(issued, nickname);
      navigate(`/room/${issued.code}`);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  return (
    <main>
      <span className="badge">PARTY GAME · LIAR</span>
      <h1>함께 모여,<br />시작하는 즐거움</h1>
      <p>계정 없이 함께하는 3~15인 라이어 게임</p>
      {!apiConfigured && <p role="alert" className="error">서버 설정(.env.local)이 없어요.</p>}

      {rooms.length > 0 && (
        <section className="card" aria-labelledby="resume">
          <h2 id="resume">참가 중인 방</h2>
          {rooms.map((r) => (
            <button key={r.code} type="button" className="primary" onClick={() => navigate(`/room/${r.code}`)}>
              {r.code} 방으로 돌아가기{r.nickname ? ` (${r.nickname})` : ''}
            </button>
          ))}
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="시작 방법"
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const next = mode === 'create' ? 'join' : 'create'; setMode(next); setError(''); document.getElementById(`tab-${next}`)?.focus(); } }}>
        <button type="button" role="tab" id="tab-create" aria-controls="start-panel" aria-selected={mode === 'create'} tabIndex={mode === 'create' ? 0 : -1} onClick={() => { setMode('create'); setError(''); }}>방 만들기</button>
        <button type="button" role="tab" id="tab-join" aria-controls="start-panel" aria-selected={mode === 'join'} tabIndex={mode === 'join' ? 0 : -1} onClick={() => { setMode('join'); setError(''); }}>참가하기</button>
      </div>
      <form id="start-panel" role="tabpanel" aria-labelledby={mode === 'create' ? 'tab-create' : 'tab-join'} onSubmit={submit} className="card" noValidate>
        {mode === 'join' && (
          <label>방 코드
            <input inputMode="numeric" autoComplete="off" value={code}
              onChange={(e) => setCode(extractCode(e.target.value))} placeholder="숫자 6자리" />
          </label>
        )}
        <label>닉네임
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="2~16자" autoComplete="nickname" enterKeyHint="go" />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '잠시만요…' : mode === 'create' ? '방 만들기' : '참가하기'}</button>
      </form>
    </main>
  );
}
