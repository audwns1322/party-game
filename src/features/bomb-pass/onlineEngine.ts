import { BOMB_TOPICS, normalizeBombAnswer } from './demoEngine.ts';

export type BombStatus = 'lobby' | 'countdown' | 'playing' | 'exploded' | 'finished';
export type BombMode = 'voice' | 'text';
export type BombTurnStyle = 'pass' | 'random';
export type BombAnswer = { playerId: string; answer: string };
export type BombPlayer = { id: string; nickname: string; join_order: number };
export type BombState = {
  status: BombStatus; answerMode: BombMode; turnStyle: BombTurnStyle; maxSeconds: number;
  round: number; seats: string[]; holderId: string | null; explodedHolderId: string | null;
  explosionId: string | null; explosionCounts: Record<string, number>; answers: BombAnswer[];
  topicIndex: number; countdownEndsAt?: string | null; startedAt?: string | null; finishedAt?: string | null;
};
export type BombSecret = { explodeAt?: string; receipts?: Array<{ id: string; actor: string }> };
export type BombAction = 'settings' | 'start' | 'pass' | 'next' | 'finish' | 'restart';

export class BombRuleError extends Error {
  constructor(message: string) { super(message); }
}

export function secureRandomIndex(size: number, randomBytes = (bytes: Uint32Array<ArrayBuffer>) => crypto.getRandomValues(bytes)) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 2 ** 32) throw new RangeError('INVALID_RANDOM_RANGE');
  const limit = 2 ** 32 - (2 ** 32 % size);
  const bytes = new Uint32Array(new ArrayBuffer(4));
  do { randomBytes(bytes); } while (bytes[0] >= limit);
  return bytes[0] % size;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const next = secureRandomIndex(i + 1);
    [result[i], result[next]] = [result[next], result[i]];
  }
  return result;
}

function chooseHolder(state: BombState, previous: string | null) {
  const candidates = state.seats.filter(id => id !== previous);
  if (candidates.length === 0) throw new BombRuleError('PLAYER_COUNT');
  if (state.turnStyle === 'random' || previous === null) return candidates[secureRandomIndex(candidates.length)];
  const index = state.seats.indexOf(previous);
  return state.seats[(index + 1) % state.seats.length];
}

export function startBombRound(state: BombState, now: number, previous: string | null = null) {
  const nextTopic = state.round === 0 ? secureRandomIndex(BOMB_TOPICS.length)
    : (state.topicIndex + 1 + secureRandomIndex(BOMB_TOPICS.length - 1)) % BOMB_TOPICS.length;
  const countdownEndsAt = now + 3000;
  const explodeAt = countdownEndsAt + secureRandomIndex(state.maxSeconds * 1000) + 1;
  const updated: BombState = { ...state, status: 'countdown', round: state.round + 1,
    topicIndex: nextTopic, holderId: chooseHolder(state,previous), explodedHolderId: null, explosionId: null,
    answers: [], countdownEndsAt: new Date(countdownEndsAt).toISOString() };
  return { state: updated, secret: { explodeAt: new Date(explodeAt).toISOString() } as BombSecret };
}

export function settleBomb(state: BombState, secret: BombSecret, now: number) {
  if (state.status !== 'playing' && state.status !== 'countdown') return { state, secret, changed: false };
  const explosion = secret.explodeAt ? Date.parse(secret.explodeAt) : NaN;
  if (Number.isFinite(explosion) && now >= explosion) {
    const holder = state.holderId;
    if (!holder) throw new BombRuleError('INVALID_REQUEST');
    return { state: { ...state, status: 'exploded' as const, explodedHolderId: holder,
      explosionId: crypto.randomUUID(), explosionCounts: { ...state.explosionCounts,
        [holder]: (state.explosionCounts[holder] ?? 0) + 1 } },
      secret: { ...secret, explodeAt: undefined }, changed: true };
  }
  if (state.status === 'countdown' && state.countdownEndsAt && now >= Date.parse(state.countdownEndsAt)) {
    return { state: { ...state, status: 'playing' as const }, secret, changed: true };
  }
  return { state, secret, changed: false };
}

export function applyBombAction(state: BombState, secret: BombSecret, action: BombAction,
  payload: Record<string, unknown>, actor: string, host: string, players: BombPlayer[], now: number) {
  const hostOnly = () => { if (actor !== host) throw new BombRuleError('HOST_ONLY'); };
  switch (action) {
    case 'settings': {
      hostOnly();
      if (state.status !== 'lobby') throw new BombRuleError('ROOM_LOCKED');
      const { maxSeconds, answerMode, turnStyle } = payload;
      if (![15,30,45,60,90,120,180].includes(maxSeconds as number)
        || (answerMode !== 'voice' && answerMode !== 'text')
        || (turnStyle !== 'pass' && turnStyle !== 'random')) throw new BombRuleError('INVALID_SETTINGS');
      return { state: { ...state, maxSeconds: maxSeconds as number, answerMode: answerMode as BombMode,
        turnStyle: turnStyle as BombTurnStyle }, secret };
    }
    case 'start': {
      hostOnly();
      if (state.status !== 'lobby') throw new BombRuleError('ROOM_LOCKED');
      if (players.length < 3 || players.length > 15) throw new BombRuleError('PLAYER_COUNT');
      const seats = shuffle(players.map(player => player.id));
      return startBombRound({ ...state, seats, round: 0, explosionCounts: {}, startedAt: new Date(now).toISOString(), finishedAt: null }, now);
    }
    case 'pass': {
      if (state.status !== 'playing') throw new BombRuleError('PHASE_CONFLICT');
      if (actor !== state.holderId) throw new BombRuleError('NOT_YOUR_TURN');
      if (secret.explodeAt && now >= Date.parse(secret.explodeAt)) throw new BombRuleError('PHASE_CONFLICT');
      let answers = state.answers;
      if (state.answerMode === 'text') {
        if (typeof payload.answer !== 'string') throw new BombRuleError('INVALID_ANSWER');
        const answer = payload.answer.trim().replace(/\s+/g, ' ');
        const normalized = normalizeBombAnswer(answer);
        if (!normalized || [...answer].length > 30 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(answer)) throw new BombRuleError('INVALID_ANSWER');
        if (answers.some(item => normalizeBombAnswer(item.answer) === normalized)) throw new BombRuleError('DUPLICATE_ANSWER');
        if (answers.length >= 250) throw new BombRuleError('ANSWER_LIMIT');
        answers = [...answers, { playerId: actor, answer }];
      }
      return { state: { ...state, answers, holderId: chooseHolder(state, actor) }, secret };
    }
    case 'next': {
      hostOnly();
      if (state.status !== 'exploded') throw new BombRuleError('PHASE_CONFLICT');
      return startBombRound(state, now, state.turnStyle === 'pass' ? state.holderId : null);
    }
    case 'finish': {
      hostOnly();
      if (state.status === 'lobby' || state.status === 'finished') throw new BombRuleError('PHASE_CONFLICT');
      return { state: { ...state, status: 'finished' as const, finishedAt: new Date(now).toISOString() }, secret: {} };
    }
    case 'restart': {
      hostOnly();
      if (state.status !== 'finished') throw new BombRuleError('PHASE_CONFLICT');
      return { state: { ...state, status: 'lobby' as const, round: 0, holderId: null, explodedHolderId: null,
        explosionId: null, explosionCounts: {}, answers: [], seats: [], countdownEndsAt: null,
        startedAt: null, finishedAt: null }, secret: {} };
    }
  }
}
