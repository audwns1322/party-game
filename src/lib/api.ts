// Browser API client for the room Edge Functions. Credentials go in headers only.
export type Session = { room_id: string; code: string; player_id: string; token: string };
export type Issued = Session & { recovery_code: string };
export type GameType = 'liar' | 'mafia' | 'quoridor' | 'bomb-pass';
export const MAFIA_ROLES = ['mafia', 'spy', 'citizen', 'police', 'doctor', 'journalist', 'traitor'] as const;
export type MafiaRole = typeof MAFIA_ROLES[number];
export type MafiaRoles = Record<MafiaRole, number>;
export const THEMES = ['음식','동물','생활용품','장소','취미','자연','운동','크로스핏','여행'] as const;
export type Settings = {
  language?: 'ko' | 'en';
  word_mode: 'builtin' | 'custom'; hint_rounds: 1 | 2 | 3; discussion_seconds: 0 | 60 | 120 | 180 | 300;
  theme?: 'random' | typeof THEMES[number]; custom_theme?: string;
  game_mode?: 'classic' | 'confusion'; difficulty?: 'easy' | 'hard'; liar_count?: 1 | 2;
  mafia_roles?: MafiaRoles;
};
export type Player = { id: string; nickname: string; join_order: number; status: string; wins: number; connected: boolean };
export type GamePhase = 'LOBBY' | 'COLLECT_WORDS' | 'REVEAL_ROLE' | 'HINT' | 'DISCUSS' | 'PAUSED_HOST' | 'PAUSED_DISCONNECT' | 'VOTE_1' | 'VOTE_RUNOFF' | 'REVEAL_VOTE' | 'REVEAL_LIAR' | 'GUESS' | 'APPEAL_WINDOW' | 'APPEAL_VOTE' | 'FINAL_RESULT';
export type RoundSnapshot = {
  id: string; phase: Exclude<GamePhase,'LOBBY'>; version: number; participant_ids: string[];
  submitted_count: number; acknowledged_count: number;
  liar_count?: 1 | 2;
  language?: 'ko' | 'en'; away_ids?: string[]; hint_pending_ids?: string[];
  theme?: string; game_mode?: 'classic' | 'confusion'; difficulty?: 'easy' | 'hard';
  hint_index: number; hint_round: number; hint_rounds: number; current_player_id: string | null;
  deadline_at: string | null; remaining_ms: number | null; paused_phase: 'HINT' | 'DISCUSS' | null;
  me: { submitted: boolean; acknowledged: boolean; role: 'citizen' | 'liar' | null; word: string | null; voted?: boolean; eliminated?: boolean } | null;
  eliminated_ids?: string[];
  disconnect?: {original_phase:GamePhase; remaining_ms:number|null; grace_until:string; missing_ids:string[]} | null;
  vote?: {
    ballot_no: number; cycle_no?: number; candidate_ids: string[]; submitted_count: number;
    tallies: {ballot_no:number; counts:{player_id:string; votes:number}[]}[];
    selected_player_id: string | null; outcome: 'DRAW' | null;
  };
  m5?: {
    selected_player_id: string | null; selected_role: 'citizen' | 'liar' | null;
    guess_id: string | null; answer: string | null; provisional_correct: boolean | null; resolved_correct: boolean | null;
    citizen_count: number; appeal_submitted_count: number; my_appeal_voted: boolean;
    winner: 'citizen' | 'liar' | 'DRAW' | null; reason: string | null; correct_word: string | null; liar_ids: string[] | null;
  };
};
export type RoomSnapshot = {
  server_now?: string;
  room: { id: string; code: string; status: string; version: number; host_player_id: string; game_type: GameType; settings: Settings; locked: boolean; expires_at: string };
  me: { player_id: string; is_host: boolean };
  players: Player[];
  round?: RoundSnapshot | null;
  mafia?: { id:string; phase:'REVEAL_ROLE'|'INTRO'|'NIGHT'|'DAY_DISCUSS'|'DAY_VOTE'|'DAY_RUNOFF'|'DAY_RESULT'|'FINAL_RESULT'|'PAUSED_DISCONNECT'; participant_ids:string[]; acknowledged_count:number;
    disconnect?:{original_phase:string;grace_until:string;missing_ids:string[]}|null;
    night_no?:number;alive_ids?:string[];night_expected_count?:number;night_submitted_count?:number;
    night_result?:{eliminated_player_id:string|null;eliminated_team:'mafia'|'citizen'|null;journalist:{player_id:string;role:MafiaRole}|null}|null;
    day_no?:number;day_result?:{eliminated_player_id?:string|null;eliminated_team?:'mafia'|'citizen'|null;runoff_ids?:string[];runoff?:boolean}|null;
    vote_submitted_count?:number;
    final_roles?:{player_id:string;role:MafiaRole;original_role:MafiaRole}[]|null;
    winner?:'mafia'|'citizen'|null;
    me:{role:MafiaRole;original_role?:MafiaRole;acknowledged:boolean;teammate_ids:string[];alive?:boolean;
      mission_target_id?:string|null;night_submitted?:boolean;day_voted?:boolean;journalist_used?:boolean;
      investigation?:{target_id:string;result:MafiaRole|'not_mafia'}|null} | null } | null;
};
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const apiConfigured = Boolean(baseUrl && publicKey);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiConfigured) throw new ApiError('NOT_CONFIGURED', 0);
  let response: Response;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    response = await fetch(new URL(`/functions/v1/${path}`, baseUrl), { ...init, signal:init.signal??controller.signal, cache: 'no-store', headers: { apikey: publicKey!, ...init.headers } });
  } catch { throw new ApiError('NETWORK', 0); } finally { clearTimeout(timeout); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'TEMPORARILY_UNAVAILABLE', response.status);
  return data as T;
}
const json = (body: object, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

export const api = {
  create: (nickname: string, game_type: GameType = 'liar') => call<Issued>('room-create', json({ nickname, game_type })),
  join: (room_code: string, nickname: string) => call<Issued>('room-join', json({ room_code, nickname })),
  recover: (room_code: string, recovery_code: string) => call<Issued>('player-recover', json({ room_code, recovery_code })),
  snapshot: (s: Session) => call<RoomSnapshot>(`room-snapshot?room_id=${encodeURIComponent(s.room_id)}`, { headers: { Authorization: `Bearer ${s.token}` } }),
  command: (s: Session, action: string, expected_version?: number, payload?: object) =>
    call<{ version: number }>('room-command', json({ room_id: s.room_id, action, payload, expected_version, request_id: crypto.randomUUID() }, s.token)),
  game: (s: Session, body: { action: string; payload: object; expected_version: number; expected_phase: GamePhase; request_id: string }) =>
    call<{ version: number }>('game-command', json({ room_id: s.room_id, ...body }, s.token)),
  quoridor: <T>(s: Session, action: string, expected_version?: number, payload: object = {}) =>
    call<T>('quoridor-command', json({ room_id: s.room_id, action, expected_version, payload }, s.token)),
  bomb: <T>(s: Session, action: string, expected_version?: number, payload: object = {}, request_id?: string) =>
    call<T>('bomb-command', json({ room_id: s.room_id, action, expected_version, payload,
      ...(action === 'snapshot' ? {} : { request_id:request_id ?? crypto.randomUUID() }) }, s.token)),
};

const MESSAGES: Record<string, string> = {
  INVALID_NICKNAME: '닉네임은 2~16자, 보이는 글자로만 입력해 주세요. 다른 문자와 섞인 외국 문자는 쓸 수 없어요.',
  INVALID_CODE: '방 코드는 숫자 6자리예요.',
  ROOM_NOT_FOUND: '방을 찾을 수 없어요. 코드를 확인하거나, 이미 종료된 방일 수 있어요.',
  ROOM_LOCKED: '방장이 입장을 잠갔어요. 방장에게 잠금 해제를 부탁해 주세요.',
  PLAYER_NOT_FOUND: '이미 나간 참가자예요.',
  ROOM_FULL: '방이 가득 찼어요. (최대 15명)',
  NICKNAME_TAKEN: '이미 있거나 너무 비슷한 닉네임이에요.',
  RECOVERY_FAILED: '복구 코드가 맞지 않아요.',
  HOST_ONLY: '방장만 할 수 있어요.',
  NOT_YOUR_TURN: '현재 차례인 참가자만 답변하거나 폭탄을 넘길 수 있어요.',
  DISCUSSION_NOT_OVER: '토론 시간이 아직 남아 있어요.',
  DISCUSSION_OVER: '토론 시간이 끝났어요. 최신 상태를 확인해 주세요.',
  VERSION_CONFLICT: '방 상태가 바뀌었어요. 다시 시도해 주세요.',
  PHASE_CONFLICT: '게임 단계가 바뀌었어요. 최신 화면에서 다시 시도해 주세요.',
  REQUEST_CONFLICT: '요청 내용이 달라졌어요. 최신 상태를 확인해 주세요.',
  PLAYER_COUNT: '게임은 3~15명일 때 시작할 수 있어요.',
  INVALID_MOVE: '선택한 칸으로 이동할 수 없어요.',
  INVALID_ANSWER: '빈 답이나 지나치게 긴 답은 제출할 수 없어요. 30자 이내로 입력해 주세요.',
  DUPLICATE_ANSWER: '이번 라운드에 이미 나온 답이에요. 다른 답을 입력해 주세요.',
  ANSWER_LIMIT: '이번 라운드의 답변이 너무 많아요. 잠시 기다려 주세요.',
  INVALID_WALL: '선택한 위치에 벽을 놓을 수 없어요.',
  UNDO_UNAVAILABLE: '지금은 무르기를 사용할 수 없어요.',
  PLAYERS_OFFLINE: '자리 비움인 참가자가 있어요. 모두 돌아온 후 시작해 주세요.',
  ROUND_ACTIVE: '현재 판을 먼저 취소해 주세요.',
  ROUND_PAUSED: '참가자의 재접속을 기다리며 잠시 멈췄어요.',
  RECONNECT_GRACE: '30초 복귀 유예가 끝난 뒤 기다림 또는 판 취소를 선택할 수 있어요.',
  NOT_ROUND_PLAYER: '이번 판은 관전할 수 없어요. 다음 판을 기다려 주세요.',
  INVALID_WORD: '공백을 제외한 2~30자의 단어를 입력해 주세요.',
  INVALID_SETTINGS: '테마와 게임 설정을 확인해 주세요. 직접 입력은 테마가 필요하며 기본 라이어로 진행해요.',
  ALREADY_SUBMITTED: '이미 단어를 제출했어요.',
  ALREADY_ACKNOWLEDGED: '이미 역할을 확인했어요.',
  ALREADY_VOTED: '이미 투표했어요. 제출한 표는 바꿀 수 없어요.',
  JOURNALIST_USED: '기자 취재는 게임당 한 번만 할 수 있어요.',
  INVALID_TARGET: '본인을 제외한 이번 투표의 후보를 선택해 주세요.',
  INVALID_GUESS: '정답은 보이는 글자 1~60자로 입력해 주세요.',
  NOT_GUESSER: '지목된 라이어만 정답 도전을 할 수 있어요.',
  CITIZEN_ONLY: '시민만 이의 제기와 판정 투표에 참여할 수 있어요.',
  ALREADY_APPEAL_VOTED: '이미 판정 투표를 제출했어요.',
  ROOM_CLOSED: '종료된 방이에요.',
  FORBIDDEN: '방이 종료됐거나 이 기기의 참가 정보가 더 이상 유효하지 않아요. 다른 기기에서 이어 했는지도 확인해 주세요.',
  RATE_LIMITED: '요청이 너무 많아요. 몇 분 뒤에 다시 시도해 주세요.',
  NETWORK: '서버에 연결할 수 없어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.',
  NOT_CONFIGURED: '서버 설정(.env.local)이 없어요.',
};
const MESSAGES_EN:Record<string,string> = {
  "INVALID_NICKNAME": "Use 2–16 visible characters for your nickname.",
  "INVALID_CODE": "Enter the six-digit room code.",
  "ROOM_NOT_FOUND": "Room not found. Check the code; the room may have closed.",
  "ROOM_LOCKED": "The host has locked the room.",
  "PLAYER_NOT_FOUND": "This player has left the room.",
  "ROOM_FULL": "The room is full (15 players).",
  "NICKNAME_TAKEN": "This nickname is already in use or too similar.",
  "RECOVERY_FAILED": "That recovery code is incorrect.",
  "HOST_ONLY": "Only the host can do this.",
  "NOT_YOUR_TURN": "It is not your turn. Please check the latest screen.",
  "DISCUSSION_NOT_OVER": "Discussion time is not over yet.",
  "DISCUSSION_OVER": "Discussion time is over. Check the latest screen.",
  "VERSION_CONFLICT": "The game has changed. Please try again.",
  "PHASE_CONFLICT": "The game has moved to another step. Check the latest screen.",
  "REQUEST_CONFLICT": "Your request has changed. Check the latest screen.",
  "PLAYER_COUNT": "You need 3–15 players.",
  "PLAYERS_OFFLINE": "Wait for everyone to join before starting.",
  "ROUND_ACTIVE": "Finish or cancel the current round first.",
  "ROUND_PAUSED": "The round is paused.",
  "RECONNECT_GRACE": "Wait for the reconnect grace period to end.",
  "NOT_ROUND_PLAYER": "Wait for the next round.",
  "INVALID_WORD": "Enter a word with 2–30 visible characters.",
  "INVALID_SETTINGS": "Check the category and game settings. Custom words require a category and classic mode.",
  "ALREADY_SUBMITTED": "You have already submitted a word.",
  "ALREADY_ACKNOWLEDGED": "You have already confirmed your role.",
  "ALREADY_VOTED": "Your vote has already been submitted.",
  "INVALID_TARGET": "Choose an eligible player other than yourself.",
  "INVALID_GUESS": "Enter a guess of 1–60 visible characters.",
  "NOT_GUESSER": "Only the selected liar may guess.",
  "CITIZEN_ONLY": "Only citizens may appeal or vote on an answer.",
  "ALREADY_APPEAL_VOTED": "You have already voted on this answer.",
  "ROOM_CLOSED": "This room has closed.",
  "FORBIDDEN": "This session is no longer valid. You may have continued on another device.",
  "UNAUTHORIZED": "Your session is no longer valid. Rejoin or use your recovery code.",
  "RATE_LIMITED": "Too many requests. Try again in a moment.",
  "NETWORK": "Cannot reach the server. Check your connection and try again.",
  "NOT_CONFIGURED": "The server is not configured.",
  "TEMPORARILY_UNAVAILABLE": "The server is temporarily unavailable. Please try again."
};
export const messageFor = (error: unknown,language:'ko'|'en'='ko') => language==='en' ? MESSAGES_EN[error instanceof ApiError ? error.code : ''] ?? 'Please try again in a moment.' : MESSAGES[error instanceof ApiError ? error.code : ''] ?? '잠시 후 다시 시도해 주세요.';
