export const BOMB_TOPICS = [
  '과일 이름', '운동 종목', '동물 이름', '한국 음식', '여행지',
  '학교에서 볼 수 있는 물건', '영화 장르', '교통수단', '직업', '음료 이름',
  '바다 생물', '겨울에 필요한 물건', '악기 이름', '도시 이름', '채소 이름',
];

export const DEMO_PLAYERS = [
  '명준', '지민', '서연', '도현', '하린', '민서', '수빈', '유진',
  '재윤', '은서', '현우', '다은', '준호', '예린', '태희',
];

export function normalizeBombAnswer(answer: string): string {
  return answer.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko');
}

export function checkBombAnswer(answer: string, previousAnswers: string[]): string | null {
  const normalized = normalizeBombAnswer(answer);
  if (!normalized) return '답변을 먼저 입력해 주세요.';
  if (normalized.length > 30) return '답변은 30자 이내로 입력해 주세요.';
  if (previousAnswers.some(previous => normalizeBombAnswer(previous) === normalized)) return '이번 라운드에서 이미 사용한 답이에요.';
  return null;
}

/** No guaranteed minimum delay: every value from almost zero to max is possible. */
export function randomExplosionDelay(maxSeconds: number, random = Math.random): number {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new RangeError('Maximum time must be positive.');
  const draw = Math.min(1, Math.max(0, random()));
  return Math.max(1, Math.round(draw * maxSeconds * 1000));
}

export function nextBombHolder(current: number, playerCount: number): number {
  if (playerCount < 2 || current < 0 || current >= playerCount) throw new RangeError('Invalid player order.');
  return (current + 1) % playerCount;
}

/** Pick uniformly from the players, excluding the current holder when passing. */
export function randomBombHolder(current: number | null, playerCount: number, random = Math.random): number {
  if (playerCount < 2 || (current !== null && (current < 0 || current >= playerCount))) {
    throw new RangeError('Invalid player order.');
  }
  const choices = current === null ? playerCount : playerCount - 1;
  const draw = Math.min(1, Math.max(0, random()));
  const slot = Math.min(choices - 1, Math.floor(draw * choices));
  return current !== null && slot >= current ? slot + 1 : slot;
}
