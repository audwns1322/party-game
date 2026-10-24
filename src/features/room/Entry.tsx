import { useState, type FormEvent } from 'react';
import { api, messageFor, type Issued } from '../../lib/api';
import { navigate } from '../../lib/router';
import { saveSession } from '../../lib/session';

/** /room/:code without a stored session: join with a nickname, or continue from another device. */
export function Entry({ code, onIssued }: { code: string; onIssued: (issued: Issued, nickname?: string) => void }) {
  const [recover, setRecover] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!recover && value.trim().length < 2) { setError('닉네임을 2자 이상 입력해 주세요.'); return; }
    if (recover && value.replace(/[\s-]/g, '').length < 26) { setError('이어하기 코드 26자를 모두 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const issued = recover ? await api.recover(code, value) : await api.join(code, value);
      saveSession({ ...issued, nickname: recover ? undefined : value });
      onIssued(issued, recover ? undefined : value);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  return (
    <main>
      <span className="badge">방 코드 {code}</span>
      <h1>{recover ? '다른 기기에서 이어하기' : '방에 참가하기'}</h1>
      <form onSubmit={submit} className="card" noValidate>
        <label>{recover ? '이어하기 코드' : '닉네임'}
          <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off"
            {...(recover
              ? { placeholder: 'XXXX-XXXX-…', autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false }
              : { placeholder: '2~16자', enterKeyHint: 'go' as const })} />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '잠시만요…' : recover ? '이어하기' : '참가하기'}</button>
      </form>
      <button type="button" className="link" onClick={() => { setRecover(!recover); setValue(''); setError(''); }}>
        {recover ? '새로 참가하기' : '이미 이 방에 있었나요? 이어하기 코드로 계속하기'}
      </button>
      <button type="button" className="link" onClick={() => navigate('/')}>처음으로</button>
    </main>
  );
}
