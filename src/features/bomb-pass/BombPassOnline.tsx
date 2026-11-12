import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api, messageFor, type Player, type RoomSnapshot } from '../../lib/api';
import { clearSession, type StoredSession } from '../../lib/session';
import { navigate } from '../../lib/router';
import { playBombExplosion, playBombTurn } from './bombAudio';
import { BOMB_TOPICS } from './demoEngine';
import type { BombPlayer, BombState } from './onlineEngine';
import './bomb-pass.css';

type Data = {version:number;room_version:number;state:BombState;me:string;host:string;players:BombPlayer[];server_now:string};
type Props = {session:StoredSession;room:RoomSnapshot['room'];me:RoomSnapshot['me'];players:Player[];online:boolean;run:(action:string,payload?:object)=>Promise<void>};
const MAX_OPTIONS=[15,30,45,60,90,120,180];
const duration=(value:number)=>value<60?`${value}초`:`${Math.floor(value/60)}분${value%60?` ${value%60}초`:''}`;

export function BombPassOnline({session,room,me,online,run}:Props) {
  const [data,setData]=useState<Data|null>(null);
  const [draft,setDraft]=useState<{maxSeconds:number;answerMode:'voice'|'text';turnStyle:'pass'|'random'}|null>(null);
  const [answer,setAnswer]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  const [qr,setQr]=useState('');
  const [confirmStop,setConfirmStop]=useState(false);
  const [confirmExit,setConfirmExit]=useState(false);
  const [haptics,setHaptics]=useState(true);
  const [soundEnabled,setSoundEnabled]=useState(true);
  const [audioReady,setAudioReady]=useState(false);
  const [clock,setClock]=useState(Date.now());
  const [serverOffset,setServerOffset]=useState(0);
  const audio=useRef<AudioContext|null>(null);
  const seenExplosion=useRef<string|null|undefined>(undefined);
  const seenTurn=useRef(false);
  const requestBusy=useRef(false);
  const invite=`${location.origin}/room/${room.code}`;

  const refresh=useCallback(async()=>{
    const fresh=await api.bomb<Data>(session,'snapshot');
    setServerOffset(Date.parse(fresh.server_now)-Date.now());
    setData(previous=>!previous||fresh.version>=previous.version?fresh:previous);
  },[session]);

  useEffect(()=>{void refresh().catch(e=>setError(messageFor(e)));},[refresh,room.version]);
  useEffect(()=>{
    const fast=data?.state.status==='playing'||data?.state.status==='countdown';
    let pending=false;
    const poll=async()=>{if(pending||document.visibilityState!=='visible')return;pending=true;try{await refresh();}catch{/* common room heartbeat reports connection errors */}finally{pending=false;}};
    const timer=setInterval(()=>void poll(),fast?650:2200);
    const tick=setInterval(()=>setClock(Date.now()),200);
    const wake=()=>{if(document.visibilityState==='visible')void refresh().catch(()=>undefined);};
    document.addEventListener('visibilitychange',wake);
    return ()=>{clearInterval(timer);clearInterval(tick);document.removeEventListener('visibilitychange',wake);};
  },[refresh,data?.state.status]);
  useEffect(()=>{
    if(data?.state.status==='lobby')setDraft(old=>old??{maxSeconds:data.state.maxSeconds,answerMode:data.state.answerMode,turnStyle:data.state.turnStyle});
    else setDraft(null);
  },[data?.state.status,data?.state.maxSeconds,data?.state.answerMode,data?.state.turnStyle]);
  useEffect(()=>{
    const current=data?.state.explosionId??null;
    if(seenExplosion.current===undefined){if(data)seenExplosion.current=current;return;}
    if(current!==seenExplosion.current){
      if(current){
        if(soundEnabled&&audioReady&&audio.current)playBombExplosion(audio.current);
        if(haptics&&typeof navigator.vibrate==='function')navigator.vibrate([160,80,220]);
      }
      seenExplosion.current=current;
    }
  },[data?.state.explosionId,soundEnabled,audioReady,haptics,data]);
  const isMyTurn=data?.state.status==='playing'&&data.state.holderId===me.player_id;
  useEffect(()=>{
    if(isMyTurn&&!seenTurn.current){
      if(haptics&&typeof navigator.vibrate==='function')navigator.vibrate([90,45,90]);
      if(soundEnabled&&audioReady&&audio.current)playBombTurn(audio.current);
    }
    seenTurn.current=Boolean(isMyTurn);
  },[isMyTurn,haptics,soundEnabled,audioReady]);
  useEffect(()=>{void QRCode.toDataURL(invite,{margin:1,width:210}).then(setQr).catch(()=>undefined);},[invite]);
  useEffect(()=>()=>{const context=audio.current;audio.current=null;void context?.close();},[]);

  function unlockSound(){
    if(typeof AudioContext==='undefined'){
      setSoundEnabled(false);setError('이 브라우저는 효과음 재생을 지원하지 않아요.');return;
    }
    if(!audio.current)audio.current=new AudioContext();
    void audio.current.resume().then(()=>setAudioReady(true)).catch(()=>{
      setAudioReady(false);setError('효과음을 켤 수 없어요. 소리 버튼을 다시 눌러 주세요.');
    });
  }
  async function command(action:string,payload:object={}){
    if(!data||requestBusy.current)return;
    requestBusy.current=true;setBusy(true);setError('');
    try{
      if(soundEnabled)unlockSound();
      let version=data.version;
      if(action==='start'&&draft&&(draft.maxSeconds!==data.state.maxSeconds||draft.answerMode!==data.state.answerMode||draft.turnStyle!==data.state.turnStyle)){
        const saved=await api.bomb<Data>(session,'settings',version,draft);
        setData(previous=>!previous||saved.version>=previous.version?saved:previous);
        version=saved.version;
      }
      const next=await api.bomb<Data>(session,action,version,payload);
      setData(previous=>!previous||next.version>=previous.version?next:previous);setServerOffset(Date.parse(next.server_now)-Date.now());
      setAnswer('');setConfirmStop(false);
    }catch(e){setError(messageFor(e));void refresh().catch(()=>undefined);}
    finally{requestBusy.current=false;setBusy(false);}
  }
  async function exitRoom(){
    if(requestBusy.current)return;
    if(!isHost&&activeRound){navigate('/');return;}
    requestBusy.current=true;setBusy(true);setError('');
    try{
      if(isHost&&data&&['countdown','playing','exploded'].includes(data.state.status)){
        // Closing a room is already authoritative; no separate finish command can race its deadline.
        await run('close_room');
      }else await run(isHost?'close_room':'leave');
      clearSession(session.code);navigate('/');
    }catch(e){setError(messageFor(e));void refresh().catch(()=>undefined);}
    finally{requestBusy.current=false;setBusy(false);}
  }
  function sendAnswer(event?:FormEvent){event?.preventDefault();void command('pass',data?.state.answerMode==='text'?{answer}:{});}
  async function share(){
    try{if(navigator.share)await navigator.share({title:'폭탄 돌리기 초대',text:`방 코드 ${room.code}`,url:invite});
      else{await navigator.clipboard.writeText(invite);setCopied(true);}}
    catch{setError('링크를 공유하지 못했어요. 방 코드를 알려주세요.');}
  }
  const state=data?.state;
  const participants=data?.players??[];
  const name=(id:string|null|undefined)=>participants.find(p=>p.id===id)?.nickname??'참가자';
  const isHost=me.is_host;
  const myTurn=isMyTurn;
  const settingsDirty=Boolean(draft&&state&&(draft.maxSeconds!==state.maxSeconds||draft.answerMode!==state.answerMode||draft.turnStyle!==state.turnStyle));
  const activeRound=Boolean(state&&['countdown','playing','exploded'].includes(state.status));
  const countdown=state?.countdownEndsAt?Math.max(0,Math.ceil((Date.parse(state.countdownEndsAt)-clock-serverOffset)/1000)):0;
  const explosions=Object.values(state?.explosionCounts??{}).reduce((sum,n)=>sum+n,0);

  return <main className={`bomb-pass-preview bp-online${myTurn?' bp-your-turn':''}${state?.status==='exploded'?' bp-online-exploded':''}`}>
    <div className="bp-shell">
      <header className="bp-header"><button type="button" className="bp-back" onClick={()=>setConfirmExit(true)}>← PARTY GAME</button><span className="bp-preview-tag">● ONLINE LIVE</span></header>
      <div className="bp-title-area"><div className="bp-eyebrow">DON'T HOLD IT · PASS IT!</div><h1>폭탄 <em>돌리기</em><span>💣</span></h1><p>누가 걸릴지는 몰라. 살아남는 건 순발력!</p></div>
      {!online&&<p className="bp-online-warning" role="status">네트워크 연결을 다시 확인하는 중이에요.</p>}
      {error&&<p role="alert" className="bp-online-warning">{error}</p>}
      {!data&&<p role="status" className="bp-online-warning">방 정보를 불러오는 중…</p>}
      {state&&<div className="bp-layout">
        <section className="bp-main-card">
          <div className="bp-stage-top"><span className="bp-overline">{state.status==='lobby'?'GAME LOBBY':`ROUND ${String(state.round).padStart(2,'0')}`}</span><button type="button" className="bp-sound" aria-pressed={soundEnabled&&audioReady} onClick={()=>{
            if(!audioReady){setSoundEnabled(true);unlockSound();}else setSoundEnabled(v=>!v);
          }}>{!audioReady?'🔊 효과음 켜기':soundEnabled?'🔊 소리 켜짐':'🔇 음소거'}</button></div>
          {myTurn&&<div className="bp-turn-banner" role="alert">⚡ 지금 내 차례! 빨리 답하고 넘겨!</div>}
          <div className={`bp-stage bp-${state.status==='lobby'?'ready':state.status}`} key={state.status==='exploded'?state.explosionId??'exploded':'live'}>
            <div className="bp-stage-glow" aria-hidden="true"/>
            {state.status==='exploded'?<div className="bp-explosion" aria-hidden="true"><strong>BOOM!</strong><span>💥</span></div>:<div className="bp-bomb-wrap" aria-hidden="true"><div className="bp-fuse"><i/></div><div className="bp-bomb"><span className="bp-bomb-shine"/><span className="bp-bomb-symbol">!</span></div><span className="bp-bomb-shadow"/></div>}
            <div className="bp-stage-copy" role="status" aria-live="polite">
              {state.status==='lobby'&&<><strong>친구들을 초대해!</strong><span>3명 이상 모이면 시작할 수 있어.</span></>}
              {state.status==='countdown'&&<><strong className="bp-countdown">{countdown>0?countdown:'START!'}</strong><span>{name(state.holderId)}님부터 시작!</span></>}
              {state.status==='playing'&&<><strong>{myTurn?'🚨 내 차례!':`🎯 ${name(state.holderId)}님 차례!`}</strong><span>{myTurn?'빨리 답해! 이미 폭탄이 움직이고 있어.':'누가 다음으로 지목될지 몰라!'}</span></>}
              {state.status==='exploded'&&<><strong>{name(state.explodedHolderId)}님 당첨!</strong><span>다음 게임은 방장이 시작해요.</span></>}
              {state.status==='finished'&&<><strong>오늘의 폭탄 파티 종료!</strong><span>원하면 같은 방에서 다시 시작할 수 있어.</span></>}
            </div>
          </div>
          {state.status!=='lobby'&&state.status!=='finished'&&<div className="bp-topic"><span>이번 주제</span><strong>{BOMB_TOPICS[state.topicIndex]}</strong><small>폭발 시각은 비밀 · 최대 {duration(state.maxSeconds)}</small></div>}
          {state.status==='lobby'&&<div className="bp-controls">
            <section className="bp-howto"><div className="bp-howto-heading"><span>⚡ 10초 룰 설명</span><h2>답하고, 넘기고, BOOM!</h2></div><p className="bp-style-description">주제를 보고 빠르게 대답해. 랜덤 지목 모드에서는 다음 차례가 예고 없이 찾아와!</p></section>
            {isHost&&draft&&<div className="bp-online-settings">
              <label>진행 방식<select value={draft.turnStyle} onChange={e=>setDraft({...draft,turnStyle:e.target.value as 'pass'|'random'})}><option value="pass">순서대로 돌리기</option><option value="random">🎲 랜덤 지목</option></select></label>
              <label>답변 방식<select value={draft.answerMode} onChange={e=>setDraft({...draft,answerMode:e.target.value as 'voice'|'text'})}><option value="voice">🎙️ 말하기 + 버튼</option><option value="text">⌨️ 텍스트 입력</option></select></label>
              <label>최대 폭발 시간<select value={draft.maxSeconds} onChange={e=>setDraft({...draft,maxSeconds:Number(e.target.value)})}>{MAX_OPTIONS.map(n=><option key={n} value={n}>{duration(n)}</option>)}</select></label>
              <button type="button" disabled={busy||!settingsDirty} onClick={()=>void command('settings',draft)}>{settingsDirty?'설정 저장':'✓ 설정 저장됨'}</button>
            </div>}
            <p className="bp-online-summary">{state.turnStyle==='random'?'🎲 랜덤 지목':'➡️ 순서대로'} · {state.answerMode==='text'?'⌨️ 텍스트':'🎙️ 말하기'} · 최대 {duration(state.maxSeconds)}</p>
            {!audioReady&&<p className="bp-online-summary">🔊 폭탄 소리를 들으려면 위의 ‘효과음 켜기’를 한 번 눌러 주세요.</p>}
            {isHost?<button type="button" className="bp-main-button" disabled={busy||participants.length<3||participants.length>15} onClick={()=>void command('start')}>{participants.length<3?'3명 이상 모여야 시작 가능':settingsDirty?'설정 저장하고 게임 시작 →':'게임 시작하기 →'}</button>:<p className="bp-online-summary">방장이 게임을 시작할 때까지 기다려 주세요.</p>}
          </div>}
          {state.status==='playing'&&<div className="bp-actions">{myTurn?state.answerMode==='text'?<form onSubmit={sendAnswer}><label htmlFor="bp-online-answer">답변 입력</label><input id="bp-online-answer" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="예: 사과" maxLength={30} autoComplete="off" enterKeyHint="send"/><button className="bp-main-button" disabled={busy||!answer.trim()}>답변하고 다음 사람 지목 →</button></form>:<><p>답을 크게 말한 뒤 버튼을 눌러!</p><button type="button" className="bp-main-button" disabled={busy} onClick={()=>sendAnswer()}>{state.turnStyle==='random'?'🎲 다음 사람 지목!':'💣 폭탄 넘기기!'}</button></>:<p>다음 차례에 대비해! 답변할 사람의 휴대폰에서만 버튼이 활성화돼.</p>}<p className="bp-feedback">남은 폭발 시간은 아무도 알 수 없어요.</p></div>}
          {state.status==='exploded'&&<div className="bp-between-rounds"><h2>한 판 더 할까요?</h2><p>모두 준비되면 방장이 다음 라운드를 시작해요.</p><div className="bp-result-mini"><span>💥 {name(state.explodedHolderId)}님의 누적 폭발</span><strong>{state.explosionCounts[state.explodedHolderId??'']??0}회</strong></div>{isHost?<button type="button" className="bp-main-button" disabled={busy} onClick={()=>void command('next')}>▶ 다음 라운드 시작</button>:<p>방장을 기다려 주세요.</p>}</div>}
          {state.status==='finished'&&<div className="bp-final-summary"><div><span>진행 라운드</span><strong>{state.round}</strong></div><div><span>총 폭발</span><strong>{explosions}회</strong></div>{isHost&&<button type="button" className="bp-main-button" disabled={busy} onClick={()=>void command('restart')}>같은 방에서 다시 시작 →</button>}</div>}
        </section>
        <aside className="bp-aside">
          <section className="bp-side-panel"><div className="bp-panel-title"><span>PLAYERS</span><b>{participants.length}/15명</b></div><div className="bp-players">{participants.map(player=><div key={player.id} className={`bp-player${state.holderId===player.id&&state.status==='playing'?' holding':''}`}><span className="bp-avatar">{player.nickname.slice(0,1)}</span><span className="bp-player-name">{player.nickname}{player.id===me.player_id?<small>나</small>:null}{player.id===room.host_player_id?<small>방장</small>:null}</span><span className="bp-player-stat">💥 {state.explosionCounts[player.id]??0}</span></div>)}</div>
            {isHost&&['countdown','playing','exploded'].includes(state.status)&&<><button type="button" className="bp-end" onClick={()=>setConfirmStop(v=>!v)}>{confirmStop?'종료 취소':'■ 게임 종료하기'}</button>{confirmStop&&<button type="button" className="bp-end bp-end-confirm" disabled={busy} onClick={()=>void command('finish')}>정말 게임 종료</button>}</>}
            <button type="button" className="bp-end" onClick={()=>void share()}>{copied?'초대 링크 복사 완료':'🔗 초대 링크 공유'}</button><p className="bp-room-code">방 코드 <strong>{room.code}</strong></p>{qr&&<img className="bp-qr" src={qr} alt="폭탄 돌리기 방 초대 QR"/>}
          </section>
          {state.answerMode==='text'&&state.answers.length>0&&<section className="bp-side-panel bp-answer-history"><span>이번 라운드에 나온 답</span><ol>{state.answers.slice(-8).map((entry,index)=><li key={`${index}-${entry.playerId}`}><strong>{name(entry.playerId)}</strong><span>{entry.answer}</span></li>)}</ol></section>}
          <section className="bp-side-panel bp-tip-panel"><span>✦ PARTY TIPS</span><p>목숨도 탈락도 없어. 폭탄을 맞아도 다음 라운드에 다시 참여해!</p></section>
        </aside>
      </div>}
      <div className="bp-room-options"><button type="button" className="bp-end" aria-pressed={haptics} onClick={()=>setHaptics(v=>!v)}>{haptics?'진동 켜짐':'진동 꺼짐'}</button><button type="button" className="bp-end" disabled={busy} onClick={()=>setConfirmExit(true)}>{isHost?'방 종료하기':activeRound?'홈으로 (참가 유지)':'방 나가기'}</button></div>
      {confirmExit&&<div className="bp-modal-backdrop" role="presentation"><section className="bp-modal" role="dialog" aria-modal="true" aria-labelledby="bp-exit-title"><h2 id="bp-exit-title">{isHost?'방을 종료할까요?':'방에서 나갈까요?'}</h2><p>{isHost?(activeRound?'진행 중인 게임을 끝내고 모든 참가자의 방을 닫아요.':'모든 참가자의 방을 닫아요.'):activeRound?'진행 중인 라운드에서는 참가 정보를 유지해요. 홈에서 같은 방에 다시 들어올 수 있어요.':'방에서 나가면 현재 참가 정보가 삭제돼요.'}</p><div><button type="button" disabled={busy} onClick={()=>setConfirmExit(false)}>취소</button><button type="button" className="bp-confirm" disabled={busy} onClick={()=>void exitRoom()}>{isHost?'방 종료':'나가기'}</button></div></section></div>}
      <p className="bp-disclaimer">폭발 시각·턴 변경은 서버에서 확정합니다. 브라우저 절전/네트워크 문제 시 화면 반영이 늦을 수 있으며, 다시 접속하면 현재 게임 상태로 동기화됩니다.</p>
    </div>
  </main>;
}
