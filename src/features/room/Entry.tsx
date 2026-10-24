import { useState, type FormEvent } from 'react';
import { api, messageFor, type Issued } from '../../lib/api';
import { navigate } from '../../lib/router';
import { saveSession } from '../../lib/session';

/** /room/:code without a stored session: join with a nickname, or recover from another device. */
export function Entry({ code, onIssued, notice }: { code: string; onIssued: (issued: Issued) => void; notice?: string }) {
  const [recover, setRecover] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState(notice ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const issued = recover ? await api.recover(code, value) : await api.join(code, value);
      saveSession(issued);
      onIssued(issued);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }

  return (
    <main>
      <span className="badge">방 코드 {code}</span>
      <h1>{recover ? '이어서 참가하기' : '방에 참가하기'}</h1>
      <form onSubmit={submit} className="card">
        <label>{recover ? '복구 코드' : '닉네임'}
          <input required value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off"
            {...(recover ? { placeholder: 'XXXX-XXXX-…', autoCapitalize: 'characters' } : { minLength: 2, maxLength: 16, placeholder: '2~16자' })} />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '잠시만요…' : recover ? '복구하기' : '참가하기'}</button>
      </form>
      <button type="button" className="link" onClick={() => { setRecover(!recover); setValue(''); setError(''); }}>
        {recover ? '새로 참가하기' : '다른 기기에서 참가했었나요? 복구 코드로 이어하기'}
      </button>
      <button type="button" className="link" onClick={() => navigate('/')}>처음으로</button>
    </main>
  );
}
