import { useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';

export function ResultPanel({snapshot,busy,remaining,run}:{snapshot:RoomSnapshot;busy:boolean;remaining:number|null;run:(action:string,payload?:object)=>Promise<unknown>}) {
  const round=snapshot.round!;
  const en=(round.language??snapshot.room.settings.language)==='en';
  const t=(ko:string,english:string)=>en?english:ko;
  const result=round.m5;
  const [answer,setAnswer]=useState('');
  const [decision,setDecision]=useState<boolean|null>(null);
  if(!result)return null;
  const name=(id:string|null)=>snapshot.players.find(p=>p.id===id)?.nickname ?? t("참가자","Player");
  const citizen=round.me?.role==='citizen' && !round.me.eliminated;
  return <div>
    {round.phase==='REVEAL_LIAR' && <p role="status">{name(result.selected_player_id)} {t('님은','is a')} <strong>{result.selected_role==='liar'?t("라이어","Liar"):t("시민","Citizen")}</strong>. {t('잠시 후 다음 단계로 넘어가요.','Next step coming up.')}</p>}
    {round.phase==='GUESS' && <>
      <p role="status">{name(result.selected_player_id)} · {t('정답 도전 · 한 번만 제출할 수 있어요.','Guess the word · One attempt.')}</p>
      {result.selected_player_id===snapshot.me.player_id && !round.me?.eliminated ? <form onSubmit={e=>{e.preventDefault();void run('submit_guess',{round_id:round.id,answer});}}>
        <label>{t("시민들의 제시어","Citizens’ word")}<input value={answer} onChange={e=>setAnswer(e.target.value)} maxLength={60} autoComplete="off" required /></label>
        <button className="primary" disabled={busy || !answer.trim()}>{t("정답 한 번 제출하기","Submit your guess")}</button>
      </form>:<p>{t("지목된 라이어가 정답을 제출할 때까지 기다려 주세요.","Waiting for the selected liar to guess.")}</p>}
    </>}
    {['APPEAL_WINDOW','APPEAL_VOTE'].includes(round.phase) && <>
      <p>{t('제출한 답:','Submitted answer: ')}<strong>{result.answer}</strong></p>
      <p>{t('자동 잠정 판정:','Provisional result: ')}{result.provisional_correct?t("정답","Correct"):t("오답","Incorrect")}</p>
      <p role="timer">{remaining===0?t("시간 종료 · 서버 판정 대기","Time is up · Awaiting result"):t(`남은 시간 ${remaining ?? '…'}초`,`${remaining ?? '…'} seconds left`)}</p>
      {round.phase==='APPEAL_WINDOW' ? <>
        <p>{t("시민이 이의를 제기하지 않으면 잠정 판정대로 확정해요.","The provisional result stands unless a citizen appeals.")}</p>
        {citizen && <button disabled={busy || remaining===0} onClick={()=>void run('open_appeal',{round_id:round.id,guess_id:result.guess_id})}>{t("정답 판정에 이의 제기","Challenge the result")}</button>}
      </>:<>
        <p>{t('라이어의 답을 정답으로 인정하나요?','Accept the liar’s answer?')} {Math.floor(result.citizen_count/2)+1}/{result.citizen_count} {t('명 이상 찬성 필요','citizen votes required.')}</p>
        <p role="status">{t('판정 투표 제출','Decision votes')} {result.appeal_submitted_count}/{result.citizen_count} · {t('개인 표 비공개','Private votes')}</p>
        {citizen && (result.my_appeal_voted?<p>{t("판정 투표를 제출했어요.","Decision submitted.")}</p>:<>
          <div className="row"><button aria-pressed={decision===true} disabled={busy} onClick={()=>setDecision(true)}>{t("정답 인정","Accept answer")}</button><button aria-pressed={decision===false} disabled={busy} onClick={()=>setDecision(false)}>{t("정답 불인정","Reject answer")}</button></div>
          {decision!==null && <button className="primary" disabled={busy || remaining===0} onClick={()=>void run('submit_appeal_vote',{round_id:round.id,guess_id:result.guess_id,accept:decision})}>{decision?t("정답 인정","Accept answer"):t("정답 불인정","Reject answer")}{t('으로 확정',' · Confirm')}</button>}
        </>)}
      </>}
    </>}
    {round.phase==='FINAL_RESULT' && <>
      <h3>{result.winner==='DRAW'?t("무승부","Draw"):result.winner==='citizen'?t("시민 팀 승리","Citizens win"):t("라이어 팀 승리","Liars win")}</h3>
      <p>{t('정답 제시어:','Secret word: ')}<strong>{result.correct_word}</strong></p>
      <p>{t('라이어:','Liars: ')}{result.liar_ids?.map(name).join(', ')}</p>
      <p>{result.winner==='DRAW'?t("승점은 반영하지 않아요.","No wins are awarded."):t("승리 팀 참가자에게 각 1승을 반영했어요.","Each winning player receives one win.")}</p>
      <h3>{t("이 방의 전적","Room scoreboard")}</h3><ul>{snapshot.players.map(p=><li key={p.id}>{p.nickname} · {p.wins} {t('승','wins')}</li>)}</ul>
    </>}
  </div>;
}
