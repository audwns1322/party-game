import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';
import { ResultPanel } from './ResultPanel';

export function roleAnnouncement(mode: 'classic' | 'confusion' | undefined, role: 'liar' | 'citizen' | null) {
  if (mode === 'confusion') return '당신은 시민입니다';
  return role === 'liar' ? '당신은 라이어예요' : '당신은 시민이에요';
}

export function RoundPanel({ snapshot, busy, run }: { snapshot: RoomSnapshot; busy: boolean; run: (action: string,payload?: object) => Promise<unknown> }) {
  const [word,setWord] = useState('');
  const [revealed,setRevealed] = useState(false);
  const [confirmCancel,setConfirmCancel] = useState(false);
  const [confirmSkip,setConfirmSkip] = useState(false);
  const [voteTarget,setVoteTarget] = useState('');
  const [confirmVote,setConfirmVote] = useState('');
  const round = snapshot.round!;
  const en=(round.language??snapshot.room.settings.language)==='en';
  const t=(ko:string,english:string)=>en?english:ko;
  const themeNames:Record<string,string>={"음식":"Food","동물":"Animals","생활용품":"Everyday objects","장소":"Places","취미":"Hobbies","자연":"Nature","운동":"Sports","크로스핏":"CrossFit","여행":"Travel"};
  const deadline = round.phase === 'PAUSED_DISCONNECT' ? round.disconnect?.grace_until : round.deadline_at;
  const [clock,setClock] = useState({ serverNow:snapshot.server_now, elapsed:0 });
  useEffect(() => {
    if (!deadline) return;
    const started = performance.now();
    const timer = setInterval(() => setClock({serverNow:snapshot.server_now,elapsed:performance.now()-started}),250);
    return () => clearInterval(timer);
  }, [snapshot,round.phase,deadline]);
  const elapsed = clock.serverNow === snapshot.server_now ? clock.elapsed : 0;
  const remaining = deadline && snapshot.server_now
    ? Math.max(0,Math.ceil((Date.parse(deadline)-Date.parse(snapshot.server_now)-elapsed)/1000)) : null;
  const currentName = snapshot.players.find(p => p.id === round.current_player_id)?.nickname;
  const titles = { COLLECT_WORDS:t("제시어 후보 제출","Submit a word"), REVEAL_ROLE:t("내 역할 확인","Check your role"), HINT:t("차례대로 힌트","Give clues"), DISCUSS:t("자유 토론","Discussion"), PAUSED_HOST:t("잠시 멈췄어요","Paused"), PAUSED_DISCONNECT:t("재접속을 기다리고 있어요","Waiting for reconnect"), VOTE_1:t("비밀 투표","Secret vote"), VOTE_RUNOFF:t("동률 재투표","Runoff vote"), REVEAL_VOTE:t("투표 집계","Vote count"), REVEAL_LIAR:t("라이어 여부 공개","Role reveal"), GUESS:t("정답 도전","Guess the word"), APPEAL_WINDOW:t("잠정 판정","Provisional result"), APPEAL_VOTE:t("시민 판정 투표","Citizen vote"), FINAL_RESULT:t("최종 결과","Final result") };
  const playerName = (id:string) => snapshot.players.find(p => p.id === id)?.nickname ?? t("참가자","Player");
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
  if (!round.me) return <section className="card"><h2>{t("다음 판을 기다리고 있어요","Waiting for next round")}</h2><p>{t("게임이 진행 중이에요. 이번 판이 끝나면 함께 시작할 수 있어요.","A round is in progress. Join the next one.")}</p></section>;
  return <section className="card" aria-labelledby="round-title">
    <h2 id="round-title">{titles[round.phase]}</h2>
    {round.theme && <p className="notice">{t('공통 테마:','Category:')} <strong>{en?(themeNames[round.theme]??round.theme):round.theme}</strong></p>}
    <p>{t('라이어','Liars:')} {round.liar_count ?? 1}{round.vote && round.vote.cycle_no && round.vote.cycle_no>1?t(' · 추가 투표',' · Additional ballot'):''}</p>
    {Boolean(round.eliminated_ids?.length) && <p>{t('탈락한 라이어:','Eliminated liars: ')}{round.eliminated_ids!.map(playerName).join(', ')}</p>}
    {round.me?.eliminated && <p className="notice">{t("탈락했어요. 남은 진행을 지켜봐 주세요. 투표에는 참여할 수 없어요.","You are out. Watch the rest of the round.")}</p>}
    {round.game_mode === 'confusion' && <p>{t('혼선 라이어','Confusion liar')} · {round.difficulty === 'hard' ? t('하드','Hard') : t('이지','Easy')}</p>}
    {Boolean(round.away_ids?.length) && round.phase!=='PAUSED_DISCONNECT' && <p className="notice" role="status">{t('자리 비움: ','Away: ')}{round.away_ids!.map(playerName).join(', ')}. {t('가능한 행동은 계속 진행하고, 빠진 참가자의 행동이 필요한 경우에만 기다려요.','Keep playing. We wait only for actions the absent players still need to complete.')}</p>}
    {round.phase === 'PAUSED_DISCONNECT' && round.disconnect && <div className="notice">
      <p role="status">{round.disconnect.missing_ids.map(playerName).join(', ')} · {t('재접속 대기 중','Waiting to reconnect.')}</p>
      <p role="timer">{remaining === 0 ? t('복귀 유예가 끝났어요.','Reconnect grace period ended.') : t(`복귀 유예 ${remaining ?? '…'}초`,`Reconnect grace: ${remaining ?? '…'} sec`)}</p>
      {round.disconnect.remaining_ms !== null && <p>{t(`게임에 남은 시간 ${Math.ceil(round.disconnect.remaining_ms/1000)}초를 보관했어요.`,`Saved time remaining: ${Math.ceil(round.disconnect.remaining_ms/1000)} sec`)}</p>}
      {snapshot.me.is_host && remaining === 0 && <button disabled={busy} onClick={() => void run('wait_reconnect',{round_id:round.id})}>{t("30초 더 기다리기","Wait 30 more seconds")}</button>}
      <p>{t("방장이 돌아오지 않으면 연결된 이번 판 참가자에게 방장 권한을 자동으로 넘겨요.","If the host stays away, another active player becomes host.")}</p>
    </div>}
    {!round.me ? <p>{t("게임이 진행 중이에요. 다음 판부터 함께할 수 있어요.","Join the next round.")}</p> : <>
      {round.phase === 'COLLECT_WORDS' ? <>
        <p>{t("공통 테마에 맞는 단어를 하나씩 제출해요. 라이어 후보는 선택에서 제외돼요.","Submit one word for the category. The liar's word will not be chosen.")}</p>
        <p role="status">{t('제출','Submitted')} {round.submitted_count}/{round.participant_ids.length}</p>
        {round.me.submitted ? <p>{t("제출했어요. 다른 참가자를 기다려 주세요.","Submitted. Waiting for others.")}</p> : <form onSubmit={event => { event.preventDefault(); void run('submit_word',{round_id:round.id,word}); }}>
          <label>{t("나만의 단어","Your word")}<input value={word} maxLength={60} autoComplete="off" onChange={event => setWord(event.target.value)} /></label>
          <button className="primary" disabled={busy || [...word.replace(/\s/g,'')].length < 2}>{t("한 번만 제출하기","Submit word")}</button>
        </form>}
      </> : <>
        <p>{t("주변에 보이지 않게 버튼을 누르는 동안만 확인하세요.","Hold the button to see your private role and word.")}</p>
        <button type="button" className="secret-hold"
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setRevealed(true); }}
          onPointerUp={() => setRevealed(false)} onPointerCancel={() => setRevealed(false)} onLostPointerCapture={() => setRevealed(false)}
          onBlur={() => setRevealed(false)} onContextMenu={event => event.preventDefault()}
          onKeyDown={event => { if ([' ','Enter'].includes(event.key)) { event.preventDefault(); setRevealed(true); } }}
          onKeyUp={() => setRevealed(false)} aria-label={t('누르는 동안 내 역할 보기','Hold to view role')}>{t("누르고 역할 보기","Hold to reveal role")}</button>
        {revealed && <div className="secret-card"><strong>{en?(round.game_mode==='confusion'||round.me.role!=='liar'?'You are a citizen.':'You are the liar.'):roleAnnouncement(round.game_mode, round.me.role)}</strong>
          <p>{round.me.word ? t(`내 제시어: ${round.me.word}`,`Your word: ${round.me.word}`) : t("힌트를 듣고 제시어를 추리하세요.","Listen to clues and guess the word.")}</p>
          {round.game_mode !== 'confusion' && round.me.role === 'liar' && round.me.word && <p>{t("시민들은 다른 제시어를 받았어요.","Citizens received a different word.")}</p>}</div>}
        {round.phase === 'REVEAL_ROLE' && <>
          <p role="status">{t('역할 확인','Ready')} {round.acknowledged_count}/{round.participant_ids.length}</p>
          <button className="primary" disabled={busy || round.me.acknowledged} onClick={() => void run('ack_role',{round_id:round.id})}>
            {round.me.acknowledged ? t("확인했어요 · 다른 참가자 기다리는 중","Confirmed · Waiting for others") : t("내 역할을 확인했어요","I’m ready")}</button>
        </>}
        {round.phase === 'HINT' && <>
          <p role="status">{t('힌트','Clue round')} {round.hint_round}/{round.hint_rounds} · {currentName} {t('님 차례','’s turn')}</p>
          <ol>{round.participant_ids.map(id => <li key={id} aria-current={id === round.current_player_id ? 'step' : undefined}>{snapshot.players.find(p => p.id === id)?.nickname}{id === round.current_player_id ? t(" ← 현재 차례"," ← Current turn") : ''}{round.away_ids?.includes(id)?t(' · 자리 비움',' · Away'):''}{round.hint_pending_ids&&!round.hint_pending_ids.includes(id)?t(' · 완료',' · Done'):''}</li>)}</ol>
          {round.current_player_id === snapshot.me.player_id && <button className="primary" disabled={busy} onClick={() => void run('finish_hint',{round_id:round.id,hint_index:round.hint_index})}>{t("힌트 말하기 완료","Clue complete")}</button>}
        </>}
        {round.phase === 'DISCUSS' && <>
          <p role="timer">{remaining === null ? t("시간 제한 없이 토론하세요.","Discuss without a time limit.") : remaining > 0 ? t('남은 시간 '+remaining+'초',remaining+' seconds left') : t("시간 종료 · 서버에서 투표 단계를 준비하고 있어요.","Time is up. Preparing the vote.")}</p>
          {snapshot.me.is_host && <button className="primary" disabled={busy || remaining === 0} onClick={() => {
            if (remaining === null || confirmSkip) void run('start_vote',{round_id:round.id,skip_timer:true});
            else setConfirmSkip(true);
          }}>{remaining === null ? t("토론 마치고 투표로","End discussion and vote") : confirmSkip ? t("한 번 더 누르면 토론을 끝내요","Tap again to end discussion") : t("남은 시간 건너뛰기","Skip remaining time")}</button>}
        </>}
        {round.phase === 'PAUSED_HOST' && <p role="status">{t('방장이 진행을 멈췄어요.','The host paused the game.')}{round.remaining_ms !== null ? t(' 남은 토론 시간 '+Math.ceil(round.remaining_ms/1000)+'초',' Discussion time left: '+Math.ceil(round.remaining_ms/1000)+' sec') : ''}</p>}
        {['VOTE_1','VOTE_RUNOFF'].includes(round.phase) && round.vote && !round.me.eliminated && <>
          <p>{round.phase === 'VOTE_RUNOFF' ? t("공동 1위 후보에게 한 번 더 투표해요. 다시 동률이면 무승부예요.","Vote again for tied candidates. A second tie is a draw.") : t("라이어라고 생각하는 참가자 한 명을 선택하세요.","Choose the player you think is the liar.")}</p>
          <p role="status">{t('투표 제출','Votes')} {round.vote.submitted_count}/{round.participant_ids.length} · {t('개인 투표 비공개','Individual votes are private.')}</p>
          {round.me.voted ? <p>{t("투표를 제출했어요. 나머지 참가자를 기다려 주세요.","Vote submitted. Waiting for others.")}</p> : <>
            <fieldset className="vote-choices" disabled={busy}><legend>{t("본인을 제외한 투표 대상","Choose a candidate other than yourself")}</legend>
              {round.vote.candidate_ids.filter(id => id !== snapshot.me.player_id).map(id => <label key={id}>
                <input type="radio" name="vote-target" value={id} checked={voteTarget === id} onChange={() => {setVoteTarget(id);setConfirmVote('');}} />{playerName(id)}
              </label>)}
            </fieldset>
            {confirmVote ? <div>
              <p>{t(`${playerName(confirmVote)}님에게 투표할까요? 제출 후에는 바꿀 수 없어요.`,`Vote for ${playerName(confirmVote)}? You cannot change your vote.`)}</p>
              <button className="primary" disabled={busy} onClick={() => void run('submit_vote',{round_id:round.id,ballot_no:round.vote!.ballot_no,cycle_no:round.vote!.cycle_no ?? 1,target_id:confirmVote})}>{t("투표 확정","Confirm vote")}</button>
              <button disabled={busy} onClick={() => setConfirmVote('')}>{t("다시 선택","Choose again")}</button>
            </div> : <button className="primary" disabled={busy || !voteTarget} onClick={() => setConfirmVote(voteTarget)}>{t("선택 확인","Review choice")}</button>}
          </>}
        </>}
        {['VOTE_RUNOFF','REVEAL_VOTE','FINAL_RESULT'].includes(round.phase) && round.vote && <>
          {round.vote.tallies.map(tally => <div key={tally.ballot_no}><h3>{tally.ballot_no === 1 ? t("1차 투표 집계","First ballot") : t("재투표 집계","Runoff results")}</h3>
            <ul>{tally.counts.map(count => <li key={count.player_id}>{playerName(count.player_id)} · {count.votes} {t('표','votes')}</li>)}</ul>
          </div>)}
          {round.phase==='REVEAL_VOTE' && round.vote.selected_player_id && <p role="status">{t('최다 득표:','Most votes:')} {playerName(round.vote.selected_player_id)}. {t('잠시 후 라이어 여부를 공개합니다.','Role reveal coming up.')}</p>}
        </>}
        {snapshot.me.is_host && ['HINT','DISCUSS','PAUSED_HOST'].includes(round.phase) && <button disabled={busy} onClick={() => void run(round.phase === 'PAUSED_HOST' ? 'resume' : 'pause',{round_id:round.id})}>{round.phase === 'PAUSED_HOST' ? t("이어서 진행","Resume") : t("잠시 멈추기","Pause")}</button>}
      </>}
    </>}
    {(round.me || round.phase==='FINAL_RESULT') && ['REVEAL_LIAR','GUESS','APPEAL_WINDOW','APPEAL_VOTE','FINAL_RESULT'].includes(round.phase) && <ResultPanel snapshot={snapshot} busy={busy} remaining={remaining} run={run} />}
    {snapshot.me.is_host && round.phase === 'FINAL_RESULT' && <button className="primary" disabled={busy} onClick={() => void run('return_lobby',{round_id:round.id})}>{t("대기실로 · 다시 하기","Return to lobby · Play again")}</button>}
    {snapshot.me.is_host && round.phase !== 'FINAL_RESULT' && <button className="danger" disabled={busy || (round.phase === 'PAUSED_DISCONNECT' && remaining !== 0)} onClick={() => {
      if (confirmCancel) void run('cancel_round'); else setConfirmCancel(true);
    }}>{confirmCancel ? t("한 번 더 누르면 점수 없이 취소해요","Tap again to cancel without points") : t("현재 판 취소","Cancel round")}</button>}
  </section>;
}
