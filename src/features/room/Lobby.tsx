import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { MAFIA_ROLES, messageFor, THEMES, type MafiaRoles, type Player, type Settings } from '../../lib/api';
import { navigate } from '../../lib/router';
import { clearSession, type StoredSession } from '../../lib/session';
import { useRoom } from './useRoom';
import { RoundPanel } from './RoundPanel';

const MAX_PLAYERS = 15;
const MIN_PLAYERS = 3;
const ROLE_NAMES: Record<keyof MafiaRoles, string> = { mafia:'마피아',spy:'스파이',citizen:'시민',police:'경찰',doctor:'의사',journalist:'기자',traitor:'배신자' };

type MafiaView = NonNullable<import('../../lib/api').RoomSnapshot['mafia']>;
function MafiaRolePanel({mafia,players,act,busy,isHost}: {mafia:MafiaView;players:Player[];act:(action:string,payload?:object)=>Promise<boolean>;busy:boolean;isHost:boolean}) {
  const [revealed,setRevealed] = useState(false);
  const own = mafia.me;
  if (!own) return <p className="notice">이번 게임은 참가하지 않아요. 관전하며 다음 판을 기다려 주세요.</p>;
  return <section className="card" aria-labelledby="mafia-role">
    <h2 id="mafia-role">{mafia.phase==='INTRO'?'첫날 자기소개':'비밀 역할 확인'}</h2>
    {mafia.phase==='INTRO' && <p>모두 역할을 확인했어요. 첫날은 돌아가며 자기소개만 하고 투표하지 않아요.</p>}
    <p className="hint">역할은 주변 사람에게 보이지 않도록 조심해 주세요.</p>
    {!revealed ? <button type="button" onClick={()=>setRevealed(true)}>내 역할 보기</button> : <>
      <p role="status"><strong>나의 역할: {ROLE_NAMES[own.role]}</strong></p>
      {(own.role==='mafia'||own.role==='spy') && <p>알고 있는 마피아: {own.teammate_ids.map(id=>players.find(p=>p.id===id)?.nickname??'참가자').join(', ')||'없음'}</p>}
      {own.original_role==='traitor' && <p>비밀 미션: {players.find(p=>p.id===own.mission_target_id)?.nickname??'지정 인물'} 님이 탈락하면 마피아로 전향합니다.</p>}
      <button type="button" onClick={()=>setRevealed(false)}>역할 숨기기</button>
    </>}
    {mafia.phase==='REVEAL_ROLE' && (own.acknowledged ? <p>역할 확인 완료 · {mafia.acknowledged_count}/{mafia.participant_ids.length}명</p> :
      <button className="primary" disabled={busy || !revealed} onClick={()=>{setRevealed(false);void act('mafia_ack');}}>역할 확인 완료</button>)}
    {mafia.phase==='INTRO' && isHost && <button className="primary" disabled={busy} onClick={()=>{setRevealed(false);void act('mafia_intro_done');}}>자기소개 마침 · 첫날 밤 시작</button>}
  </section>;
}

function MafiaNightPanel({mafia,players,meId,act,busy}: {mafia:MafiaView;players:Player[];meId:string;act:(action:string,payload?:object)=>Promise<boolean>;busy:boolean}) {
  const [open,setOpen]=useState(false);
  const [target,setTarget]=useState('');
  const own=mafia.me;
  const active=new Set(mafia.alive_ids??[]);
  const actionable=own && own.alive && ['mafia','police','doctor','spy','journalist'].includes(own.role);
  return <section className="card" aria-labelledby="mafia-night">
    <h2 id="mafia-night">첫 번째 밤</h2>
    <p>행동 제출 {mafia.night_submitted_count??0}/{mafia.night_expected_count??0}명 · 모든 행동이 완료되면 아침이 됩니다.</p>
    {!actionable ? <p className="hint">오늘 밤은 별도 행동이 없어요. 다른 참가자를 기다려 주세요.</p> : own.night_submitted ? <p>밤 행동을 제출했어요. 결과를 기다려 주세요.</p> : !open ?
      <button onClick={()=>setOpen(true)}>내 비밀 행동 보기</button> : <>
      <p><strong>{ROLE_NAMES[own.role]}</strong>의 밤 행동을 선택해 주세요.</p>
      <label>대상 선택
        <select value={target} onChange={e=>setTarget(e.target.value)}>
          <option value="">대상을 선택해 주세요</option>
          {players.filter(p=>active.has(p.id)&&(p.id!==meId||own.role==='doctor')).map(p=><option key={p.id} value={p.id}>{p.nickname}{p.id===meId?' (나)':''}</option>)}
        </select>
      </label>
      {own.role==='journalist' && <p className="hint">기자는 게임당 한 번만 취재할 수 있어요. 오늘 사용하지 않아도 됩니다.</p>}
      <button className="primary" disabled={busy||(!target&&own.role!=='journalist')} onClick={()=>{setOpen(false);void act('mafia_night_action',{target_id:target||null});}}>비밀 행동 제출{!target?' · 오늘 건너뛰기':''}</button>
      <button type="button" onClick={()=>setOpen(false)}>행동 숨기기</button>
    </>}
  </section>;
}

