import { useState, type FormEvent } from 'react';
import { api, apiConfigured, messageFor, type Issued } from '../../lib/api';
import { navigate } from '../../lib/router';
import { saveSession } from '../../lib/session';

export function Home({ onIssued }: { onIssued: (issued: Issued) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const issued = mode === 'create' ? await api.create(nickname) : await api.join(code, nickname);
      saveSession(issued);
      onIssued(issued);
      navigate(`/room/${issued.code}`);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  return (
    <main>
      <span className="badge">PARTY GAME · LIAR</span>
      <h1>함께 모여,<br />시작하는 즐거움</h1>
      <p>계정 없이 함께하는 3~12인 라이어 게임</p>
      {!apiConfigured && <p role="alert" className="error">서버 설정(.env.local)이 없어요.</p>}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>방 만들기</button>
        <button type="button" role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>참가하기</button>
      </div>
      <form onSubmit={submit} className="card">
        {mode === 'join' && (
          <label>방 코드
            <input inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d{6}" required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="숫자 6자리" />
          </label>
        )}
        <label>닉네임
          <input required minLength={2} maxLength={16} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="2~16자" />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '잠시만요…' : mode === 'create' ? '방 만들기' : '참가하기'}</button>
      </form>
    </main>
  );
}
