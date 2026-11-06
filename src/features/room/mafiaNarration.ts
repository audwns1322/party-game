import type { Player, RoomSnapshot } from '../../lib/api';

type Mafia = NonNullable<RoomSnapshot['mafia']>;

/** Public narration only: never include private roles, investigations or targets. */
export function mafiaNarration(mafia: Mafia, players: Player[]): { cue: string; text: string; key: string } {
  const name = (id: string | null | undefined) => players.find(p => p.id === id)?.nickname ?? '참가자';
  const publicElimination = (id: string | null | undefined, team: string | null | undefined) =>
    id ? `${name(id)} 님이 탈락했습니다. 소속 팀은 ${team === 'mafia' ? '마피아팀' : '시민팀'}입니다.` : '이번에는 탈락자가 없습니다.';

  switch (mafia.phase) {
    case 'REVEAL_ROLE': return { key: 'role', cue: '게임 시작 · 직업 확인을 안내할 때', text: '모두 자신의 휴대폰에서 비밀 직업을 확인해 주세요. 확인 후 역할 확인 완료 버튼을 눌러주세요.' };
    case 'INTRO': return { key: 'intro', cue: '첫날 자기소개를 시작할 때', text: '첫날 낮입니다. 돌아가며 간단히 자기소개를 해주세요. 오늘은 투표하지 않고 자기소개 후 첫 번째 밤으로 넘어갑니다.' };
    case 'NIGHT': return { key: `night-${mafia.night_no}`, cue: `${mafia.night_no ?? 1}번째 밤이 시작될 때`, text: `${mafia.night_no ?? 1}번째 밤이 되었습니다. 모두 자신의 휴대폰에서 밤 행동을 확인해 주세요. 다른 사람에게 화면을 보여주지 마세요. 모든 필수 행동이 완료되면 아침이 됩니다.` };
    case 'DAY_DISCUSS': return { key: `discuss-${mafia.night_no}`, cue: '아침이 밝고 토론을 시작할 때', text: `아침이 밝았습니다. ${publicElimination(mafia.night_result?.eliminated_player_id, mafia.night_result?.eliminated_team)} 살아 있는 참가자는 마피아가 누구인지 자유롭게 토론해 주세요.` };
    case 'DAY_VOTE': return { key: `vote-${mafia.day_no}`, cue: '토론을 끝내고 투표를 시작할 때', text: '토론이 끝났습니다. 살아 있는 참가자는 각자 휴대폰에서 마피아로 의심되는 사람을 한 명 선택해 비밀 투표를 제출해 주세요. 제출한 표는 바꿀 수 없습니다.' };
    case 'DAY_RUNOFF': return { key: `runoff-${mafia.day_no}`, cue: '동률로 재투표를 시작할 때', text: '투표 결과가 동률입니다. 동률 후보를 대상으로 마지막 재투표를 진행합니다. 각자 휴대폰에서 투표해 주세요.' };
    case 'DAY_RESULT': return { key: `result-${mafia.day_no}`, cue: '낮 투표 결과를 발표할 때', text: `투표 결과를 발표합니다. ${publicElimination(mafia.day_result?.eliminated_player_id, mafia.day_result?.eliminated_team)} 게임을 이어가겠습니다.` };
    case 'FINAL_RESULT': return { key: 'final', cue: '승리 팀을 발표할 때', text: `게임이 종료되었습니다. ${mafia.winner === 'mafia' ? '마피아팀' : '시민팀'}이 승리했습니다. 이제 모든 참가자의 직업을 확인할 수 있습니다.` };
    case 'PAUSED_DISCONNECT': return { key: 'paused', cue: '연결 끊김으로 게임이 멈췄을 때', text: '참가자의 연결이 끊겨 게임을 잠시 멈췄습니다. 모두 연결 상태를 확인해 주세요. 재접속하면 이어서 진행합니다.' };
  }
}