function MafiaDayPanel({mafia,players}: {mafia:MafiaView;players:Player[]}) {
  const [showSecret,setShowSecret]=useState(false);
  const result=mafia.night_result;
  const name=(id:string|null|undefined)=>players.find(p=>p.id===id)?.nickname??'참가자';
  return <section className="card">
    <h2>{mafia.phase==='FINAL_RESULT'?'게임 결과':'아침이 밝았습니다'}</h2>
    <p>{result?.eliminated_player_id?`${name(result.eliminated_player_id)} 님 탈락 · ${result.eliminated_team==='mafia'?'마피아 팀':'시민 팀'}`:'밤에 탈락한 사람이 없어요.'}</p>
    {result?.journalist && <p>기자 발표: {name(result.journalist.player_id)} 님의 직업은 {ROLE_NAMES[result.journalist.role]}입니다.</p>}
    {mafia.winner && <p><strong>{mafia.winner==='mafia'?'마피아 팀':'시민 팀'} 승리!</strong></p>}
    {mafia.phase==='DAY_DISCUSS' && <p>낮 토론을 진행하세요. 투표는 다음 개발 단계에서 제공돼요.</p>}
    {showSecret && mafia.me?.investigation && <p>내 조사 결과: {name(mafia.me.investigation.target_id)} 님 · {mafia.me.investigation.result==='mafia'?'마피아':mafia.me.investigation.result==='not_mafia'?'마피아 아님':ROLE_NAMES[mafia.me.investigation.result]}</p>}
    {showSecret && mafia.me?.original_role==='traitor' && <p>{mafia.me.role==='mafia'?'비밀 미션 성공 · 마피아로 전향했어요.':'비밀 미션은 아직 완료되지 않았어요.'}</p>}
    {(mafia.me?.investigation || mafia.me?.original_role==='traitor') && <button onClick={()=>setShowSecret(v=>!v)}>{showSecret?'비밀 결과 숨기기':'내 비밀 결과 보기'}</button>}
  </section>;
}

