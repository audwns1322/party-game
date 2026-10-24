import type { Session } from './api';
// Same-browser silent recovery. The recovery code is never stored: only the user keeps it.
const key = (code: string) => `party-game:session:${code}`;
export function loadSession(code: string): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(code)) ?? 'null');
    return value && typeof value.token === 'string' && typeof value.room_id === 'string' ? value : null;
  } catch { return null; }
}
export function saveSession(s: Session) {
  try { localStorage.setItem(key(s.code), JSON.stringify({ room_id: s.room_id, code: s.code, player_id: s.player_id, token: s.token })); } catch { /* private mode: session lasts this tab only */ }
}
export function clearSession(code: string) {
  try { localStorage.removeItem(key(code)); } catch { /* ignore */ }
}
