import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type GamePhase, type RoomSnapshot, type Session } from '../../lib/api';
import { subscribeToRoomVersion } from '../../lib/realtime';
import { createPublicClient } from '../../lib/supabase';

const HEARTBEAT_MS = 10_000;
const RETRY_SAFE = new Set(['update_settings', 'lock', 'kick', 'leave', 'close_room']);
const MAFIA_SUBMISSIONS = new Set(['mafia_ack','mafia_night_action','mafia_day_vote']);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve,ms));
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const realtime = url && key ? createPublicClient(url, key) : null;

const isFatal = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 410);
const isTransient = (error: unknown) => error instanceof ApiError && (error.status === 0 || error.status >= 500);
export async function retryConnectionRead<T>(request: () => Promise<T>, wait: () => Promise<void> = () => delay(750)): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (!isTransient(error)) throw error;
    await wait();
    return request();
  }
}
type GameRequest = Parameters<typeof api.game>[1];
export function canReuseGameRequest(previous: GameRequest | null, current: Omit<GameRequest,'request_id'>): previous is GameRequest {
  return previous?.action === current.action && previous.expected_version === current.expected_version
    && previous.expected_phase === current.expected_phase && JSON.stringify(previous.payload) === JSON.stringify(current.payload);
}
export function canRetryVote(request: GameRequest, fresh: RoomSnapshot | undefined): fresh is RoomSnapshot {
  const payload = request.payload as {round_id?:unknown;ballot_no?:unknown;cycle_no?:unknown};
  return request.action === 'submit_vote' && ['VOTE_1','VOTE_RUNOFF'].includes(request.expected_phase)
    && fresh?.round?.id === payload.round_id && fresh?.round?.phase === request.expected_phase
    && fresh?.round?.vote?.ballot_no === payload.ballot_no && (fresh?.round?.vote?.cycle_no ?? 1) === (payload.cycle_no ?? 1) && fresh?.round?.me?.voted === false;
}
export function canRetryMafiaVote(previous: RoomSnapshot, targetId: string, fresh: RoomSnapshot | undefined): fresh is RoomSnapshot {
  const phase = previous.mafia?.phase;
  const eligible = phase === 'DAY_VOTE' || phase === 'DAY_RUNOFF';
  if (!eligible || !fresh?.mafia) return false;
  return fresh.mafia.id === previous.mafia?.id && fresh.mafia.phase === phase
    && fresh.mafia.day_no === previous.mafia?.day_no && fresh.mafia.me?.alive === true
    && fresh.mafia.me.day_voted === false && targetId !== fresh.me.player_id
    && (phase === 'DAY_RUNOFF' ? fresh.mafia.day_result?.runoff_ids : fresh.mafia.alive_ids)?.includes(targetId) === true;
}

/** Only retry a submitted mafia intent in the exact same game/phase/day/night. */
export function mafiaSubmissionState(previous: RoomSnapshot, action: string, payload: object | undefined, fresh: RoomSnapshot | undefined): 'retry' | 'done' | 'changed' {
  const before=previous.mafia, after=fresh?.mafia;
  if (!before || !after || !after.me || before.id!==after.id || before.phase!==after.phase ||
      before.day_no!==after.day_no || before.night_no!==after.night_no) return 'changed';
  if (action==='mafia_ack' && after.phase==='REVEAL_ROLE')
    return after.me.acknowledged ? 'done' : 'retry';
  if (action==='mafia_night_action' && after.phase==='NIGHT' && after.me.alive && before.me?.role===after.me.role) {
    if (after.me.night_submitted) return 'done';
    const target=(payload as {target_id?:unknown}|undefined)?.target_id;
    const valid=typeof target==='string' ? after.alive_ids?.includes(target) &&
      (target!==fresh.me.player_id || after.me.role==='doctor') &&
      !(after.me.role==='mafia' && after.me.teammate_ids.includes(target)) :
      target===null && after.me.role==='journalist';
    return valid && after.me.night_submitted===false ? 'retry' : 'changed';
  }
  if (action==='mafia_day_vote' && (after.phase==='DAY_VOTE'||after.phase==='DAY_RUNOFF')) {
    if (after.me.day_voted) return 'done';
    const target=(payload as {target_id?:unknown}|undefined)?.target_id;
    return typeof target==='string' && canRetryMafiaVote(previous,target,fresh) ? 'retry' : 'changed';
  }
  return 'changed';
}