function MafiaSettings({roles, participants, editable, save}: {roles:MafiaRoles;participants:number;editable:boolean;save:(roles:MafiaRoles)=>Promise<boolean>}) {
  const [draft,setDraft] = useState<MafiaRoles>(roles);
  const [saving,setSaving] = useState(false);
  useEffect(() => { setDraft(roles); }, [roles]);
  const total = Object.values(draft).reduce((sum,n)=>sum+n,0);
  const valid = total>=4 && total<=15 && draft.mafia>=1 && draft.mafia<=4 && draft.citizen>=1 && draft.mafia+draft.spy<total-draft.mafia-draft.spy;
  const changed = MAFIA_ROLES.some(role=>draft[role]!==roles[role]);
  return <section className="card" aria-labelledby="mafia-settings">
    <h2 id="mafia-settings">직업 구성 {editable ? '(방장 설정)' : '(방장만 변경)'}</h2>
    <p className="hint">7종 중 원하는 직업의 인원을 정하세요. 실제 역할 배정은 다음 개발 단계에서 제공돼요.</p>
    {MAFIA_ROLES.map(role=><label key={role}>{ROLE_NAMES[role]}
      <select disabled={!editable || saving} value={draft[role]} onChange={e=>setDraft(old=>({...old,[role]:Number(e.target.value)}))}>
        {Array.from({length:role==='mafia'?5:role==='citizen'?16:2},(_,n)=><option key={n} value={n}>{n}명</option>)}
      </select>
    </label>)}
    <p role="status">설정 {total}명 · 현재 참가자 {participants}명</p>
    {!valid && <p className="error">총 4~15명, 마피아 1~4명, 시민 1명 이상이며 시민 팀이 더 많아야 해요.</p>}
    {total!==participants && <p className="hint">게임을 시작하려면 직업 수와 참가자 수가 같아야 해요.</p>}
    {editable && <button className="primary" disabled={!changed || !valid || saving} onClick={()=>{setSaving(true);void save(draft).finally(()=>setSaving(false));}}>직업 구성 저장</button>}
  </section>;
}

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
  const { snapshot, fatal, online, run, runGame, refresh } = useRoom(session);
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
        <h1>{closed ? '종료된 방이에요' : '이 방에 접속할 수 없어요'}</h1>
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
  const round = snapshot.round;
  const play = async (action: string,payload?: object) => {
    setBusy(true); setError('');
    try { await runGame(action,payload); } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };
  const isHost = me.is_host;
  const needsTheme = room.settings.word_mode === 'custom' && !room.settings.custom_theme?.trim();
  const setting = (patch: Partial<Settings>) => act('update_settings', patch);

  return (
    <main>
      {!online && <p className="banner" role="status">연결이 끊겼어요. 다시 연결하는 중…</p>}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {hostChange && <p role="status" className="notice">{hostChange}</p>}

      <span className="badge">{room.game_type === 'mafia' ? '마피아' : '라이어'} 대기실 · 방 코드</span>
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
              {p.status === 'waiting_next_round' && <span className="tag">다음 판 대기</span>}
              <span className={`tag ${p.connected ? 'on' : 'off'}`}>{p.connected ? '접속 중' : '자리 비움'}</span>
              {isHost && p.id !== me.player_id && (
                <button type="button" className="mini" disabled={busy || Boolean(round)}
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
      {room.game_type === 'mafia' ? snapshot.mafia ? snapshot.mafia.phase==='NIGHT' ?
        <MafiaNightPanel key={`${snapshot.mafia.id}:${snapshot.mafia.phase}`} mafia={snapshot.mafia} players={players} meId={me.player_id} act={act} busy={busy}/> :
        ['DAY_DISCUSS','FINAL_RESULT'].includes(snapshot.mafia.phase) ? <MafiaDayPanel mafia={snapshot.mafia} players={players}/> :
        <MafiaRolePanel key={`${snapshot.mafia.id}:${snapshot.mafia.phase}`} mafia={snapshot.mafia} players={players} act={act} busy={busy} isHost={isHost}/> : isHost ?
        <button className="primary" disabled={busy || !online || players.length<4 || players.length!==Object.values(room.settings.mafia_roles??{}).reduce((a,b)=>a+b,0) || players.some(p=>!p.connected)} onClick={()=>void act('mafia_start')}>
          {players.length<4?'4명 이상 모이면 시작할 수 있어요':'게임 시작 · 비밀 역할 배정'}
        </button> : <p className="hint">방장이 마피아 게임을 시작하면 역할을 확인할 수 있어요.</p>
      : round ? <RoundPanel key={`${round.id}:${round.phase}`} snapshot={snapshot} busy={busy} run={play} /> : isHost ? (
        <button className="primary" disabled={busy || !online || needsTheme || players.length < MIN_PLAYERS || players.some(p => !p.connected)} onClick={() => void play('start_round')}>
          {needsTheme ? '게임 설정에서 테마를 저장해 주세요' : players.length < MIN_PLAYERS ? `${MIN_PLAYERS}명 이상 모이면 시작할 수 있어요` : '게임 시작 · 역할 배정'}
        </button>
      ) : <p className="hint">방장이 게임을 시작하면 자동으로 넘어가요.</p>}

      {room.game_type === 'mafia' ? !snapshot.mafia && <MafiaSettings roles={room.settings.mafia_roles ?? {mafia:1,spy:0,citizen:2,police:1,doctor:0,journalist:0,traitor:0}} participants={players.length} editable={isHost && !busy && online} save={roles=>act('update_settings',{mafia_roles:roles})}/> : <details className="card" open={isHost}>
        <summary>게임 설정 {isHost ? '' : '(방장만 변경)'}</summary>
        <label>제시어
          <select disabled={!isHost || busy || Boolean(round)} value={room.settings.word_mode} onChange={(e) => setting({ word_mode: e.target.value as Settings['word_mode'],game_mode:'classic' })}>
            <option value="builtin">기본 제시어</option>
            <option value="custom">직접 입력</option>
          </select>
        </label>
        {room.settings.word_mode === 'builtin' ? <>
          <label>테마
            <select disabled={!isHost || busy || Boolean(round)} value={room.settings.theme ?? 'random'} onChange={e => void setting({theme:e.target.value as Settings['theme']})}>
              <option value="random">랜덤 테마</option>
              {THEMES.map(theme => <option key={theme}>{theme}</option>)}
            </select>
          </label>
          {room.settings.theme === '크로스핏' && <p className="hint">크로스핏 동작 용어를 아는 참가자끼리 선택해 주세요.</p>}
          <label>게임 방식
            <select disabled={!isHost || busy || Boolean(round)} value={room.settings.game_mode ?? 'classic'} onChange={e => void setting({game_mode:e.target.value as Settings['game_mode']})}>
              <option value="classic">기본 라이어</option><option value="confusion">혼선 라이어</option>
            </select>
          </label>
          {room.settings.game_mode === 'confusion' && <label>라이어 난이도
            <select disabled={!isHost || busy || Boolean(round)} value={room.settings.difficulty ?? 'easy'} onChange={e => void setting({difficulty:e.target.value as Settings['difficulty']})}>
              <option value="easy">이지 · 비슷한 제시어</option><option value="hard">하드 · 차이가 큰 제시어</option>
            </select>
          </label>}
          <p className="hint">{room.settings.game_mode === 'confusion' ? '라이어도 같은 테마의 다른 제시어를 받아요. 난이도는 라이어 기준이에요.' : '라이어는 테마만 알고, 제시어는 받지 않아요.'}</p>
        </> : <>
          <form key={`${room.id}:${room.settings.custom_theme ?? ''}`} onSubmit={event => {
            event.preventDefault();
            void setting({custom_theme:String(new FormData(event.currentTarget).get('theme') ?? '')});
          }}>
            <label>공통 테마<input name="theme" defaultValue={room.settings.custom_theme ?? ''} maxLength={60} placeholder="예: 음식, 우리 학교" disabled={!isHost || busy || Boolean(round)} required /></label>
            {isHost && <button disabled={busy || Boolean(round)}>테마 저장</button>}
          </form>
          <p className="hint">기본 라이어로 진행해요. 각자 테마에 맞는 단어 하나만 제출해 주세요.</p>
        </>}
        <label>힌트 바퀴 수
          <span className="hint">라이어 수와 힌트 바퀴 수는 시작 후 바꿀 수 없어요.</span>
          <select disabled={!isHost || busy || Boolean(round)} value={room.settings.hint_rounds} onChange={(e) => setting({ hint_rounds: Number(e.target.value) as Settings['hint_rounds'] })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}바퀴</option>)}
          </select>
        </label>
        <label>라이어 수
          <select disabled={!isHost || busy || Boolean(round)} value={room.settings.liar_count ?? 1} onChange={e => void setting({liar_count:Number(e.target.value) as 1 | 2})}>
            <option value={1}>1명</option><option value={2}>2명</option>
          </select>
        </label>
        {room.settings.liar_count === 2 && <p className="hint">2명 모두 잡아야 시민 팀이 이겨요. 5명 이상일 때 권장해요.</p>}
        <label>토론 시간
          <select disabled={!isHost || busy || Boolean(round)} value={room.settings.discussion_seconds} onChange={(e) => setting({ discussion_seconds: Number(e.target.value) as Settings['discussion_seconds'] })}>
            {[60, 120, 180, 300].map((s) => <option key={s} value={s}>{s / 60}분</option>)}
            <option value={0}>무제한</option>
          </select>
        </label>
        {isHost && (
          <button type="button" disabled={busy} onClick={() => void act('lock', { locked: !room.locked })}>
            {room.locked ? '새 참가 다시 받기' : '새 참가 막기 (모르는 사람 차단)'}
          </button>
        )}
      </details>}

      {session.recovery_code && (
        <details className="card">
          <summary>다른 기기로 옮기기</summary>
          <p>폰을 바꾸거나 다른 브라우저로 이어서 할 때 이 코드를 입력하세요. 코드를 쓰면 지금 기기는 자동으로 빠져요.</p>
          <p className="recovery" aria-label="이어하기 코드">{session.recovery_code}</p>
          <button type="button" onClick={copyRecovery}>코드 복사</button>
        </details>
      )}

      <p className="notice">사용자 조작 없이 2시간이 지나면 방이 만료돼요. 종료·만료된 방의 참가 정보와 전적은 정리 작업으로 삭제돼요. 서버 백업은 별도 보존 정책을 따라요.</p>
      <button type="button" disabled={busy || Boolean(round?.me)}
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
