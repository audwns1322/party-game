import { useEffect, useRef, useState, type FormEvent } from 'react';
import { navigate } from '../../lib/router';
import { playBombExplosion } from './bombAudio';
import { BOMB_TOPICS, DEMO_PLAYERS, checkBombAnswer, nextBombHolder, randomBombHolder, randomExplosionDelay } from './demoEngine';
import './bomb-pass.css';

type Phase = 'ready' | 'countdown' | 'playing' | 'exploded' | 'finished';
type AnswerMode = 'voice' | 'text';
type TurnStyle = 'pass' | 'random';
type SubmittedAnswer = { player: string; answer: string };
const maxOptions = [15, 30, 45, 60, 90, 120, 180];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes === 0) return `${remaining}초`;
  return `${minutes}분${remaining ? ` ${remaining}초` : ''}`;
}

export function BombPassPreview({ local = false }: { local?: boolean }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [mode, setMode] = useState<AnswerMode>('voice');
  const [turnStyle, setTurnStyle] = useState<TurnStyle>('pass');
  const [maxSeconds, setMaxSeconds] = useState(45);
  const [playerCount, setPlayerCount] = useState(5);
  const [localNames, setLocalNames] = useState(() => DEMO_PLAYERS.slice(0,5));
  const [namesDraft, setNamesDraft] = useState(() => DEMO_PLAYERS.slice(0,5).join('\n'));
  const [nameError, setNameError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [round, setRound] = useState(1);
  const [holder, setHolder] = useState(0);
  const [explodedHolder, setExplodedHolder] = useState<number | null>(null);
  const [topicIndex, setTopicIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [explosionCounts, setExplosionCounts] = useState<number[]>(() => Array(DEMO_PLAYERS.length).fill(0));
  const [answers, setAnswers] = useState<SubmittedAnswer[]>([]);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const audioContext = useRef<AudioContext | null>(null);
  const bombDeadline = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const players = local ? localNames : DEMO_PLAYERS.slice(0, playerCount);
  const active = phase !== 'ready' && phase !== 'finished';
  const topic = BOMB_TOPICS[topicIndex];

  function unlockAudio() {
    if (typeof AudioContext === 'undefined') { setSoundEnabled(false); setFeedback('이 브라우저는 효과음을 지원하지 않아요.'); return; }
    if (!audioContext.current) audioContext.current = new AudioContext();
    void audioContext.current.resume().then(() => setAudioReady(true)).catch(() => setAudioReady(false));
  }

  useEffect(() => () => { void audioContext.current?.close(); }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown > 0) {
      const timer = window.setTimeout(() => setCountdown(current => current - 1), 1000);
      return () => window.clearTimeout(timer);
    }
    bombDeadline.current = performance.now() + randomExplosionDelay(maxSeconds);
    setPhase('playing');
  }, [phase, countdown, maxSeconds]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      if (bombDeadline.current === null || performance.now() < bombDeadline.current) return;
      bombDeadline.current = null;
      setExplodedHolder(holder);
      setExplosionCounts(previous => previous.map((value, index) => index === holder ? value + 1 : value));
      setPhase('exploded');
      if (soundEnabled && audioContext.current) playBombExplosion(audioContext.current);
    }, 40);
    return () => window.clearInterval(timer);
  }, [phase, holder, soundEnabled]);

  useEffect(() => {
    if (!active || startedAt.current === null) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt.current!) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  function startGame() {
    let count = playerCount;
    if (local) {
      const names = namesDraft.split(/[\n,]/).map(item=>item.normalize('NFC').trim()).filter(Boolean);
      if (names.length < 3 || names.length > 15 || names.some(name=>[...name].length<2||[...name].length>16||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name)) ||
        new Set(names.map(name=>name.toLocaleLowerCase('ko'))).size !== names.length) {
        setNameError('서로 다른 이름을 3~15명, 각 2~16자로 입력해 주세요.');
        return;
      }
      setLocalNames(names);
      setPlayerCount(names.length);
      setNameError('');
      count = names.length;
    }
    if (soundEnabled) unlockAudio();
    setRound(1);
    setTopicIndex(0);
    setHolder(turnStyle === 'random' ? randomBombHolder(null, count) : 0);
    setExplodedHolder(null);
    setExplosionCounts(Array(DEMO_PLAYERS.length).fill(0));
    setAnswers([]);
    setAnswer('');
    setFeedback('');
    setCountdown(3);
    setElapsedSeconds(0);
    startedAt.current = Date.now();
    bombDeadline.current = null;
    setPhase('countdown');
  }

  function startNextRound() {
    if (phase !== 'exploded') return;
    setRound(value => value + 1);
    setTopicIndex(value => (value + 1) % BOMB_TOPICS.length);
    setHolder(value => turnStyle === 'random' ? randomBombHolder(null, playerCount) : nextBombHolder(value, playerCount));
    setExplodedHolder(null);
    setAnswers([]);
    setAnswer('');
    setFeedback('');
    setCountdown(3);
    setPhase('countdown');
  }

  function passBomb(event?: FormEvent) {
    event?.preventDefault();
    if (phase !== 'playing') return;
    if (bombDeadline.current !== null && performance.now() >= bombDeadline.current) return;
    if (mode === 'text') {
      const issue = checkBombAnswer(answer, answers.map(item => item.answer));
      if (issue) { setFeedback(issue); return; }
      setAnswers(previous => [...previous, { player: players[holder], answer: answer.trim() }]);
      setAnswer('');
    }
    const nextHolder = turnStyle === 'random' ? randomBombHolder(holder, playerCount) : nextBombHolder(holder, playerCount);
    setHolder(nextHolder);
    setFeedback(turnStyle === 'random' ? `🎯 다음 지목: ${players[nextHolder]}님!` : '폭탄을 다음 사람에게 넘겼어요!');
  }

  function finishGame() {
    bombDeadline.current = null;
    setConfirmStop(false);
    setPhase('finished');
    if (startedAt.current !== null) setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
  }

  const totalExplosions = explosionCounts.slice(0, playerCount).reduce((sum, value) => sum + value, 0);

  return <main className="bomb-pass-preview">
    <div className="bp-shell">
      <header className="bp-header">
        <button type="button" className="bp-back" onClick={() => navigate('/')} aria-label="Party Game 홈으로 이동">← <span>PARTY GAME</span></button>
        <span className="bp-preview-tag">{local ? '● LOCAL PLAY' : '● INTERACTIVE PREVIEW'}</span>
      </header>

      <div className="bp-title-area">
        <div className="bp-eyebrow">DON'T HOLD IT · PASS IT!</div>
        <h1>폭탄 <em>돌리기</em><span aria-hidden="true">💣</span></h1>
        <p>언제 터질지는 아무도 몰라. 답하고, 넘기고, 또 터뜨리자!</p>
      </div>

      <div className="bp-layout">
        <section className="bp-main-card" aria-label="폭탄 돌리기 게임 미리보기">
          <div className="bp-stage-top">
            <span className="bp-overline">{phase === 'ready' ? 'READY TO PLAY' : phase === 'finished' ? 'SESSION COMPLETE' : `ROUND ${String(round).padStart(2, '0')}`}</span>
            <button type="button" className="bp-sound" aria-pressed={soundEnabled&&audioReady} onClick={() => { if (!audioReady) { setSoundEnabled(true); unlockAudio(); } else setSoundEnabled(value => !value); }}>
              {!audioReady ? '🔊 효과음 켜기' : soundEnabled ? '🔊 소리 켜짐' : '🔇 음소거'}
            </button>
          </div>

          <div className={`bp-stage bp-${phase}`}>
            <div className="bp-stage-glow" aria-hidden="true" />
            <div className="bp-sparks" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
            {phase === 'exploded' ? <div className="bp-explosion" aria-hidden="true"><strong>BOOM!</strong><span>💥</span></div>
              : <div className="bp-bomb-wrap" aria-hidden="true">
                  <div className="bp-fuse"><i/></div>
                  <div className="bp-bomb"><span className="bp-bomb-shine"/><span className="bp-bomb-symbol">!</span></div>
                  <span className="bp-bomb-shadow"/>
                </div>}

            <div className="bp-stage-copy" role="status" aria-live="polite">
              {phase === 'ready' && <><strong>준비됐어?</strong><span>폭탄을 넘길 준비를 해봐!</span></>}
              {phase === 'countdown' && <><strong className="bp-countdown">{countdown === 0 ? 'START!' : countdown}</strong><span>주제 확인하고 집중!</span></>}
              {phase === 'playing' && <><strong>{turnStyle === 'random' ? '🎯 ' : ''}{players[holder]}님의 차례!</strong><span>{turnStyle === 'random' ? '갑자기 지목됐다! 서둘러 답해!' : '빨리 답하고 폭탄을 넘겨!'}</span></>}
              {phase === 'exploded' && <><strong>{players[explodedHolder ?? 0]}님, 터졌다!</strong><span>다음 라운드는 준비되면 시작해!</span></>}
              {phase === 'finished' && <><strong>오늘의 폭탄 파티 종료!</strong><span>언제든 또 시작할 수 있어.</span></>}
            </div>
          </div>

          {(phase === 'countdown' || phase === 'playing' || phase === 'exploded') &&
            <div className="bp-topic"><span>이번 주제</span><strong>{topic}</strong><small>폭발 시각은 비밀 · 최대 {formatDuration(maxSeconds)}</small></div>}

          {phase === 'ready' && <div className="bp-controls">
            <section className="bp-howto" aria-labelledby="bp-howto-title">
              <div className="bp-howto-heading"><span>⚡ 10초 룰 설명</span><h2 id="bp-howto-title">받고, 답하고, 넘겨!</h2></div>
              <ol className="bp-instructions">
                <li><span className="bp-step-icon" aria-hidden="true">👀</span><strong>주제 확인</strong><small>예: 과일 이름</small></li>
                <li><span className="bp-step-icon" aria-hidden="true">🗣️</span><strong>빠르게 답하기</strong><small>“사과!”</small></li>
                <li><span className="bp-step-icon" aria-hidden="true">💣</span><strong>{turnStyle === 'random' ? '랜덤 지목!' : '다음 사람에게!'}</strong><small>{turnStyle === 'random' ? '누가 걸릴지 몰라' : '답했으면 바로 패스'}</small></li>
                <li><span className="bp-step-icon" aria-hidden="true">💥</span><strong>갑자기 BOOM!</strong><small>들고 있던 사람 당첨</small></li>
              </ol>
              <p className="bp-howto-footer">🎉 탈락 없이 계속 플레이! <span>언제 터질지는 아무도 몰라.</span></p>
            </section>
            {local&&<div><label className="bp-local-name-label" htmlFor="bp-local-names">참가자 이름 · 한 줄에 한 명</label><textarea className="bp-local-names" id="bp-local-names" value={namesDraft} onChange={e=>{setNamesDraft(e.target.value);setNameError('');}} placeholder="명준&#10;지민&#10;서연"/>{nameError&&<p className="bp-local-error" role="alert">{nameError}</p>}<p className="bp-local-mode-note">📱 한 대의 휴대폰을 실제로 돌려가며 플레이합니다. 답을 말한 뒤 다음 사람에게 넘겨 주세요.</p></div>}
            <div className="bp-turn-style" role="group" aria-labelledby="bp-style-label">
              <span className="bp-field-label" id="bp-style-label">진행 방식</span>
              <div className="bp-toggle bp-style-toggle"><button type="button" className={turnStyle === 'pass' ? 'selected' : ''} aria-pressed={turnStyle === 'pass'} onClick={() => setTurnStyle('pass')}>📱 순서대로 돌리기</button><button type="button" className={turnStyle === 'random' ? 'selected' : ''} aria-pressed={turnStyle === 'random'} onClick={() => setTurnStyle('random')}>🎲 랜덤 지목</button></div>
              <p className="bp-style-description">{turnStyle === 'random' ? '답할 때마다 다른 사람이 무작위로 지목돼요. 타이머는 멈추지 않습니다.' : '한 대의 폰을 돌려 쓰는 현장 모드예요. 답하고 다음 사람에게 넘겨 주세요.'}</p>
            </div>
            <div className="bp-fields">
              <div><span className="bp-field-label" id="bp-mode-label">답변 방식</span><div className="bp-toggle" role="group" aria-labelledby="bp-mode-label"><button type="button" aria-pressed={mode === 'voice'} className={mode === 'voice' ? 'selected' : ''} onClick={() => setMode('voice')}>🎙️ 말하기</button><button type="button" aria-pressed={mode === 'text'} className={mode === 'text' ? 'selected' : ''} onClick={() => setMode('text')}>⌨️ 텍스트</button></div></div>
              <div><label htmlFor="bp-max">최대 폭발 시간</label><select id="bp-max" value={maxSeconds} onChange={event => setMaxSeconds(Number(event.target.value))}>{maxOptions.map(value => <option key={value} value={value}>최대 {formatDuration(value)}</option>)}</select></div>
              {!local&&<div><label htmlFor="bp-count">참가 인원 (데모)</label><select id="bp-count" value={playerCount} onChange={event => setPlayerCount(Number(event.target.value))}>{[3, 4, 5, 6, 8, 10, 12, 15].map(value => <option key={value} value={value}>{value}명</option>)}</select></div>}
            </div>
            {!audioReady&&<p className="bp-online-summary">🔊 폭탄 소리를 들으려면 위의 ‘효과음 켜기’를 한 번 눌러 주세요.</p>}
            <button type="button" className="bp-main-button" onClick={startGame}>게임 시작하기 <span>→</span></button>
            <small className="bp-note">{local ? '현장 모드는 이 기기에서만 동작합니다. 온라인 게임은 홈에서 방을 만들어 주세요.' : '📱 지금은 휴대폰 한 대로 체험하는 데모예요. 여러 기기 연결은 아직 지원하지 않아요.'}</small>
            <small className="bp-note bp-time-note">폭발 시점은 완전 랜덤 · 시작 직후에도 터질 수 있어요!</small>
          </div>}

          {phase === 'playing' && <div className="bp-actions">
            {mode === 'text' ? <form onSubmit={passBomb}>
              <label htmlFor="bp-answer">주제에 맞는 답변</label>
              <input id="bp-answer" value={answer} onChange={event => { setAnswer(event.target.value); setFeedback(''); }} placeholder="예: 사과" maxLength={50} autoComplete="off" enterKeyHint="send"/>
              <button type="submit" className="bp-main-button">{turnStyle === 'random' ? '답변하고 다음 사람 지목' : '답변하고 넘기기'} <span>→</span></button>
            </form> : <><p>답을 크게 말한 다음 버튼을 눌러!</p><button type="button" className="bp-main-button" onClick={() => passBomb()}>{turnStyle === 'random' ? '🎲 다음 사람 지목하기' : '폭탄 넘기기'} <span>→</span></button></>}
            <p role="status" className="bp-feedback">{feedback || '정확한 남은 시간은 표시하지 않아요.'}</p>
          </div>}

          {phase === 'exploded' && <div className="bp-between-rounds"><div className="bp-result-mini"><span>💥 {players[explodedHolder ?? 0]}님의 누적 폭발</span><strong>{explosionCounts[explodedHolder ?? 0]}회</strong></div><h2>한 판 더 할까요?</h2><p>폭탄은 멈췄어요. 모두 준비되면 다시 시작!</p><button type="button" className="bp-main-button" onClick={startNextRound}>▶ 다음 라운드 시작</button><button type="button" className="bp-end" onClick={finishGame}>오늘은 여기까지</button></div>}
          {phase === 'countdown' && <p className="bp-waiting">서두르지 마! 시작 신호가 나오면 답변할 수 있어.</p>}
          {phase === 'finished' && <div className="bp-final-summary"><div><span>총 라운드</span><strong>{totalExplosions}</strong></div><div><span>플레이 시간</span><strong>{Math.floor(elapsedSeconds / 60)}분 {elapsedSeconds % 60}초</strong></div><button type="button" className="bp-main-button" onClick={startGame}>같은 인원으로 다시 시작 →</button></div>}
        </section>

        <aside className="bp-aside">
          <section className="bp-side-panel">
            <div className="bp-panel-title"><span>PLAYERS</span><b>{playerCount}명 참가</b></div>
            <div className="bp-players">{players.map((player, index) => <div key={player} className={`bp-player${phase === 'playing' && holder === index ? ' holding' : ''}`}>
              <span className="bp-avatar">{player.slice(0, 1)}</span><span className="bp-player-name">{player}{index === 0 && <small>{local?'진행자':'방장 · 데모'}</small>}</span><span className="bp-player-stat">💥 {explosionCounts[index]}</span>
            </div>)}</div>
            {active && <button type="button" className="bp-end" onClick={() => setConfirmStop(true)}>■ 게임 종료하기</button>}
          </section>
          <section className="bp-side-panel bp-tip-panel"><span>✦ PARTY TIPS</span><p>목숨도, 탈락도 없어. 폭탄이 터져도 모두 다시 참여해. 끝내고 싶을 때 종료하면 돼!</p><div className="bp-progress-note"><span>최대 시간만 공개</span><b>{formatDuration(maxSeconds)} MAX</b></div></section>
          {mode === 'text' && active && <section className="bp-side-panel bp-answer-history"><span>이번 라운드의 답</span>{answers.length === 0 ? <p>아직 제출된 답이 없어요.</p> : <ol>{answers.slice(-6).map((item, index) => <li key={`${item.player}-${index}`}><strong>{item.player}</strong><span>{item.answer}</span></li>)}</ol>}</section>}
        </aside>
      </div>

      {confirmStop && <div className="bp-modal-backdrop" role="presentation"><div className="bp-modal" role="dialog" aria-modal="true" aria-labelledby="bp-stop-title"><h2 id="bp-stop-title">게임을 종료할까요?</h2><p>현재 폭탄은 취소하고 지금까지의 폭발 기록을 보여드려요.</p><div><button type="button" onClick={() => setConfirmStop(false)}>계속 플레이</button><button type="button" className="bp-confirm" onClick={finishGame}>종료하기</button></div></div></div>}
      <p className="bp-disclaimer">{local ? '현장 모드는 이 휴대폰에서 실행됩니다. 새로고침하면 진행 중인 게임이 초기화되므로 화면을 닫지 마세요.' : '디자인·동작 확인용 로컬 미리보기입니다. 현재 화면의 인원과 폭발 타이머는 시뮬레이션이며, 실제 서버 판정·온라인 방·재접속 기능은 아직 연결되지 않았습니다.'}</p>
    </div>
  </main>;
}
