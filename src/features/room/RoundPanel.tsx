import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';

export function RoundPanel({ snapshot, busy, run }: { snapshot: RoomSnapshot; busy: boolean; run: (action: string,payload?: object) => Promise<unknown> }) {
  const [word,setWord] = useState('');
  const [revealed,setRevealed] = useState(false);
  const [confirmCancel,setConfirmCancel] = useState(false);
  const [confirmSkip,setConfirmSkip] = useState(false);
  const [voteTarget,setVoteTarget] = useState('');
  const [confirmVote,setConfirmVote] = useState('');
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
  const titles = { COLLECT_WORDS:'제시어 후보 제출', REVEAL_ROLE:'내 역할 확인', HINT:'차례대로 힌트', DISCUSS:'자유 토론', PAUSED_HOST:'잠시 멈췄어요', VOTE_1:'1차 비밀 투표', VOTE_RUNOFF:'동률 재투표', REVEAL_VOTE:'투표 집계', FINAL_RESULT:'무승부' };
  const playerName = (id:string) => snapshot.players.find(p => p.id === id)?.nickname ?? '참가자';
  useEffect(() => {
    if (!confirmCancel) return;
    const timer = setTimeout(() => setConfirmCancel(false),4000);
    return () => clearTimeout(timer);
  }, [confirmCancel]);
  useEffect(() => {
    if (!confirmSkip) return;
    const timer = setTimeout(() => setConfirmSkip(false),4000);
    return () => clearTimeout(timer);
  }, [confirmSkip]);
  useEffect(() => {
    const hide = () => setRevealed(false);
    window.addEventListener('blur',hide);
    document.addEventListener('visibilitychange',hide);
    return () => { window.removeEventListener('blur',hide); document.removeEventListener('visibilitychange',hide); };
  }, []);
  return <section className="card" aria-labelledby="round-title">
    <h2 id="round-title">{titles[round.phase]}</h2>
    {round.theme && <p className="notice">공통 테마: <strong>{round.theme}</strong></p>}
    {round.game_mode === 'confusion' && <p>혼선 라이어 · {round.difficulty === 'hard' ? '하드' : '이지'}</p>}
    {!round.me ? <p>게임이 진행 중이에요. 다음 판부터 함께할 수 있어요.</p> : <>
      {round.phase === 'COLLECT_WORDS' ? <>
        <p>공통 테마에 맞는 단어를 하나씩 제출해요. 라이어 후보는 선택에서 제외돼요.</p>
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
          <p>{round.me.word ? `내 제시어: ${round.me.word}` : '힌트를 듣고 제시어를 추리하세요.'}</p>
          {round.me.role === 'liar' && round.me.word && <p>시민들은 다른 제시어를 받았어요.</p>}</div>}
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
          {snapshot.me.is_host && <button className="primary" disabled={busy || remaining === 0} onClick={() => {
            if (remaining === null || confirmSkip) void run('start_vote',{round_id:round.id,skip_timer:true});
            else setConfirmSkip(true);
          }}>{remaining === null ? '토론 마치고 투표로' : confirmSkip ? '한 번 더 누르면 토론을 끝내요' : '남은 시간 건너뛰기'}</button>}
        </>}
        {round.phase === 'PAUSED_HOST' && <p role="status">방장이 진행을 멈췄어요.{round.remaining_ms !== null ? ' 남은 토론 시간 '+Math.ceil(round.remaining_ms/1000)+'초' : ''}</p>}
        {['VOTE_1','VOTE_RUNOFF'].includes(round.phase) && round.vote && <>
          <p>{round.phase === 'VOTE_RUNOFF' ? '공동 1위 후보에게 한 번 더 투표해요. 다시 동률이면 무승부예요.' : '라이어라고 생각하는 참가자 한 명을 선택하세요.'}</p>
          <p role="status">투표 제출 {round.vote.submitted_count}/{round.participant_ids.length}명 · 누가 누구에게 투표했는지는 공개하지 않아요.</p>
          {round.me.voted ? <p>투표를 제출했어요. 나머지 참가자를 기다려 주세요.</p> : <>
            <fieldset className="vote-choices" disabled={busy}><legend>본인을 제외한 투표 대상</legend>
              {round.vote.candidate_ids.filter(id => id !== snapshot.me.player_id).map(id => <label key={id}>
                <input type="radio" name="vote-target" value={id} checked={voteTarget === id} onChange={() => {setVoteTarget(id);setConfirmVote('');}} />{playerName(id)}
              </label>)}
            </fieldset>
            {confirmVote ? <div>
              <p>{playerName(confirmVote)}님에게 투표할까요? 제출 후에는 바꿀 수 없어요.</p>
              <button className="primary" disabled={busy} onClick={() => void run('submit_vote',{round_id:round.id,ballot_no:round.vote!.ballot_no,target_id:confirmVote})}>투표 확정</button>
              <button disabled={busy} onClick={() => setConfirmVote('')}>다시 선택</button>
            </div> : <button className="primary" disabled={busy || !voteTarget} onClick={() => setConfirmVote(voteTarget)}>선택 확인</button>}
          </>}
        </>}
        {['VOTE_RUNOFF','REVEAL_VOTE','FINAL_RESULT'].includes(round.phase) && round.vote && <>
          {round.vote.tallies.map(tally => <div key={tally.ballot_no}><h3>{tally.ballot_no === 1 ? '1차 투표 집계' : '재투표 집계'}</h3>
            <ul>{tally.counts.map(count => <li key={count.player_id}>{playerName(count.player_id)} · {count.votes}표</li>)}</ul>
          </div>)}
          {round.vote.selected_player_id && <p role="status">최다 득표: {playerName(round.vote.selected_player_id)}님. 역할 공개와 정답 도전은 M5에서 이어집니다.</p>}
          {round.vote.outcome === 'DRAW' && <p role="status">무승부로 판이 끝났어요. 승점은 반영하지 않아요.</p>}
        </>}
        {snapshot.me.is_host && ['HINT','DISCUSS','PAUSED_HOST'].includes(round.phase) && <button disabled={busy} onClick={() => void run(round.phase === 'PAUSED_HOST' ? 'resume' : 'pause',{round_id:round.id})}>{round.phase === 'PAUSED_HOST' ? '이어서 진행' : '잠시 멈추기'}</button>}
      </>}
    </>}
    {snapshot.me.is_host && round.phase === 'FINAL_RESULT' && round.vote?.outcome === 'DRAW' && <button className="primary" disabled={busy} onClick={() => void run('return_lobby',{round_id:round.id})}>대기실로 돌아가기</button>}
    {snapshot.me.is_host && round.phase !== 'FINAL_RESULT' && <button className="danger" disabled={busy} onClick={() => {
      if (confirmCancel) void run('cancel_round'); else setConfirmCancel(true);
    }}>{confirmCancel ? '한 번 더 누르면 점수 없이 취소해요' : '현재 판 취소'}</button>}
  </section>;
}
