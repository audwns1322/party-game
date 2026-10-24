// Browser API client for the room Edge Functions. Credentials go in headers only.
export type Session = { room_id: string; code: string; player_id: string; token: string };
export type Issued = Session & { recovery_code: string };
export type Settings = { word_mode: 'builtin' | 'custom'; hint_rounds: 1 | 2 | 3; discussion_seconds: 0 | 60 | 120 | 180 | 300 };
export type Player = { id: string; nickname: string; join_order: number; status: string; wins: number; connected: boolean };
export type RoomSnapshot = {
  room: { id: string; code: string; status: string; version: number; host_player_id: string; settings: Settings; expires_at: string };
  me: { player_id: string; is_host: boolean };
  players: Player[];
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
};

const MESSAGES: Record<string, string> = {
  INVALID_NICKNAME: '닉네임은 2~16자로 입력해 주세요.',
  INVALID_CODE: '방 코드는 숫자 6자리예요.',
  ROOM_NOT_FOUND: '방을 찾을 수 없어요. 코드를 확인해 주세요.',
  ROOM_FULL: '방이 가득 찼어요. (최대 12명)',
  NICKNAME_TAKEN: '이미 사용 중인 닉네임이에요.',
  RECOVERY_FAILED: '복구 코드가 맞지 않아요.',
  HOST_ONLY: '방장만 할 수 있어요.',
  VERSION_CONFLICT: '방 상태가 바뀌었어요. 다시 시도해 주세요.',
  ROOM_CLOSED: '종료된 방이에요.',
  FORBIDDEN: '이 방에 참가 중이 아니에요.',
  NETWORK: '네트워크 연결을 확인해 주세요.',
  NOT_CONFIGURED: '서버 설정(.env.local)이 없어요.',
};
export const messageFor = (error: unknown) => MESSAGES[error instanceof ApiError ? error.code : ''] ?? '잠시 후 다시 시도해 주세요.';
