import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type GamePhase, type RoomSnapshot, type Session } from '../../lib/api';
import { subscribeToRoomVersion } from '../../lib/realtime';
import { createPublicClient } from '../../lib/supabase';

const HEARTBEAT_MS = 10_000;
const RETRY_SAFE = new Set(['update_settings', 'lock', 'kick', 'leave', 'close_room']);
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const realtime = url && key ? createPublicClient(url, key) : null;

const isFatal = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 410);

/** Server snapshot is the only source of truth. Realtime and heartbeat only trigger a re-fetch. */
export function useRoom(session: Session) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [fatal, setFatal] = useState<ApiError | null>(null);
  /** false after a failed heartbeat or snapshot (server unreachable); the UI shows a banner. */
  const [online, setOnline] = useState(true);
  const version = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await api.snapshot(session);
      if (next.room.version < version.current) return;
      version.current = next.room.version;
      setSnapshot(next);
      setOnline(true);
    } catch (error) {
      if (isFatal(error)) setFatal(error as ApiError); else setOnline(false);
    }
  }, [session]);

  useEffect(() => {
    let stopped = false;
    let ticks = 0;
    const stop = () => { stopped = true; clearInterval(timer); };
    const beat = async () => {
      if (stopped) return;
      try {
        const { version: latest } = await api.command(session, 'heartbeat');
        if (stopped) return;
        setOnline(true);
        // Presence ("접속 중/자리 비움") changes without a version bump, so re-read it every ~30s too.
        ticks += 1;
        if (latest !== version.current || ticks % 3 === 0) await refresh();
      } catch (error) {
        if (stopped) return;
        // Closed room / kicked / rotated: stop polling instead of retrying forever.
        if (isFatal(error)) { stop(); setFatal(error as ApiError); } else setOnline(false);
      }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    void refresh().then(beat);
    const wake = () => { if (document.visibilityState === 'visible') void beat(); };
    const offline = () => setOnline(false);
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    addEventListener('offline', offline);
    const unsubscribe = realtime ? subscribeToRoomVersion(realtime, session.room_id, () => void refresh()) : () => undefined;
    return () => {
      stop();
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake); removeEventListener('offline', offline);
      void unsubscribe();
    };
  }, [session, refresh]);

  /**
   * Run a versioned command. Lobby actions are intent-based, so a VERSION_CONFLICT caused by someone
   * joining is retried once against the fresh version. Game-phase commands (M2+) must NOT reuse this.
   */
  const run = useCallback(async (action: string, payload?: object) => {
    try {
      await api.command(session, action, version.current, payload);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'VERSION_CONFLICT' && RETRY_SAFE.has(action))) throw error;
      await refresh();
      await api.command(session, action, version.current, payload);
    } finally {
      await refresh();
    }
  }, [session, refresh]);

  const pending = useRef<Parameters<typeof api.game>[1] | null>(null);
  const runGame = useCallback(async (action: string, payload: object = {}) => {
    if (!snapshot) return;
    // Transport retries reuse the complete original request, including version and request_id.
    const previous = pending.current;
    const body = previous?.action === action && JSON.stringify(previous.payload) === JSON.stringify(payload) ? previous : {
      action, payload, expected_version: version.current,
      expected_phase: (snapshot.round?.phase ?? 'LOBBY') as GamePhase, request_id: crypto.randomUUID(),
    };
    pending.current = body;
    try { await api.game(session,body); pending.current = null; }
    catch (error) {
      if (error instanceof ApiError && error.status > 0 && error.status < 500) pending.current = null;
      throw error;
    } finally { await refresh(); }
  }, [session,snapshot,refresh]);
  return { snapshot, fatal, online, run, runGame, refresh };
}