/** Server snapshot is the only source of truth. Realtime and heartbeat only trigger a re-fetch. */
export function useRoom(session: Session) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [fatal, setFatal] = useState<ApiError | null>(null);
  /** false after a failed heartbeat or snapshot (server unreachable); the UI shows a banner. */
  const [online, setOnline] = useState(true);
  const version = useRef(0);
  const inFlight = useRef<{session:Session;promise:Promise<RoomSnapshot|undefined>} | null>(null);

  // Coalesce overlapping realtime/polling reads. A command or new invalidation
  // can request a trailing read after an older in-flight snapshot finishes.
  const refresh = useCallback(async (afterPending=false): Promise<RoomSnapshot|undefined> => {
    const pending = inFlight.current;
    if (pending?.session===session) {
      if (!afterPending) return pending.promise;
      await pending.promise;
      if (inFlight.current?.session===session) return inFlight.current.promise;
    }
    const promise = (async () => {
      try {
        const next = await retryConnectionRead(() => api.snapshot(session));
        if (next.room.version < version.current) return;
        version.current = next.room.version;
        setSnapshot(next);
        setOnline(true);
        return next;
      } catch (error) {
        if (isFatal(error)) setFatal(error as ApiError); else setOnline(false);
      }
    })();
    const entry = {session,promise};
    inFlight.current=entry;
    try { return await promise; }
    finally { if (inFlight.current===entry) inFlight.current=null; }
  }, [session]);

  useEffect(() => {
    let stopped = false;
    let ticks = 0;
    let beating = false;
    const stop = () => { stopped = true; clearInterval(timer); };
    const beat = async () => {
      if (stopped || beating) return;
      beating=true;
      try {
        const { version: latest } = await retryConnectionRead(() => api.command(session, 'heartbeat'));
        if (stopped) return;
        setOnline(true);
        // Presence ("접속 중/자리 비움") changes without a version bump, so re-read it every ~30s too.
        ticks += 1;
        if (latest !== version.current || ticks % 3 === 0) await refresh(latest>version.current);
      } catch (error) {
        if (stopped) return;
        // Closed room / kicked / rotated: stop polling instead of retrying forever.
        if (isFatal(error)) { stop(); setFatal(error as ApiError); } else setOnline(false);
      } finally { beating=false; }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    void refresh().then(beat);
    const wake = () => { if (document.visibilityState === 'visible') { void beat(); void refresh(true); } };
    const offline = () => setOnline(false);
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    addEventListener('offline', offline);
    const unsubscribe = realtime ? subscribeToRoomVersion(realtime, session.room_id, () => void refresh(true)) : () => undefined;
    return () => {
      stop();
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake); removeEventListener('offline', offline);
      void unsubscribe();
    };
  }, [session, refresh]);

  useEffect(() => {
    if (fatal || !['DISCUSS','REVEAL_VOTE','REVEAL_LIAR','APPEAL_WINDOW','APPEAL_VOTE','PAUSED_DISCONNECT'].includes(snapshot?.round?.phase ?? '') || !(snapshot?.round?.deadline_at || snapshot?.round?.disconnect?.grace_until)) return;
    let active = false;
    const timer = setInterval(async () => {
      if (active || document.visibilityState !== 'visible') return;
      active = true;
      try { await refresh(); } finally { active = false; }
    }, 2000);
    return () => clearInterval(timer);
  }, [fatal, snapshot?.round?.phase, snapshot?.round?.deadline_at, snapshot?.round?.disconnect?.grace_until, refresh]);

  /**
   * Run a versioned command. Lobby actions are intent-based, so a VERSION_CONFLICT caused by someone
   * joining is retried once against the fresh version. Game-phase commands (M2+) must NOT reuse this.
   */
  const run = useCallback(async (action: string, payload?: object) => {
    const mafiaSubmission=MAFIA_SUBMISSIONS.has(action) && snapshot?.mafia;
    try {
      // Bind mafia input to the version actually rendered, not a newer unseen phase.
      await api.command(session, action, mafiaSubmission ? snapshot.room.version : version.current, payload);
    } catch (error) {
      const conflict=error instanceof ApiError && error.code==='VERSION_CONFLICT';
      if (mafiaSubmission && snapshot && (conflict || isTransient(error))) {
        for (let attempt=0;attempt<15;attempt+=1) {
          const fresh=await refresh(true);
          const state=mafiaSubmissionState(snapshot,action,payload,fresh);
          if (state==='done') return;
          if (state!=='retry' || !fresh) throw error;
          try { await api.command(session,action,fresh.room.version,payload); return; }
          catch (retryError) {
            if (!(retryError instanceof ApiError && retryError.code==='VERSION_CONFLICT') && !isTransient(retryError)) throw retryError;
            await delay(80+Math.random()*120);
          }
        }
        throw error;
      }
      if (!conflict || !RETRY_SAFE.has(action)) throw error;
      await refresh(true);
      await api.command(session,action,version.current,payload);
    } finally {
      await refresh(true);
    }
  }, [session, refresh, snapshot]);

  const pending = useRef<Parameters<typeof api.game>[1] | null>(null);
  const runGame = useCallback(async (action: string, payload: object = {}) => {
    if (!snapshot) return;
    // Transport retries reuse the complete original request, including version and request_id.
    const previous = pending.current;
    const current = {
      action, payload, expected_version: version.current,
      expected_phase: (snapshot.round?.phase ?? 'LOBBY') as GamePhase,
    };
    let body = canReuseGameRequest(previous,current) ? previous : { ...current, request_id:crypto.randomUUID() };
    pending.current = body;
    try {
      try { await api.game(session,body); }
      catch (error) {
        if (!(error instanceof ApiError && error.code === 'VERSION_CONFLICT' && action === 'submit_vote')) throw error;
        const fresh = await refresh(true);
        if (!canRetryVote(body,fresh)) throw error;
        body = {...body,expected_version:fresh.room.version,request_id:crypto.randomUUID()};
        pending.current = body;
        await api.game(session,body);
      }
      pending.current = null;
    }
    catch (error) {
      if (error instanceof ApiError && error.status > 0 && error.status < 500) pending.current = null;
      throw error;
    } finally { await refresh(true); }
  }, [session,snapshot,refresh]);
  return { snapshot, fatal, online, run, runGame, refresh };
}
