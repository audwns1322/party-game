import { useState, type CSSProperties } from 'react';
import {
  applyQuoridorAction, canPlaceWall, createQuoridorGame, legalPawnMoves,
  type Position, type QuoridorAction, type QuoridorGame,
} from './engine';
import './quoridor.css';

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const pawnColors = ['#f5ddb5', '#444b58', '#f2a957', '#83b6ea'];
type Theme = 'wood' | 'neon';

function boardPercent(index: number) { return (index + 0.5) / 9 * 100; }
function jointPercent(index: number) { return (index + 1) / 9 * 100; }

export function QuoridorPreview() {
  const [game, setGame] = useState<QuoridorGame>(() => createQuoridorGame(2));
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('quoridor-theme') === 'neon' ? 'neon' : 'wood');
  const [wallMode, setWallMode] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [pending, setPending] = useState<QuoridorAction | null>(null);
  const [message, setMessage] = useState('이동할 칸을 누르거나 벽 설치 모드를 선택하세요.');
  const [topView, setTopView] = useState(false);
  const moves = game.winner === null && !wallMode ? legalPawnMoves(game) : [];
  const wallLegal = pending?.type === 'wall' && canPlaceWall(game, pending.wall);
  const ready = pending?.type === 'move' || wallLegal;

  function reset(count: 2 | 4 = game.playerCount) {
    setGame(createQuoridorGame(count));
    setPending(null); setWallMode(false);
    setMessage('새 게임을 시작했습니다. 움직일 칸을 선택하세요.');
  }

  function changeTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem('quoridor-theme', next);
  }

  function chooseCell(r: number, c: number) {
    if (game.winner !== null || wallMode) return;
    const to: Position = [r, c];
    if (moves.some(p => same(p, to))) {
      setPending({ type: 'move', to });
      setMessage('이동 위치를 확인하고 게임판 위에서 확정하세요.');
    } else {
      setPending(null);
      setMessage('빛나는 칸 중 하나를 선택해 주세요.');
    }
  }

  function chooseWall(r: number, c: number) {
    if (game.winner !== null || !wallMode) return;
    const wall = { r, c, vertical };
    setPending({ type: 'wall', wall });
    setMessage(canPlaceWall(game, wall)
      ? '이 위치에 벽을 설치할까요? 게임판 위에서 확정하세요.'
      : '여기는 설치할 수 없습니다. 벽 중첩이나 통로 차단을 확인하세요.');
  }

  function confirm() {
    if (!pending || !ready) return;
    try {
      const next = applyQuoridorAction(game, pending);
      setGame(next); setPending(null);
      setMessage(next.winner === null ? '이동이 완료됐습니다. 다음 플레이어 차례입니다.' : `플레이어 ${next.winner + 1} 승리!`);
    } catch {
      setPending(null); setMessage('게임 상태가 변경됐습니다. 위치를 다시 선택하세요.');
    }
  }

  function toggleWallMode() {
    setWallMode(value => !value); setPending(null);
    setMessage(wallMode ? '빛나는 칸을 선택해 말을 이동하세요.' : '벽 방향을 선택한 뒤 게임판의 빛나는 교차점을 누르세요.');
  }

  function changeOrientation(next: boolean) {
    setVertical(next); setPending(null);
    setMessage(`${next ? '세로' : '가로'} 벽을 선택했습니다. 원하는 교차점을 눌러주세요.`);
  }

  // The wall model uses intersection anchors (0–7, 0–7), independent of pawn cells.
  const walls = [...game.walls, ...(pending?.type === 'wall' ? [pending.wall] : [])];
  const selectedPoint = pending?.type === 'move'
    ? { x: boardPercent(pending.to[1]), y: boardPercent(pending.to[0]) }
    : pending?.type === 'wall'
      ? { x: jointPercent(pending.wall.c), y: jointPercent(pending.wall.r) }
      : null;

  return <main className={`quoridor ${theme}`}>
    <div className="q-header"><a href="/">← Party Game</a><span>QUORIDOR / 3D CONCEPT</span></div>
    <div className="q-heading"><p>THE ART OF STRATEGY</p><h1>한 수의 차이, 완전히 다른 승부.</h1><span>말을 움직이고 벽을 세우는 입체적인 전략 게임</span></div>

    <div className="q-toolbar" aria-label="게임판 설정">
      <div className="q-segment" aria-label="테마 선택">
        <button type="button" className={theme === 'wood' ? 'active' : ''} onClick={() => changeTheme('wood')}>◈ 프리미엄 우드</button>
        <button type="button" className={theme === 'neon' ? 'active' : ''} onClick={() => changeTheme('neon')}>✧ 모던 네온</button>
      </div>
      <div className="q-segment" aria-label="참가 인원">
        <button type="button" className={game.playerCount === 2 ? 'active' : ''} onClick={() => reset(2)}>2인</button>
        <button type="button" className={game.playerCount === 4 ? 'active' : ''} onClick={() => reset(4)}>4인</button>
      </div>
    </div>

    <div className="q-layout">
      <section className="q-arena" aria-label="쿼리도 게임판">
        <div className="q-arena-top"><span>FRIENDLY MATCH · ROUND 01</span><span className="q-live">● INTERACTIVE DEMO</span></div>
        <h2>{game.winner === null ? `PLAYER 0${game.currentPlayer + 1} 차례` : `PLAYER 0${game.winner + 1} 승리!`}</h2>
        <p className="q-message" role="status">{message}</p>

        <div className="q-stage">
          <div className={`q-board ${topView ? 'top-view' : ''}`}>
            <div className="q-grid">
              {Array.from({ length: 81 }, (_, index) => {
                const r = Math.floor(index / 9), c = index % 9;
                const occupant = game.positions.findIndex(p => p[0] === r && p[1] === c);
                const available = moves.some(p => p[0] === r && p[1] === c);
                return <button type="button" key={index} aria-label={`${r + 1}행 ${c + 1}열`}
                  className={`q-cell${available ? ' available' : ''}${pending?.type === 'move' && same(pending.to, [r,c]) ? ' chosen' : ''}`}
                  onClick={() => chooseCell(r,c)} disabled={wallMode || game.winner !== null}>
                  {occupant >= 0 && <span className={`q-pawn q-pawn-${occupant + 1}`} style={{ '--pawn-color': pawnColors[occupant] } as CSSProperties}><span className="q-pawn-head" /></span>}
                </button>;
              })}
            </div>

            <div className="q-wall-layer" aria-hidden="true">
              {walls.map((wall, index) => {
                const preview = index === walls.length - 1 && pending?.type === 'wall';
                return <span key={index} className={`q-wall ${wall.vertical ? 'vertical' : 'horizontal'}${preview ? ' ghost' : ''}${preview && !wallLegal ? ' invalid' : ''}`}
                  style={{ left: `${jointPercent(wall.c)}%`, top: `${jointPercent(wall.r)}%` }} />;
              })}
            </div>

            {wallMode && game.winner === null && <div className="q-hotspots" role="group" aria-label={`${vertical ? '세로' : '가로'} 벽 위치 선택`}>
              {Array.from({ length: 64 }, (_, index) => {
                const r = Math.floor(index / 8), c = index % 8;
                const isChosen = pending?.type === 'wall' && pending.wall.r === r && pending.wall.c === c;
                return <button type="button" key={index} aria-label={`${r + 1}행 ${c + 1}열 교차점에 ${vertical ? '세로' : '가로'} 벽 미리보기`}
                  className={`q-hotspot${isChosen ? ' chosen' : ''}`}
                  style={{ left: `${jointPercent(c)}%`, top: `${jointPercent(r)}%` }}
                  onClick={() => chooseWall(r,c)}><span className={vertical ? 'v' : 'h'} /></button>;
              })}
            </div>}

            {selectedPoint && <div className="q-board-confirm" style={{ left: `${Math.max(22,Math.min(78,selectedPoint.x))}%`, top: `${Math.max(12,selectedPoint.y - 8)}%` }}>
              <span>{pending?.type === 'wall' ? (wallLegal ? '여기에 벽 설치' : '설치 불가') : '이 칸으로 이동'}</span>
              <div><button type="button" onClick={() => setPending(null)}>취소</button>
                <button type="button" className="accept" disabled={!ready} onClick={confirm}>✓ 확정</button></div>
            </div>}
          </div>
        </div>

        <div className="q-action-bar">
          <button type="button" onClick={() => setTopView(value => !value)}>{topView ? '◈ 입체 보기' : '▦ 수직 보기'}</button>
          <button type="button" className={wallMode ? 'active' : ''} onClick={toggleWallMode}>▰ {wallMode ? '말 이동으로' : '벽 설치'}</button>
          {wallMode && <div className="q-orientations">
            <button type="button" className={!vertical ? 'active' : ''} onClick={() => changeOrientation(false)}>━ 가로</button>
            <button type="button" className={vertical ? 'active' : ''} onClick={() => changeOrientation(true)}>┃ 세로</button>
          </div>}
        </div>
        <div className="q-player-strip">{game.positions.map((_,i) => <div key={i} className={game.currentPlayer === i && game.winner === null ? 'current' : ''}>
          <i style={{ background: pawnColors[i] }}/><span><strong>PLAYER 0{i+1}</strong><small>벽 {game.wallsRemaining[i]}개 남음</small></span>
        </div>)}</div>
      </section>

      <aside className="q-sidebar">
        <section className="q-side-card"><h3>MATCH OVERVIEW</h3>
          <dl>
            <div><dt>게임 모드</dt><dd>{game.playerCount} PLAYERS</dd></div>
            <div><dt>현재 차례</dt><dd>{game.winner === null ? `PLAYER 0${game.currentPlayer+1}` : 'GAME OVER'}</dd></div>
            <div><dt>턴 제한</dt><dd>무제한</dd></div>
            <div><dt>진행한 턴</dt><dd>{game.turnNumber - 1}</dd></div>
            <div><dt>남은 벽</dt><dd>{game.wallsRemaining[game.currentPlayer]} / {game.playerCount === 2 ? 10 : 5}</dd></div>
          </dl><div className="q-wall-stock">{Array.from({length:game.playerCount===2?10:5},(_,i)=><span key={i} className={i>=game.wallsRemaining[game.currentPlayer]?'used':''}/>)}</div>
        </section>
        <section className="q-side-card"><h3>HOW TO PLAY</h3>
          <ol><li>빛나는 칸을 눌러 말을 선택하세요.</li><li>게임판 위의 <strong>✓ 확정</strong>을 누르세요.</li><li>벽 설치에서는 가로·세로를 고르고 교차점을 터치하세요.</li></ol>
          <div className="q-tip"><span>✦</span> 설치 전 반투명 벽으로 위치를 미리 볼 수 있습니다.</div>
          <button type="button" className="q-reset" onClick={() => reset()}>↺ 게임판 초기화</button>
        </section>
      </aside>
    </div>
    <p className="q-disclaimer">3D UI·로컬 규칙 검증용 미리보기입니다. 실제 온라인 방·실시간 동기화·재접속 기능은 아직 연결되지 않았습니다.</p>
  </main>;
}
