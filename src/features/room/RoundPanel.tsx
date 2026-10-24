import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../../lib/api';

export function RoundPanel({ snapshot, busy, run }: { snapshot: RoomSnapshot; busy: boolean; run: (action: string,payload?: object) => Promise<unknown> }) {
  const [word,setWord] = useState('');
  const [revealed,setRevealed] = useState(false);
  const [confirmCancel,setConfirmCancel] = useState(false);
  const round = snapshot.round!;
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
    <h2 id="round-title">{round.phase === 'COLLECT_WORDS' ? '제시어 후보 제출' : round.phase === 'REVEAL_ROLE' ? '내 역할 확인' : '역할 확인 완료'}</h2>
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
        {round.phase === 'HINT' && <p role="status">모두 역할을 확인했어요. 힌트·토론 진행은 다음 개발 단계에서 연결됩니다.</p>}
      </>}
    </>}
    {snapshot.me.is_host && <button className="danger" disabled={busy} onClick={() => {
      if (confirmCancel) void run('cancel_round'); else setConfirmCancel(true);
    }}>{confirmCancel ? '한 번 더 누르면 점수 없이 취소해요' : '현재 판 취소'}</button>}
  </section>;
}
