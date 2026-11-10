import { hashToken } from '../_shared/security.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
import { applyQuoridorAction, createQuoridorGame, type QuoridorAction, type QuoridorGame } from '../../../src/features/quoridor/engine.ts';

type Participant = { id:string; nickname:string; wins:number };
type Snapshot = { version:number; room_version:number; state:Match; me:string; host:string; players:Participant[]; server_now:string };
type Match = { status:'lobby'|'playing'|'finished'; playerCount:2|4; turnLimit:number; undoEnabled:boolean; scores:Record<string,number>;
  game?:QuoridorGame; seats?:string[]; deadlineAt?:string|null; extended?:boolean; undoUsed?:Record<string,boolean>;
  previous?:{before:QuoridorGame; actor:string}|null; matchNumber?:number };
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const response=(status:number,data:unknown)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const known:Record<string,number>={FORBIDDEN:403,ROOM_CLOSED:410,ROOM_LOCKED:409,VERSION_CONFLICT:409,INVALID_MOVE:400,INVALID_WALL:400,NOT_YOUR_TURN:403,HOST_ONLY:403,PLAYER_COUNT:409,INVALID_SETTINGS:400,GAME_FINISHED:409,INVALID_REQUEST:400,UNKNOWN_ACTION:400,UNDO_UNAVAILABLE:409};
const deadline=(seconds:number)=>seconds?new Date(Date.now()+seconds*1000).toISOString():null;

function expire(state:Match, now:number):Match {
  if(state.status!=='playing'||!state.game||!state.turnLimit||!state.deadlineAt) return state;
  let current=state;
  for(let i=0;i<8 && current.status==='playing' && current.game && current.deadlineAt && Date.parse(current.deadlineAt)<=now;i++) {
    const old=Date.parse(current.deadlineAt);
    if(!current.extended) current={...current,extended:true,deadlineAt:new Date(old+current.turnLimit*1000).toISOString(),previous:null};
    else {
      const game=applyQuoridorAction(current.game,{type:'skip'});
      current={...current,game,extended:false,deadlineAt:new Date(old+current.turnLimit*1000).toISOString(),previous:null};
    }
  }
  // If the browser was suspended for many minutes, resume a fair fresh turn.
  if(current.deadlineAt && Date.parse(current.deadlineAt)<=now) current={...current,deadlineAt:deadline(current.turnLimit),extended:false,previous:null};
  return current;
}

