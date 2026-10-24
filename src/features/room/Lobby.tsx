import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { messageFor, type Player, type Settings } from '../../lib/api';
import { navigate } from '../../lib/router';
import { clearSession, type StoredSession } from '../../lib/session';
import { useRoom } from './useRoom';

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 3;

/** Two-step confirm without native confirm(): first tap arms, second tap within 4s runs. */
function useArm() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(null), 4000); return () => clearTimeout(t); }, [armed]);
  return { armed, arm: (id: string) => setArmed(id), disarm: () => setArmed(null) };
}

/** Announce joins/leaves to screen readers. */
function useRosterAnnouncement(players: Player[] | undefined, hostId: string | undefined) {
  const previous = useRef<{ names: Map<string, string>; host?: string } | null>(null);
  const [message, setMessage] = useState('');
  const [hostChange, setHostChange] = useState('');
  useEffect(() => {
    if (!players) return;
    const names = new Map(players.map((p) => [p.id, p.nickname]));
    const before = previous.current;
    if (before) {
      const joined = [...names].filter(([id]) => !before.names.has(id)).map(([, n]) => `${n}님이 들어왔어요.`);
      const left = [...before.names].filter(([id]) => !names.has(id)).map(([, n]) => `${n}님이 나갔어요.`);
      if (joined.length || left.length) setMessage([...joined, ...left].join(' '));
      if (before.host && hostId && before.host !== hostId) setHostChange(`방장이 ${names.get(hostId) ?? '다른 참가자'}님으로 바뀌었어요.`);
    }
    previous.current = { names, host: hostId };
  }, [players, hostId]);
  return { message, hostChange };
}

export function Lobby({ session }: { session: StoredSession }) {
  const { snapshot, fatal, online, run, refresh } = useRoom(session);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const { armed, arm, disarm } = useArm();
  const { message: announcement, hostChange } = useRosterAnnouncement(snapshot?.players, snapshot?.room.host_player_id);
  const inviteUrl = `${location.origin}/room/${session.code}`;

  useEffect(() => { QRCode.toDataURL(inviteUrl, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')); }, [inviteUrl]);
  useEffect(() => { if (fatal) clearSession(session.code); }, [fatal, session.code]);

  async function act(action: string, payload?: object) {
    setBusy(true); setError(''); setNotice(''); disarm();
    try { await run(action, payload); return true; } catch (e) { setError(messageFor(e)); return false; } finally { setBusy(false); }
  }
  async function share() {
    setError(''); setNotice('');
    try {
      if (navigator.share) await navigator.share({ title: '라이어 게임 초대', text: `방 코드 ${session.code}`, url: inviteUrl });
      else { await navigator.clipboard.writeText(inviteUrl); setNotice('초대 링크를 복사했어요.'); }
    } catch { /* user cancelled */ }
  }
  async function copyRecovery() {
    try { await navigator.clipboard.writeText(session.recovery_code ?? ''); setNotice('이어하기 코드를 복사했어요.'); } catch { /* ignore */ }
  }

  if (fatal) {
    const closed = fatal.code === 'ROOM_CLOSED';
    return (
      <main>
        <h1>{closed ? '종료된 방이에요' : '대기실에서 나왔어요'}</h1>
        <p>{messageFor(fatal)}</p>
        {!closed && <button className="primary" onClick={() => navigate(`/room/${session.code}`)}>이 방에 다시 참가하기</button>}
        <button onClick={() => navigate('/')}>처음으로</button>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main>
        {online ? <p aria-live="polite">방 정보를 불러오는 중…</p> : (
          <>
            <p role="alert" className="error">서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.</p>
            <button className="primary" onClick={() => void refresh()}>다시 시도</button>
            <button onClick={() => navigate('/')}>처음으로</button>
          </>
        )}
      </main>
    );
  }

  const { room, me, players } = snapshot;
  const isHost = me.is_host;
  const setting = (patch: Partial<Settings>) => act('update_settings', patch);

  return (
    <main>
      {!online && <p className="banner" role="status">연결이 끊겼어요. 다시 연결하는 중…</p>}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {hostChange && <p role="status" className="notice">{hostChange}</p>}

      <span className="badge">대기실 · 방 코드</span>
      <h1 className="code" aria-label={`방 코드 ${room.code.split('').join(' ')}`}>{room.code}</h1>
      <div className="row">
        <button type="button" className="primary" onClick={share}>친구 초대하기</button>
      </div>
      <details className="card">
        <summary>QR 코드로 초대</summary>
        {qr && <img className="qr" src={qr} alt="이 방 초대 QR 코드" width={180} height={180} />}
      </details>

      <section className="card" aria-labelledby="roster">
        <h2 id="roster">참가자 {players.length}/{MAX_PLAYERS}{room.locked && <span className="tag">입장 잠김</span>}</h2>
        <ul className="roster">
          {players.map((p) => (
            <li key={p.id}>
              <span className="name">{p.nickname}</span>
              {p.id === room.host_player_id && <span className="tag host">방장</span>}
              {p.id === me.player_id && <span className="tag">나</span>}
              <span className={`tag ${p.connected ? 'on' : 'off'}`}>{p.connected ? '접속 중' : '자리 비움'}</span>
              {isHost && p.id !== me.player_id && (
                <button type="button" className="mini" disabled={busy}
                  onClick={() => (armed === `kick:${p.id}` ? void act('kick', { player_id: p.id }) : arm(`kick:${p.id}`))}>
                  {armed === `kick:${p.id}` ? '정말 내보내기' : '내보내기'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {isHost ? (
        <button className="primary" disabled>
          {players.length < MIN_PLAYERS ? `${MIN_PLAYERS}명 이상 모이면 시작할 수 있어요` : '게임 시작 (준비 중)'}
        </button>
      ) : <p className="hint">방장이 게임을 시작하면 자동으로 넘어가요.</p>}

      <details className="card" open={isHost}>
        <summary>게임 설정 {isHost ? '' : '(방장만 변경)'}</summary>
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
        {isHost && (
          <button type="button" disabled={busy} onClick={() => void act('lock', { locked: !room.locked })}>
            {room.locked ? '새 참가 다시 받기' : '새 참가 막기 (모르는 사람 차단)'}
          </button>
        )}
      </details>

      {session.recovery_code && (
        <details className="card">
          <summary>다른 기기로 옮기기</summary>
          <p>폰을 바꾸거나 다른 브라우저로 이어서 할 때 이 코드를 입력하세요. 코드를 쓰면 지금 기기는 자동으로 빠져요.</p>
          <p className="recovery" aria-label="이어하기 코드">{session.recovery_code}</p>
          <button type="button" onClick={copyRecovery}>코드 복사</button>
        </details>
      )}

      <button type="button" disabled={busy}
        onClick={() => (armed === 'leave' ? void act('leave').then((ok) => { if (ok) { clearSession(session.code); navigate('/'); } }) : arm('leave'))}>
        {armed === 'leave' ? '한 번 더 누르면 나가요' : '방 나가기'}
      </button>
      {isHost && (
        <button type="button" className="danger" disabled={busy}
          onClick={() => (armed === 'close' ? void act('close_room') : arm('close'))}>
          {armed === 'close' ? '한 번 더 누르면 모두 나가요' : '방 종료'}
        </button>
      )}
    </main>
  );
}
