// Browser API client for the room Edge Functions. Credentials go in headers only.
export type Session = { room_id: string; code: string; player_id: string; token: string };
export type Issued = Session & { recovery_code: string };
export const THEMES = ['음식','동물','생활용품','장소','취미','자연','운동','크로스핏','여행'] as const;
export type Settings = {
  word_mode: 'builtin' | 'custom'; hint_rounds: 1 | 2 | 3; discussion_seconds: 0 | 60 | 120 | 180 | 300;
  theme?: 'random' | typeof THEMES[number]; custom_theme?: string;
  game_mode?: 'classic' | 'confusion'; difficulty?: 'easy' | 'hard'; liar_count?: 1 | 2;
};
export type Player = { id: string; nickname: string; join_order: number; status: string; wins: number; connected: boolean };
export type GamePhase = 'LOBBY' | 'COLLECT_WORDS' | 'REVEAL_ROLE' | 'HINT' | 'DISCUSS' | 'PAUSED_HOST' | 'VOTE_1' | 'VOTE_RUNOFF' | 'REVEAL_VOTE' | 'REVEAL_LIAR' | 'GUESS' | 'APPEAL_WINDOW' | 'APPEAL_VOTE' | 'FINAL_RESULT';
export type RoundSnapshot = {
  id: string; phase: Exclude<GamePhase,'LOBBY'>; version: number; participant_ids: string[];
  submitted_count: number; acknowledged_count: number;
  liar_count?: 1 | 2;
  theme?: string; game_mode?: 'classic' | 'confusion'; difficulty?: 'easy' | 'hard';
  hint_index: number; hint_round: number; hint_rounds: number; current_player_id: string | null;
  deadline_at: string | null; remaining_ms: number | null; paused_phase: 'HINT' | 'DISCUSS' | null;
  me: { submitted: boolean; acknowledged: boolean; role: 'citizen' | 'liar' | null; word: string | null; voted?: boolean; eliminated?: boolean } | null;
  eliminated_ids?: string[];
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
  room: { id: string; code: string; status: string; version: number; host_player_id: string; settings: Settings; locked: boolean; expires_at: string };
  me: { player_id: string; is_host: boolean };
  players: Player[];
  round?: RoundSnapshot | null;
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
  try {
    response = await fetch(new URL(`/functions/v1/${path}`, baseUrl), { ...init, cache: 'no-store', headers: { apikey: publicKey!, ...init.headers } });
  } catch { throw new ApiError('NETWORK', 0); }
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
  create: (nickname: string) => call<Issued>('room-create', json({ nickname })),
  join: (room_code: string, nickname: string) => call<Issued>('room-join', json({ room_code, nickname })),
  recover: (room_code: string, recovery_code: string) => call<Issued>('player-recover', json({ room_code, recovery_code })),
  snapshot: (s: Session) => call<RoomSnapshot>(`room-snapshot?room_id=${encodeURIComponent(s.room_id)}`, { headers: { Authorization: `Bearer ${s.token}` } }),
  command: (s: Session, action: string, expected_version?: number, payload?: object) =>
    call<{ version: number }>('room-command', json({ room_id: s.room_id, action, payload, expected_version, request_id: crypto.randomUUID() }, s.token)),
  game: (s: Session, body: { action: string; payload: object; expected_version: number; expected_phase: GamePhase; request_id: string }) =>
    call<{ version: number }>('game-command', json({ room_id: s.room_id, ...body }, s.token)),
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
  NOT_YOUR_TURN: '현재 힌트 차례인 참가자만 완료할 수 있어요.',
  DISCUSSION_NOT_OVER: '토론 시간이 아직 남아 있어요.',
  DISCUSSION_OVER: '토론 시간이 끝났어요. 최신 상태를 확인해 주세요.',
  VERSION_CONFLICT: '방 상태가 바뀌었어요. 다시 시도해 주세요.',
  PHASE_CONFLICT: '게임 단계가 바뀌었어요. 최신 화면에서 다시 시도해 주세요.',
  REQUEST_CONFLICT: '요청 내용이 달라졌어요. 최신 상태를 확인해 주세요.',
  PLAYER_COUNT: '게임은 3~15명일 때 시작할 수 있어요.',
  PLAYERS_OFFLINE: '자리 비움인 참가자가 있어요. 모두 돌아온 후 시작해 주세요.',
  ROUND_ACTIVE: '현재 판을 먼저 취소해 주세요.',
  NOT_ROUND_PLAYER: '이번 판은 관전할 수 없어요. 다음 판을 기다려 주세요.',
  INVALID_WORD: '공백을 제외한 2~30자의 단어를 입력해 주세요.',
  INVALID_SETTINGS: '테마와 게임 설정을 확인해 주세요. 직접 입력은 테마가 필요하며 기본 라이어로 진행해요.',
  ALREADY_SUBMITTED: '이미 단어를 제출했어요.',
  ALREADY_ACKNOWLEDGED: '이미 역할을 확인했어요.',
  ALREADY_VOTED: '이미 투표했어요. 제출한 표는 바꿀 수 없어요.',
  INVALID_TARGET: '본인을 제외한 이번 투표의 후보를 선택해 주세요.',
  INVALID_GUESS: '정답은 보이는 글자 1~60자로 입력해 주세요.',
  NOT_GUESSER: '지목된 라이어만 정답 도전을 할 수 있어요.',
  CITIZEN_ONLY: '시민만 이의 제기와 판정 투표에 참여할 수 있어요.',
  ALREADY_APPEAL_VOTED: '이미 판정 투표를 제출했어요.',
  ROOM_CLOSED: '종료된 방이에요.',
  FORBIDDEN: '이 방의 참가자가 아니에요. 나갔거나 내보내졌을 수 있어요.',
  RATE_LIMITED: '요청이 너무 많아요. 몇 분 뒤에 다시 시도해 주세요.',
  NETWORK: '서버에 연결할 수 없어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.',
  NOT_CONFIGURED: '서버 설정(.env.local)이 없어요.',
};
export const messageFor = (error: unknown) => MESSAGES[error instanceof ApiError ? error.code : ''] ?? '잠시 후 다시 시도해 주세요.';
