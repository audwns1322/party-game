import type { Session } from './api';
// Same-browser restore. The recovery code is kept with the session token on this device only
// (anyone with this storage already holds the token) so the lobby can show it on demand.
export type StoredSession = Session & { recovery_code?: string; nickname?: string };
const PREFIX = 'party-game:session:';
const key = (code: string) => `${PREFIX}${code}`;
const valid = (v: unknown): v is StoredSession =>
  !!v && typeof (v as StoredSession).token === 'string' && typeof (v as StoredSession).room_id === 'string' && typeof (v as StoredSession).code === 'string';

export function loadSession(code: string): StoredSession | null {
  try { const v = JSON.parse(localStorage.getItem(key(code)) ?? 'null'); return valid(v) ? v : null; } catch { return null; }
}
export function saveSession(s: StoredSession) {
  try {
    localStorage.setItem(key(s.code), JSON.stringify({ room_id: s.room_id, code: s.code, player_id: s.player_id, token: s.token, recovery_code: s.recovery_code, nickname: s.nickname }));
  } catch { /* private mode: session lasts this tab only */ }
}
export function clearSession(code: string) {
  try { localStorage.removeItem(key(code)); } catch { /* ignore */ }
}
/** Rooms this browser is (or was) in, newest code first. Stale ones are cleared when the server rejects them. */
export function listSessions(): StoredSession[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
      .map((k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } })
      .filter(valid);
  } catch { return []; }
}
