import { useState } from 'react';
import { applyQuoridorAction, canPlaceWall, createQuoridorGame, legalPawnMoves, type Position, type QuoridorGame, type Wall } from './engine';
import './quoridor.css';

const same = (a: Position,b: Position) => a[0]===b[0] && a[1]===b[1];
const pawnColors = ['#ffe2b3','#353a45','#e7a94e','#7bb1ec'];

export function QuoridorPreview() {
  const [game,setGame] = useState<QuoridorGame>(()=>createQuoridorGame(2));
  const [theme,setTheme] = useState<'wood'|'neon'>(()=>localStorage.getItem('quoridor-theme')==='neon'?'neon':'wood');
  const [wallMode,setWallMode] = useState(false);
  const [vertical,setVertical] = useState(false);
  const [pending,setPending] = useState<{type:'move';to:Position}|{type:'wall';wall:Wall}|null>(null);
  const [message,setMessage] = useState('말을 움직이거나 벽을 배치해 보세요.');
  const [flat,setFlat] = useState(false);
  const moves = game.winner===null && !wallMode ? legalPawnMoves(game) : [];

  function reset(count:2|4=game.playerCount) {
    setGame(createQuoridorGame(count));setPending(null);setWallMode(false);
    setMessage('새 게임입니다. 말이나 벽을 선택해 주세요.');
  }
  function changeTheme(next:'wood'|'neon') {setTheme(next);localStorage.setItem('quoridor-theme',next);}
  function choose(r:number,c:number) {
    if(game.winner!==null)return;
    if(wallMode){
      const wall={r:Math.min(r,7),c:Math.min(c,7),vertical};
      setPending({type:'wall',wall});setMessage(canPlaceWall(game,wall)?'벽 설치 위치를 확인하고 확정해 주세요.':'해당 위치는 벽 중첩·교차 또는 경로 차단으로 설치할 수 없습니다.');
    }else{
      const to:Position=[r,c];
      if(moves.some(p=>same(p,to))){setPending({type:'move',to});setMessage('말 이동을 확정해 주세요.');}
      else{setPending(null);setMessage('표시된 이동 가능 칸을 선택해 주세요.');}
    }
  }
  function confirm() {
    if(!pending)return;
    try {
      const next=applyQuoridorAction(game,pending);
      setGame(next);setPending(null);
      setMessage(next.winner===null?'차례가 넘어갔습니다.':`PLAYER ${next.winner+1} 승리!`);
    }catch {setPending(null);setMessage('유효하지 않은 행동입니다. 다시 선택해 주세요.');}
  }
  const walls=[...game.walls,...(pending?.type==='wall'?[pending.wall]:[])];
  return <main className={`quoridor ${theme}`}>
    <div className="q-header"><a href="/">← Party Game</a><span>QUORIDOR / LOCAL PREVIEW</span></div>
    <div className="q-heading"><p>3D STRATEGY BOARD</p><h1>나만의 전략, 나만의 스타일</h1><span>우드와 네온을 전환하며 모바일 게임판을 확인하세요.</span></div>
    <div className="q-controls" aria-label="게임 설정">
      <button className={theme==='wood'?'active':''} onClick={()=>changeTheme('wood')}>프리미엄 우드</button>
      <button className={theme==='neon'?'active':''} onClick={()=>changeTheme('neon')}>모던 네온</button>
      <button onClick={()=>reset(2)} className={game.playerCount===2?'active':''}>2인</button>
      <button onClick={()=>reset(4)} className={game.playerCount===4?'active':''}>4인</button>
    </div>
    <section className="q-panel">
      <div className="q-meta"><span>ROUND 01 · LOCAL SIMULATION</span><span>{game.winner===null?`PLAYER ${game.currentPlayer+1} TURN`:'GAME OVER'}</span></div>
      <h2>{game.winner===null?`플레이어 ${game.currentPlayer+1}의 차례`:`플레이어 ${game.winner+1} 승리!`}</h2>
      <p role="status">{message}</p>
      <div className="q-perspective"><div className={`q-board ${flat?'flat':''}`}>
        <div className="q-grid">
          {Array.from({length:81},(_,index)=>{
            const r=Math.floor(index/9),c=index%9;
            const occupant=game.positions.findIndex(pos=>pos[0]===r&&pos[1]===c);
            return <button type="button" key={index} aria-label={`${r+1}행 ${c+1}열`}
              className={`q-cell${moves.some(p=>p[0]===r&&p[1]===c)?' available':''}${pending?.type==='move'&&same(pending.to,[r,c])?' chosen':''}`}
              onClick={()=>choose(r,c)}>{occupant>=0&&<span className="q-pawn" style={{background:pawnColors[occupant]}}/>}</button>;
          })}
        </div>
        <div className="q-walls">{walls.map((wall,index)=>{
          const isPreview=index===walls.length-1&&pending?.type==='wall';
          const position=wall.vertical
            ? {top:`${(wall.r+0.97)/9*100}%`,left:`${(wall.c+0.93)/9*100}%`}
            : {top:`${(wall.r+0.93)/9*100}%`,left:`${(wall.c+0.98)/9*100}%`};
          return <span key={index} className={`q-wall ${wall.vertical?'vertical':'horizontal'}${isPreview?' ghost':''}${isPreview&&!canPlaceWall(game,wall)?' invalid':''}`} style={position}/>;
        })}</div>
      </div></div>
      <div className="q-actions">
        <button onClick={()=>setFlat(!flat)}>{flat?'3D 보기':'위에서 보기'}</button>
        <button className={wallMode?'selected':''} onClick={()=>{setWallMode(!wallMode);setPending(null);}}>벽 설치 {wallMode?'ON':'OFF'}</button>
        <button onClick={()=>{setVertical(!vertical);if(pending?.type==='wall')setPending({type:'wall',wall:{...pending.wall,vertical:!vertical}});}}>{vertical?'세로 벽':'가로 벽'}</button>
      </div>
      <div className="q-players">{game.positions.map((_,player)=><div key={player} className={game.currentPlayer===player&&game.winner===null?'current':''}>
        <i style={{background:pawnColors[player]}}/><strong>P{player+1}</strong><small>벽 {game.wallsRemaining[player]}개</small>
      </div>)}</div>
      <div className="q-bottom"><button className="q-reset" onClick={()=>reset()}>↺ 초기화</button><button className="q-confirm" disabled={!pending||game.winner!==null} onClick={confirm}>선택 확정</button></div>
    </section>
    <p className="q-disclaimer">현재는 브라우저 안에서 번갈아 두는 로컬 규칙 테스트입니다. 실제 온라인 방·관전·재접속·서버 검증은 후속 통합 단계에서 구현합니다.</p>
  </main>;
}
