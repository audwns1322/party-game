import { expect,it } from 'vitest';
import { mafiaNarration } from '../../src/features/room/mafiaNarration';
import type { Player, RoomSnapshot } from '../../src/lib/api';

type Mafia=NonNullable<RoomSnapshot['mafia']>;
const make=(phase:Mafia['phase'],rest:Partial<Mafia>={}):Mafia=>({id:'round',phase,participant_ids:[],acknowledged_count:0,me:null,...rest});
const players=[{id:'player1',nickname:'참가자1'},{id:'player2',nickname:'참가자2'}] as Player[];

it('shows the exact cue for each narrator button and keeps night messages role-neutral',()=>{
  for (const phase of ['REVEAL_ROLE','INTRO','NIGHT','DAY_DISCUSS','DAY_VOTE','DAY_RUNOFF','DAY_RESULT','FINAL_RESULT','PAUSED_DISCONNECT'] as const){
    const narration=mafiaNarration(make(phase),players);
    expect(narration.cue.length).toBeGreaterThan(4);
    expect(narration.text.length).toBeGreaterThan(15);
  }
  const night=mafiaNarration(make('NIGHT',{night_no:1}),players);
  expect(night.cue).toContain('1번째 밤');
  expect(night.text).not.toMatch(/경찰|의사|스파이|기자|마피아의 표적/);
});

it('narrates only publicly revealed elimination team and winner',()=>{
  const day=mafiaNarration(make('DAY_DISCUSS',{night_result:{eliminated_player_id:'player1',eliminated_team:'citizen',journalist:null}}),players);
  expect(day.text).toContain('참가자1 님이 탈락');
  expect(day.text).toContain('시민팀');
  expect(day.text).not.toContain('경찰');
  expect(mafiaNarration(make('FINAL_RESULT',{winner:'mafia'}),players).text).toContain('마피아팀이 승리');
});
