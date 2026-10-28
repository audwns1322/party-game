import { useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';

export function ResultPanel({snapshot,busy,remaining,run}:{snapshot:RoomSnapshot;busy:boolean;remaining:number|null;run:(action:string,payload?:object)=>Promise<unknown>}) {
  const round=snapshot.round!;
  const result=round.m5;
  const [answer,setAnswer]=useState('');
  const [decision,setDecision]=useState<boolean|null>(null);
  if(!result)return null;
  const name=(id:string|null)=>snapshot.players.find(p=>p.id===id)?.nickname ?? '참가자';
  const citizen=round.me?.role==='citizen' && !round.me.eliminated;
  return <div>
    {round.phase==='REVEAL_LIAR' && <p role="status">{name(result.selected_player_id)}님은 <strong>{result.selected_role==='liar'?'라이어':'시민'}</strong>입니다. 잠시 후 다음 단계로 넘어가요.</p>}
    {round.phase==='GUESS' && <>
      <p role="status">{name(result.selected_player_id)}님의 정답 도전 · 한 번만 제출할 수 있어요.</p>
      {result.selected_player_id===snapshot.me.player_id && !round.me?.eliminated ? <form onSubmit={e=>{e.preventDefault();void run('submit_guess',{round_id:round.id,answer});}}>
        <label>시민들의 제시어<input value={answer} onChange={e=>setAnswer(e.target.value)} maxLength={60} autoComplete="off" required /></label>
        <button className="primary" disabled={busy || !answer.trim()}>정답 한 번 제출하기</button>
      </form>:<p>지목된 라이어가 정답을 제출할 때까지 기다려 주세요.</p>}
    </>}
    {['APPEAL_WINDOW','APPEAL_VOTE'].includes(round.phase) && <>
      <p>제출한 답: <strong>{result.answer}</strong></p>
      <p>자동 잠정 판정: {result.provisional_correct?'정답':'오답'}</p>
      <p role="timer">{remaining===0?'시간 종료 · 서버 판정 대기':`남은 시간 ${remaining ?? '…'}초`}</p>
      {round.phase==='APPEAL_WINDOW' ? <>
        <p>시민이 이의를 제기하지 않으면 잠정 판정대로 확정해요.</p>
        {citizen && <button disabled={busy || remaining===0} onClick={()=>void run('open_appeal',{round_id:round.id,guess_id:result.guess_id})}>정답 판정에 이의 제기</button>}
      </>:<>
        <p>라이어의 답을 정답으로 인정하나요? 시민 전체 {result.citizen_count}명 중 {Math.floor(result.citizen_count/2)+1}명 이상 찬성해야 인정돼요.</p>
        <p role="status">판정 투표 제출 {result.appeal_submitted_count}/{result.citizen_count}명 · 개인 표는 비공개</p>
        {citizen && (result.my_appeal_voted?<p>판정 투표를 제출했어요.</p>:<>
          <div className="row"><button aria-pressed={decision===true} disabled={busy} onClick={()=>setDecision(true)}>정답 인정</button><button aria-pressed={decision===false} disabled={busy} onClick={()=>setDecision(false)}>정답 불인정</button></div>
          {decision!==null && <button className="primary" disabled={busy || remaining===0} onClick={()=>void run('submit_appeal_vote',{round_id:round.id,guess_id:result.guess_id,accept:decision})}>{decision?'정답 인정':'정답 불인정'}으로 확정</button>}
        </>)}
      </>}
    </>}
    {round.phase==='FINAL_RESULT' && <>
      <h3>{result.winner==='DRAW'?'무승부':result.winner==='citizen'?'시민 팀 승리':'라이어 팀 승리'}</h3>
      <p>정답 제시어: <strong>{result.correct_word}</strong></p>
      <p>라이어: {result.liar_ids?.map(name).join(', ')}</p>
      <p>{result.winner==='DRAW'?'승점은 반영하지 않아요.':'승리 팀 참가자에게 각 1승을 반영했어요.'}</p>
      <h3>이 방의 전적</h3><ul>{snapshot.players.map(p=><li key={p.id}>{p.nickname} · {p.wins}승</li>)}</ul>
    </>}
  </div>;
}
