import { describe, expect, it } from 'vitest';
import { applyBombAction, secureRandomIndex, settleBomb, startBombRound, type BombState } from '../../src/features/bomb-pass/onlineEngine';
import { BOMB_TOPICS } from '../../src/features/bomb-pass/demoEngine';

const seats=['one','two','three'];
const players=seats.map((id,join_order)=>({id,nickname:`참가자${join_order+1}`,join_order}));
const base:BombState={status:'lobby',answerMode:'text',turnStyle:'random',maxSeconds:45,round:0,
  seats,holderId:null,explodedHolderId:null,explosionId:null,explosionCounts:{},answers:[],topicIndex:0};

describe('bomb pass authoritative engine',()=>{
  it('has enough distinct, playable topics for long party sessions',()=>{
    expect(BOMB_TOPICS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BOMB_TOPICS).size).toBe(BOMB_TOPICS.length);
  });
  it('draws uniform index boundaries from secure integers',()=>{
    expect(secureRandomIndex(3,bytes=>(bytes[0]=0,bytes))).toBe(0);
    expect(secureRandomIndex(3,bytes=>(bytes[0]=2,bytes))).toBe(2);
    expect(()=>secureRandomIndex(0)).toThrow(RangeError);
  });
  it('starts a round only after countdown, never exposing the explosion in state',()=>{
    const started=startBombRound(base,1000);
    expect(started.state.status).toBe('countdown');
    expect(started.state.countdownEndsAt).toBe(new Date(4000).toISOString());
    expect(started.state).not.toHaveProperty('explodeAt');
    const deadline=Date.parse(started.secret.explodeAt!);
    expect(deadline).toBeGreaterThan(4000);
    expect(deadline).toBeLessThanOrEqual(49000);
    expect(settleBomb(started.state,started.secret,3900).changed).toBe(false);
    expect(settleBomb(started.state,started.secret,4000).state.status).toBe('playing');
  });
  it('explodes once at secret deadline, retains participants and waits for host',()=>{
    const started=startBombRound(base,1000);
    const settled=settleBomb(started.state,started.secret,Date.parse(started.secret.explodeAt!));
    expect(settled.state.status).toBe('exploded');
    expect(settled.state.explosionCounts[started.state.holderId!]).toBe(1);
    expect(settleBomb(settled.state,settled.secret,1_000_000).changed).toBe(false);
    expect(()=>applyBombAction(settled.state,settled.secret,'next',{},'two','one',players,50_000)).toThrow('HOST_ONLY');
    expect(applyBombAction(settled.state,settled.secret,'next',{},'one','one',players,50_000).state.status).toBe('countdown');
  });
  it('allows only the holder to submit and rejects duplicates',()=>{
    const active:BombState={...base,status:'playing',holderId:'one'};
    const secret={explodeAt:new Date(50000).toISOString()};
    expect(()=>applyBombAction(active,secret,'pass',{answer:'사과'},'two','one',players,1000)).toThrow('NOT_YOUR_TURN');
    const passed=applyBombAction(active,secret,'pass',{answer:' 사과 '},'one','one',players,1000);
    expect(passed.state.holderId).not.toBe('one');
    expect(passed.state.answers).toEqual([{playerId:'one',answer:'사과'}]);
    expect(()=>applyBombAction({...passed.state,holderId:'two'},secret,'pass',{answer:'사과'},'two','one',players,1000)).toThrow('DUPLICATE_ANSWER');
    expect(()=>applyBombAction(active,secret,'pass',{answer:'사과'},'one','one',players,50000)).toThrow('PHASE_CONFLICT');
  });
});
