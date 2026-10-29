import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {RoundPanel} from '../../src/features/room/RoundPanel';
import type {RoomSnapshot} from '../../src/lib/api';
const fixture=():RoomSnapshot=>({
 server_now:'2026-10-28T09:00:00Z',room:{id:'r',code:'123456',status:'open',version:2,host_player_id:'host',game_type:'liar',settings:{word_mode:'builtin',hint_rounds:1,discussion_seconds:60},locked:false,expires_at:'2026-10-28T11:00:00Z'},
 me:{player_id:'host',is_host:true},players:[{id:'guest',nickname:'끊긴참가자',join_order:2,status:'active',wins:0,connected:false}],
 round:{id:'round',phase:'PAUSED_DISCONNECT',version:2,participant_ids:['host','guest'],submitted_count:0,acknowledged_count:2,hint_index:0,hint_round:1,hint_rounds:1,current_player_id:null,deadline_at:null,remaining_ms:null,paused_phase:null,
  me:{submitted:false,acknowledged:true,role:'citizen',word:'숨긴제시어'},disconnect:{original_phase:'APPEAL_VOTE',remaining_ms:15000,grace_until:'2026-10-28T09:00:30Z',missing_ids:['guest']}}
});
const render=(s:RoomSnapshot)=>renderToStaticMarkup(<RoundPanel snapshot={s} busy={false} run={async()=>undefined}/>);
it('freezes controls during grace and never renders the private word by default',()=>{
 const html=render(fixture());expect(html).toContain('끊긴참가자');expect(html).toContain('복귀 유예 30초');expect(html).toContain('게임에 남은 시간 15초');expect(html).not.toContain('숨긴제시어');expect(html).not.toContain('30초 더 기다리기');expect(html).toMatch(/disabled=""[^>]*>현재 판 취소/);
});
it('offers wait/cancel after grace only to the current host',()=>{
 const s=fixture();s.round!.disconnect!.grace_until='2026-10-28T08:59:59Z';expect(render(s)).toContain('30초 더 기다리기');s.me.is_host=false;const guest=render(s);expect(guest).not.toContain('30초 더 기다리기');expect(guest).not.toContain('현재 판 취소');
});
it('keeps mid-round newcomers in the waiting room without current-game controls',()=>{
 const s=fixture();s.round!.me=null;const html=render(s);expect(html).toContain('다음 판을 기다리고 있어요');expect(html).not.toContain('역할 보기');expect(html).not.toContain('끊긴참가자');expect(html).not.toContain('투표');
});
