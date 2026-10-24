import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';

export function RoundPanel({ snapshot, busy, run }: { snapshot: RoomSnapshot; busy: boolean; run: (action: string,payload?: object) => Promise<unknown> }) {
  const [word,setWord] = useState('');
  const [revealed,setRevealed] = useState(false);
  const [confirmCancel,setConfirmCancel] = useState(false);
  const round = snapshot.round!;
  const [clock,setClock] = useState({ serverNow:snapshot.server_now, elapsed:0 });
  useEffect(() => {
    if (round.phase !== 'DISCUSS' || !round.deadline_at) return;
    const started = performance.now();
    const timer = setInterval(() => setClock({serverNow:snapshot.server_now,elapsed:performance.now()-started}),250);
    return () => clearInterval(timer);
  }, [snapshot,round.phase,round.deadline_at]);
  const elapsed = clock.serverNow === snapshot.server_now ? clock.elapsed : 0;
  const remaining = round.deadline_at && snapshot.server_now
    ? Math.max(0,Math.ceil((Date.parse(round.deadline_at)-Date.parse(snapshot.server_now)-elapsed)/1000)) : null;
  const currentName = snapshot.players.find(p => p.id === round.current_player_id)?.nickname;
  const titles = { COLLECT_WORDS:'제시어 후보 제출', REVEAL_ROLE:'내 역할 확인', HINT:'차례대로 힌트', DISCUSS:'자유 토론', PAUSED_HOST:'잠시 멈췄어요', VOTE_1:'투표 준비' };
  useEffect(() => {
    if (!confirmCancel) return;
    const timer = setTimeout(() => setConfirmCancel(false),4000);
    return () => clearTimeout(timer);
  }, [confirmCancel]);
  useEffect(() => {
    const hide = () => setRevealed(false);
    window.addEventListener('blur',hide);
    document.addEventListener('visibilitychange',hide);
    return () => { window.removeEventListener('blur',hide); document.removeEventListener('visibilitychange',hide); };
  }, []);
  return <section className="card" aria-labelledby="round-title">
    <h2 id="round-title">{titles[round.phase]}</h2>
    {!round.me ? <p>게임이 진행 중이에요. 다음 판부터 함께할 수 있어요.</p> : <>
      {round.phase === 'COLLECT_WORDS' ? <>
        <p>역할 공개 전, 모두 단어를 하나씩 제출해요. 라이어 후보는 선택에서 제외돼요.</p>
        <p role="status">제출 {round.submitted_count}/{round.participant_ids.length}명</p>
        {round.me.submitted ? <p>제출했어요. 다른 참가자를 기다려 주세요.</p> : <form onSubmit={event => { event.preventDefault(); void run('submit_word',{round_id:round.id,word}); }}>
          <label>나만의 단어<input value={word} maxLength={60} autoComplete="off" onChange={event => setWord(event.target.value)} /></label>
          <button className="primary" disabled={busy || [...word.replace(/\s/g,'')].length < 2}>한 번만 제출하기</button>
        </form>}
      </> : <>
        <p>주변에 보이지 않게 버튼을 누르는 동안만 확인하세요.</p>
        <button type="button" className="secret-hold"
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setRevealed(true); }}
          onPointerUp={() => setRevealed(false)} onPointerCancel={() => setRevealed(false)} onLostPointerCapture={() => setRevealed(false)}
          onBlur={() => setRevealed(false)} onContextMenu={event => event.preventDefault()}
          onKeyDown={event => { if ([' ','Enter'].includes(event.key)) { event.preventDefault(); setRevealed(true); } }}
          onKeyUp={() => setRevealed(false)} aria-label="누르는 동안 내 역할 보기">누르고 역할 보기</button>
        {revealed && <div className="secret-card"><strong>{round.me.role === 'liar' ? '당신은 라이어예요' : '당신은 시민이에요'}</strong>
          <p>{round.me.role === 'citizen' ? `제시어: ${round.me.word}` : '힌트를 듣고 제시어를 추리하세요.'}</p></div>}
        {round.phase === 'REVEAL_ROLE' && <>
          <p role="status">역할 확인 {round.acknowledged_count}/{round.participant_ids.length}명</p>
          <button className="primary" disabled={busy || round.me.acknowledged} onClick={() => void run('ack_role',{round_id:round.id})}>
            {round.me.acknowledged ? '확인했어요 · 다른 참가자 기다리는 중' : '내 역할을 확인했어요'}</button>
        </>}
        {round.phase === 'HINT' && <>
          <p role="status">힌트 {round.hint_round}/{round.hint_rounds}바퀴 · {currentName}님 차례</p>
          <ol>{round.participant_ids.map(id => <li key={id} aria-current={id === round.current_player_id ? 'step' : undefined}>{snapshot.players.find(p => p.id === id)?.nickname}{id === round.current_player_id ? ' ← 현재 차례' : ''}</li>)}</ol>
          {round.current_player_id === snapshot.me.player_id && <button className="primary" disabled={busy} onClick={() => void run('finish_hint',{round_id:round.id,hint_index:round.hint_index})}>힌트 말하기 완료</button>}
        </>}
        {round.phase === 'DISCUSS' && <>
          <p role="timer">{remaining === null ? '시간 제한 없이 토론하세요.' : remaining > 0 ? '남은 시간 '+remaining+'초' : '시간 종료 · 서버에서 투표 단계를 준비하고 있어요.'}</p>
          {snapshot.me.is_host && remaining === null && <button className="primary" disabled={busy} onClick={() => void run('start_vote',{round_id:round.id})}>토론 마치고 투표로</button>}
        </>}
        {round.phase === 'PAUSED_HOST' && <p role="status">방장이 진행을 멈췄어요.{round.remaining_ms !== null ? ' 남은 토론 시간 '+Math.ceil(round.remaining_ms/1000)+'초' : ''}</p>}
        {round.phase === 'VOTE_1' && <p role="status">토론을 마쳤어요. 투표 기능은 M4에서 연결됩니다.</p>}
        {snapshot.me.is_host && ['HINT','DISCUSS','PAUSED_HOST'].includes(round.phase) && <button disabled={busy} onClick={() => void run(round.phase === 'PAUSED_HOST' ? 'resume' : 'pause',{round_id:round.id})}>{round.phase === 'PAUSED_HOST' ? '이어서 진행' : '잠시 멈추기'}</button>}
      </>}
    </>}
    {snapshot.me.is_host && <button className="danger" disabled={busy} onClick={() => {
      if (confirmCancel) void run('cancel_round'); else setConfirmCancel(true);
    }}>{confirmCancel ? '한 번 더 누르면 점수 없이 취소해요' : '현재 판 취소'}</button>}
  </section>;
}
