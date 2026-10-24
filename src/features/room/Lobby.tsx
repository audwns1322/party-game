import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { messageFor, type Session, type Settings } from '../../lib/api';
import { navigate } from '../../lib/router';
import { clearSession } from '../../lib/session';
import { useRoom } from './useRoom';

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 3;

export function Lobby({ session }: { session: Session }) {
  const { snapshot, fatal, run } = useRoom(session);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const inviteUrl = `${location.origin}/room/${session.code}`;

  useEffect(() => { QRCode.toDataURL(inviteUrl, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')); }, [inviteUrl]);
  useEffect(() => { if (fatal) clearSession(session.code); }, [fatal, session.code]);

  async function act(action: string, payload?: object) {
    setBusy(true); setError('');
    try { await run(action, payload); } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: '라이어 게임 초대', text: `방 코드 ${session.code}`, url: inviteUrl });
      else { await navigator.clipboard.writeText(inviteUrl); setError('초대 링크를 복사했어요.'); }
    } catch { /* user cancelled */ }
  }

  if (fatal) {
    return (
      <main>
        <h1>{fatal.code === 'ROOM_CLOSED' ? '종료된 방이에요' : '참가 정보가 없어요'}</h1>
        <p>{messageFor(fatal)}</p>
        <button className="primary" onClick={() => navigate('/')}>처음으로</button>
      </main>
    );
  }
  if (!snapshot) return <main><p aria-live="polite">방 정보를 불러오는 중…</p></main>;

  const { room, me, players } = snapshot;
  const isHost = me.is_host;
  const setting = (patch: Partial<Settings>) => act('update_settings', patch);

  return (
    <main>
      <span className="badge">대기실</span>
      <h1 className="code" aria-label={`방 코드 ${room.code}`}>{room.code}</h1>
      <section className="card invite">
        {qr && <img src={qr} alt="초대 QR 코드" width={160} height={160} />}
        <button type="button" onClick={share}>초대 링크 보내기</button>
      </section>

      <section className="card" aria-labelledby="roster">
        <h2 id="roster">참가자 {players.length}/{MAX_PLAYERS}</h2>
        <ul className="roster">
          {players.map((p) => (
            <li key={p.id}>
              <span className="name">{p.nickname}</span>
              {p.id === room.host_player_id && <span className="tag host">방장</span>}
              {p.id === me.player_id && <span className="tag">나</span>}
              <span className={`tag ${p.connected ? 'on' : 'off'}`}>{p.connected ? '연결됨' : '연결 끊김'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="settings">
        <h2 id="settings">게임 설정 {isHost ? '' : '(방장만 변경)'}</h2>
        <label>제시어
          <select disabled={!isHost || busy} value={room.settings.word_mode} onChange={(e) => setting({ word_mode: e.target.value as Settings['word_mode'] })}>
            <option value="builtin">기본 제시어</option>
            <option value="custom">직접 입력</option>
          </select>
        </label>
        <label>힌트 바퀴 수
          <select disabled={!isHost || busy} value={room.settings.hint_rounds} onChange={(e) => setting({ hint_rounds: Number(e.target.value) as Settings['hint_rounds'] })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}바퀴</option>)}
          </select>
        </label>
        <label>토론 시간
          <select disabled={!isHost || busy} value={room.settings.discussion_seconds} onChange={(e) => setting({ discussion_seconds: Number(e.target.value) as Settings['discussion_seconds'] })}>
            {[60, 120, 180, 300].map((s) => <option key={s} value={s}>{s / 60}분</option>)}
            <option value={0}>무제한</option>
          </select>
        </label>
      </section>

      {error && <p role="status" className="error">{error}</p>}
      {isHost && (
        <button className="primary" disabled>
          {players.length < MIN_PLAYERS ? `${MIN_PLAYERS}명 이상 모이면 시작할 수 있어요` : '게임 시작 (다음 단계에서 제공)'}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => { if (confirm('방에서 나갈까요?')) void act('leave').then(() => { clearSession(session.code); navigate('/'); }); }}>방 나가기</button>
      {isHost && <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm('방을 종료할까요? 모든 참가자가 나가게 돼요.')) void act('close_room'); }}>방 종료</button>}
    </main>
  );
}
