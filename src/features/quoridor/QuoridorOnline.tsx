import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type Player, type RoomSnapshot } from '../../lib/api';
import type { StoredSession } from '../../lib/session';
import { navigate } from '../../lib/router';
import { canPlaceWall, legalPawnMoves, type Position, type QuoridorAction, type QuoridorGame } from './engine';
import { Pawn3D } from './Pawn3D';
import './quoridor.css';

type Match = {status:'lobby'|'playing'|'finished';playerCount:2|4;turnLimit:number;undoEnabled:boolean;scores:Record<string,number>;
  game?:QuoridorGame;seats?:string[];deadlineAt?:string|null;extended?:boolean;undoUsed?:Record<string,boolean>;
  previous?:{before:QuoridorGame;actor:string}|null;matchNumber?:number};
type Data = {version:number;room_version:number;state:Match;me:string;host:string;server_now:string};
type Props = {session:StoredSession;room:RoomSnapshot['room'];me:RoomSnapshot['me'];players:Player[];online:boolean};
const colors=['#f5ddb5','#444b58','#f2a957','#83b6ea'];
const same=(a:Position,b:Position)=>a[0]===b[0]&&a[1]===b[1];
const joint=(i:number)=>(i+1)/9*100;

export function QuoridorOnline({session,room,me,players,online}:Props) {
  const [data,setData]=useState<Data|null>(null);
  const [theme,setTheme]=useState<'wood'|'neon'>(()=>localStorage.getItem('quoridor-theme')==='neon'?'neon':'wood');
  const [pending,setPending]=useState<QuoridorAction|null>(null);
  const [wallMode,setWallMode]=useState(false);
  const [vertical,setVertical]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('말을 이동하거나 벽을 설치할 위치를 선택하세요.');
  const [busy,setBusy]=useState(false);
  const [clock,setClock]=useState(Date.now());
  const [serverOffset,setServerOffset]=useState(0);
  const [draft,setDraft]=useState<{playerCount:2|4;turnLimit:number;undoEnabled:boolean}|null>(null);
  const [inviteCopied,setInviteCopied]=useState(false);
  const fetchState=useCallback(async()=>{
    const next=await api.quoridor<Data>(session,'snapshot');
    setData(previous=>!previous||next.version>=previous.version?next:previous);
    setServerOffset(Date.parse(next.server_now)-Date.now());
  },[session]);
  useEffect(()=>{void fetchState().catch(e=>setError(messageFor(e)));},[fetchState,room.version]);
  useEffect(()=>{
    const poll=window.setInterval(()=>void fetchState().catch(()=>undefined),2000);
    const tick=window.setInterval(()=>setClock(Date.now()),250);
    return ()=>{clearInterval(poll);clearInterval(tick);};
  },[fetchState]);
  useEffect(()=>{if(data&&!draft) setDraft({playerCount:data.state.playerCount,turnLimit:data.state.turnLimit,undoEnabled:data.state.undoEnabled});},[data,draft]);
  useEffect(()=>{setPending(null);setWallMode(false);},[data?.state.game?.turnNumber,data?.state.status]);

  const state=data?.state;
  const game=state?.game;
  const yourTurn=!!(state?.status==='playing'&&game&&state.seats?.[game.currentPlayer]===me.player_id);
  const moves=yourTurn&&game&&!wallMode?legalPawnMoves(game):[];
  const wallLegal=!!(game&&pending?.type==='wall'&&canPlaceWall(game,pending.wall));
  const ready=yourTurn&&(pending?.type==='move'||wallLegal);
  const remaining=state?.deadlineAt?Math.max(0,Math.ceil((Date.parse(state.deadlineAt)-(clock+serverOffset))/1000)):null;
  const playerName=(index:number)=>players.find(p=>p.id===state?.seats?.[index])?.nickname??`PLAYER 0${index+1}`;

  async function command(action:string,payload:object={}) {
    if(!data||busy) return;
    setBusy(true);setError('');
    try {
      const next=await api.quoridor<Data>(session,action,data.version,payload);
      setData(next);setServerOffset(Date.parse(next.server_now)-Date.now());
      setPending(null);
      if(action==='wall'||action==='move') {setWallMode(false);setMessage(action==='wall'?'벽 설치 완료 · 다음 차례입니다.':'말 이동 완료 · 다음 차례입니다.');}
      if(action==='undo') {setWallMode(false);setMessage('직전 수를 무르고 다시 둘 수 있습니다.');}
    } catch(e) {setError(messageFor(e));void fetchState().catch(()=>undefined);}
    finally {setBusy(false);}
  }
  function chooseCell(r:number,c:number) {
    if(!yourTurn||wallMode)return;
    if(moves.some(p=>same(p,[r,c]))) {setPending({type:'move',to:[r,c]});setMessage('선택한 위치를 확인하고 확정하세요.');}
    else {setPending(null);setMessage('빛나는 이동 가능 칸을 선택하세요.');}
  }
  function chooseWall(r:number,c:number) {
    if(!yourTurn||!game)return;
    const wall={r,c,vertical};setPending({type:'wall',wall});
    setMessage(canPlaceWall(game,wall)?'벽 위치를 확인하고 확정하세요.':'여기에는 벽을 놓을 수 없습니다.');
  }
  function setAppearance(next:'wood'|'neon') {setTheme(next);localStorage.setItem('quoridor-theme',next);}
  const displayedWalls=[...(game?.walls??[]),...(pending?.type==='wall'?[pending.wall]:[])];

  return <main className={`quoridor ${theme}`}>
    <div className="q-header"><button type="button" onClick={()=>navigate('/')}>← Party Game</button><span>QUORIDOR / ONLINE MATCH</span></div>
    <div className="q-heading"><p>THE ART OF STRATEGY</p><h1>각자의 폰에서, 하나의 승부.</h1><span>방 코드 {room.code} · {online?'실시간 연결됨':'연결 재시도 중'}</span></div>
    <div className="q-toolbar">
      <div className="q-segment" aria-label="개인별 테마 선택">
        <button type="button" className={theme==='wood'?'active':''} onClick={()=>setAppearance('wood')}>◈ 프리미엄 우드</button>
        <button type="button" className={theme==='neon'?'active':''} onClick={()=>setAppearance('neon')}>✧ 모던 네온</button>
      </div>
      <div className="q-online-invite"><strong>방 코드 {room.code}</strong><button type="button" onClick={async()=>{
        try {await navigator.clipboard.writeText(`${location.origin}/room/${room.code}`);setInviteCopied(true);} catch {setError('초대 링크를 복사할 수 없습니다.');}
      }}>{inviteCopied?'복사 완료':'초대 링크 복사'}</button></div>
    </div>
    {!data&&<p role="status" className="q-message">온라인 게임 상태를 불러오는 중입니다…</p>}
    {error&&<p role="alert" className="q-online-error">{error}</p>}
    {state?.status!=='playing'&&state&&<section className="q-online-lobby">
      <h2>{state.status==='finished'?'이번 판 결과':'온라인 대기실'}</h2>
      {state.status==='finished'&&game?.winner!==null&&game?.winner!==undefined&&<p className="q-online-winner">🏆 {playerName(game.winner)} 승리!</p>}
      <p>참가자 {players.length}/{state.playerCount}명 · 모두 각자의 휴대폰으로 방에 입장해 주세요.</p>
      <div className="q-online-roster">{players.map(p=><span key={p.id}>{p.nickname}{p.id===me.player_id?' (나)':''}{p.id===room.host_player_id?' ★':''} · {state.scores[p.id]??0}승</span>)}</div>
      {me.is_host&&state.status==='lobby'&&draft&&<div className="q-online-config">
        <label>인원 <select value={draft.playerCount} onChange={e=>setDraft({...draft,playerCount:Number(e.target.value) as 2|4})}><option value={2}>2인</option><option value={4}>4인</option></select></label>
        <label>턴 제한 <select value={draft.turnLimit} onChange={e=>setDraft({...draft,turnLimit:Number(e.target.value)})}><option value={0}>무제한</option>{Array.from({length:12},(_,i)=>(i+1)*5).map(n=><option key={n} value={n}>{n}초</option>)}</select></label>
        <label><input type="checkbox" checked={draft.undoEnabled} onChange={e=>setDraft({...draft,undoEnabled:e.target.checked})}/> 플레이어당 무르기 1회 허용</label>
        <button type="button" disabled={busy} onClick={()=>void command('settings',draft)}>설정 저장</button>
      </div>}
      {me.is_host?<button type="button" className="q-start" disabled={busy||players.length!==state.playerCount} onClick={()=>void command(state.status==='finished'?'rematch':'start')}>{state.status==='finished'?'같은 방에서 재대결 준비':'게임 시작'}</button>
        :<p>방장이 {state.status==='finished'?'재대결을 준비':'게임을 시작'}할 때까지 기다려 주세요.</p>}
    </section>}

    {game&&<div className="q-layout">
      <section className="q-arena" aria-label="온라인 쿼리도 게임판">
        <div className="q-arena-top"><span>ONLINE MATCH · ROUND {String(state?.matchNumber??1).padStart(2,'0')}</span><span className="q-live">● {online?'LIVE SYNC':'RECONNECTING'}</span></div>
        <h2>{game.winner===null?`${playerName(game.currentPlayer)} 차례${yourTurn?' · 내 차례':''}`:`${playerName(game.winner)} 승리!`}</h2>
        <p className="q-message" role="status">{yourTurn?message:'다른 플레이어의 선택을 기다리고 있습니다.'}</p>
        {Boolean(state?.turnLimit)&&game.winner===null&&<div className={`q-timer${remaining!==null&&remaining<=5?' urgent':''}`} role="timer"><span>TURN TIMER</span><strong>{remaining}초</strong>{state?.extended&&<em>연장 중 · 다시 초과하면 턴 넘김</em>}<div className="q-timer-track"><i style={{width:`${Math.min(100,(remaining??0)/(state?.turnLimit??1)*100)}%`}}/></div></div>}
        <div className="q-stage"><div className="q-board"><div className="q-grid">
          {Array.from({length:81},(_,index)=>{const r=Math.floor(index/9),c=index%9;
            const occupant=game.positions.findIndex(p=>p[0]===r&&p[1]===c);
            const available=moves.some(p=>p[0]===r&&p[1]===c);
            return <button type="button" key={index} aria-label={`${r+1}행 ${c+1}열`} className={`q-cell${available?' available':''}${pending?.type==='move'&&same(pending.to,[r,c])?' chosen':''}`} onClick={()=>chooseCell(r,c)} disabled={!yourTurn||wallMode}>
              {occupant>=0&&<Pawn3D color={colors[occupant]} player={occupant}/>}</button>;})}
        </div><div className="q-wall-layer" aria-hidden="true">{displayedWalls.map((w,i)=>{const preview=i===displayedWalls.length-1&&pending?.type==='wall';return <span key={i} className={`q-wall ${w.vertical?'vertical':'horizontal'}${preview?' ghost':''}${preview&&!wallLegal?' invalid':''}`} style={{left:`${joint(w.c)}%`,top:`${joint(w.r)}%`}}/>;})}</div>
        {yourTurn&&wallMode&&<div className="q-hotspots" role="group" aria-label="벽 설치 위치">{Array.from({length:64},(_,i)=>{const r=Math.floor(i/8),c=i%8;return <button key={i} type="button" aria-label={`${r+1}행 ${c+1}열 ${vertical?'세로':'가로'} 벽`} className={`q-hotspot${pending?.type==='wall'&&pending.wall.r===r&&pending.wall.c===c?' chosen':''}`} style={{left:`${joint(c)}%`,top:`${joint(r)}%`}} onClick={()=>chooseWall(r,c)}><span className={vertical?'v':'h'}/></button>;})}</div>}
        </div></div>
        {pending&&pending.type!=='skip'&&yourTurn&&<div className="q-board-confirm" role="group"><span>{pending.type==='wall'?'이 위치에 벽 설치':'이 위치로 말 이동'}</span><div><button type="button" onClick={()=>setPending(null)}>취소</button><button type="button" className="accept" disabled={!ready||busy} onClick={()=>void command(pending.type,pending.type==='move'?{to:pending.to}:{wall:pending.wall})}>✓ 선택 확정</button></div></div>}
        <div className="q-action-bar"><button type="button" disabled={!yourTurn||busy} className={wallMode?'active':''} onClick={()=>{setWallMode(!wallMode);setPending(null);}}>{wallMode?'말 이동으로':'▰ 벽 설치'}</button>
          {state?.undoEnabled&&<button type="button" disabled={busy||!state.previous||state.previous.actor!==me.player_id||!!state.undoUsed?.[me.player_id]} onClick={()=>void command('undo')}>↶ 직전 수 무르기</button>}
          {wallMode&&<div className="q-orientations"><button type="button" className={!vertical?'active':''} onClick={()=>{setVertical(false);setPending(null);}}>━ 가로</button><button type="button" className={vertical?'active':''} onClick={()=>{setVertical(true);setPending(null);}}>┃ 세로</button></div>}
        </div>
        <div className="q-player-strip">{game.positions.map((_,i)=><div key={i} className={game.currentPlayer===i&&game.winner===null?'current':''}><i style={{background:colors[i]}}/><span><strong>{playerName(i)}</strong><small>벽 {game.wallsRemaining[i]}개 · {state?.scores[state.seats?.[i]??'']??0}승</small></span></div>)}</div>
      </section>
      <aside className="q-sidebar"><section className="q-side-card"><h3>MATCH OVERVIEW</h3><dl>
        <div><dt>게임 모드</dt><dd>{state?.playerCount} PLAYERS</dd></div><div><dt>현재 차례</dt><dd>{game.winner===null?playerName(game.currentPlayer):'GAME OVER'}</dd></div>
        <div><dt>턴 제한</dt><dd>{state?.turnLimit?`${state.turnLimit}초`:'무제한'}</dd></div><div><dt>무르기</dt><dd>{state?.undoEnabled?'플레이어당 1회':'사용 안 함'}</dd></div>
        <div><dt>진행한 턴</dt><dd>{game.turnNumber-1}</dd></div><div><dt>남은 벽</dt><dd>{game.wallsRemaining[game.currentPlayer]}개</dd></div>
      </dl></section><section className="q-side-card"><h3>HOW TO PLAY</h3><ol><li>각자 다른 폰에서 같은 방 코드로 입장합니다.</li><li>자기 차례에 말 이동 또는 벽 설치를 확정합니다.</li><li>첫 시간 초과는 연장, 두 번째는 자동 턴 넘김입니다.</li><li>무르기는 상대가 다음 수를 두기 전 1회만 가능합니다.</li></ol></section></aside>
    </div>}
    <p className="q-disclaimer">모든 말 이동·벽 설치와 승패는 서버에 저장됩니다. 테마는 현재 기기에만 적용됩니다.</p>
  </main>;
}
