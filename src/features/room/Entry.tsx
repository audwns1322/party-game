import { useState, type FormEvent } from 'react';
import { api, messageFor, type Issued } from '../../lib/api';
import { navigate } from '../../lib/router';
import { saveSession } from '../../lib/session';

/** /room/:code without a stored session: join with a nickname, or continue from another device. */
export function Entry({ code, onIssued }: { code: string; onIssued: (issued: Issued, nickname?: string) => void }) {
  const [language,setLanguage]=useState<'ko'|'en'>(()=>new URLSearchParams(location.search).get('lang')==='en'?'en':'ko');
  const t=(ko:string,english:string)=>language==='en'?english:ko;
  const [recover, setRecover] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!recover && value.trim().length < 2) { setError(t('닉네임을 2자 이상 입력해 주세요.','Enter a nickname with at least 2 characters.')); return; }
    if (recover && value.replace(/[\s-]/g, '').length < 26) { setError(t('이어하기 코드 26자를 모두 입력해 주세요.','Enter all 26 characters of the recovery code.')); return; }
    setBusy(true);
    try {
      const issued = recover ? await api.recover(code, value) : await api.join(code, value);
      saveSession({ ...issued, nickname: recover ? undefined : value });
      onIssued(issued, recover ? undefined : value);
    } catch (e) { setError(messageFor(e,language)); } finally { setBusy(false); }
  }

  return (
    <main>
      <span className="badge">{t('방 코드','Room code')} {code}</span>
      <label>{t('언어','Language')}<select value={language} onChange={e=>{setLanguage(e.target.value as 'ko'|'en');setError('');}}><option value="ko">한국어</option><option value="en">English</option></select></label>
      <h1>{recover ? t('다른 기기에서 이어하기','Continue on another device') : t('방에 참가하기','Join room')}</h1>
      <form onSubmit={submit} className="card" noValidate>
        <label>{recover ? t('이어하기 코드','Recovery code') : t('닉네임','Nickname')}
          <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off"
            {...(recover
              ? { placeholder: 'XXXX-XXXX-…', autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false }
              : { placeholder: t('2~16자','2–16 characters'), enterKeyHint: 'go' as const })} />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? t('잠시만요…','Please wait…') : recover ? t('이어하기','Continue') : t('참가하기','Join')}</button>
      </form>
      <button type="button" className="link" onClick={() => { setRecover(!recover); setValue(''); setError(''); }}>
        {recover ? t('새로 참가하기','Join as a new player') : t('이미 이 방에 있었나요? 이어하기 코드로 계속하기','Already in this room? Continue with your recovery code')}
      </button>
      <button type="button" className="link" onClick={() => navigate('/')}>{t('처음으로','Home')}</button>
    </main>
  );
}