function change(state:Match,action:string,payload:Record<string,unknown>,snapshot:Snapshot):Match {
  if(action==='settings') {
    if(snapshot.me!==snapshot.host) throw Error('HOST_ONLY');
    if(state.status==='playing') throw Error('ROOM_LOCKED');
    const count=payload.playerCount, limit=payload.turnLimit, undo=payload.undoEnabled;
    if((count!==2&&count!==4)||typeof limit!=='number'||(limit!==0&&(limit<5||limit>60||limit%5!==0))||typeof undo!=='boolean') throw Error('INVALID_SETTINGS');
    return {...state,playerCount:count,turnLimit:limit,undoEnabled:undo};
  }
  if(action==='start') {
    if(snapshot.me!==snapshot.host) throw Error('HOST_ONLY');
    if(state.status==='playing') throw Error('ROOM_LOCKED');
    if(snapshot.players.length!==state.playerCount) throw Error('PLAYER_COUNT');
    const seats=snapshot.players.map(p=>p.id);
    return {...state,status:'playing',seats,game:createQuoridorGame(state.playerCount),undoUsed:{},previous:null,
      extended:false,deadlineAt:deadline(state.turnLimit),matchNumber:(state.matchNumber??0)+1};
  }
  if(action==='rematch') {
    if(snapshot.me!==snapshot.host) throw Error('HOST_ONLY');
    if(state.status==='playing') throw Error('ROOM_LOCKED');
    return {...state,status:'lobby',game:undefined,seats:undefined,deadlineAt:null,previous:null,extended:false};
  }
  if(state.status!=='playing'||!state.game||!state.seats) throw Error('GAME_FINISHED');
  if(action==='undo') {
    const prior=state.previous;
    if(!state.undoEnabled||!prior||prior.actor!==snapshot.me||state.undoUsed?.[snapshot.me]) throw Error('UNDO_UNAVAILABLE');
    return {...state,game:prior.before,previous:null,undoUsed:{...state.undoUsed,[snapshot.me]:true},deadlineAt:deadline(state.turnLimit),extended:false};
  }
  if(action!=='move'&&action!=='wall') throw Error('UNKNOWN_ACTION');
  if(state.seats[state.game.currentPlayer]!==snapshot.me) throw Error('NOT_YOUR_TURN');
  const gameAction:QuoridorAction= action==='move'
    ? {type:'move',to:payload.to as [number,number]}
    : {type:'wall',wall:payload.wall as {r:number;c:number;vertical:boolean}};
  // Reject malformed inputs before invoking the rules engine.
  if(action==='move'&&(!Array.isArray(payload.to)||payload.to.length!==2||!payload.to.every(Number.isInteger))) throw Error('INVALID_MOVE');
  if(action==='wall'&&(!payload.wall||typeof payload.wall!=='object'||Array.isArray(payload.wall)||!
    Number.isInteger((payload.wall as {r:number}).r)||!Number.isInteger((payload.wall as {c:number}).c)||typeof (payload.wall as {vertical:boolean}).vertical!=='boolean')) throw Error('INVALID_WALL');
  const next=applyQuoridorAction(state.game,gameAction);
  const scores={...state.scores};
  if(next.winner!==null) scores[state.seats[next.winner]]=(scores[state.seats[next.winner]]??0)+1;
  return {...state,status:next.winner!==null?'finished':'playing',game:next,scores,
    previous:state.undoEnabled?{before:state.game,actor:snapshot.me}:null,
    extended:false,deadlineAt:next.winner===null?deadline(state.turnLimit):null};
}

serve(async request=>{
  try {
    if(request.method!=='POST') throw Error('INVALID_REQUEST');
    const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!token) throw Error('FORBIDDEN');
    const raw=await request.text();
    if(raw.length>4096) throw Error('INVALID_REQUEST');
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object'||!UUID.test(body.room_id)||typeof body.action!=='string') throw Error('INVALID_REQUEST');
    const actorHash=await hashToken(token);
    for(let attempt=0;attempt<3;attempt++) {
      const snap=await rpc('quoridor_get',{p_credential_hash:actorHash,p_room:body.room_id}) as Snapshot;
      const current=expire(snap.state,Date.parse(snap.server_now));
      const timed=JSON.stringify(current)!==JSON.stringify(snap.state);
      const next=body.action==='snapshot'?current:change(current,body.action,body.payload??{},snap);
      if(!timed&&body.action==='snapshot') return response(200,{...snap,state:next});
      if(!timed&&body.action!=='snapshot' && Number(body.expected_version)!==snap.version) throw Error('VERSION_CONFLICT');
      try {
        const committed=await rpc('quoridor_commit',{p_credential_hash:actorHash,p_room:body.room_id,p_expected_version:snap.version,p_state:next}) as {version:number;room_version:number};
        await broadcast(body.room_id,committed.room_version).catch(()=>undefined);
        return response(200,{...snap,version:committed.version,room_version:committed.room_version,state:next});
      } catch(error) {
        if(error instanceof Error&&error.message==='VERSION_CONFLICT'&&body.action==='snapshot') continue;
        throw error;
      }
    }
    throw Error('VERSION_CONFLICT');
  } catch(error) {
    const code=error instanceof Error?error.message:'INVALID_REQUEST';
    const safe=code in known?code:'TEMPORARILY_UNAVAILABLE';
    return response(known[safe]??503,{error:safe});
  }
},'POST, OPTIONS');
