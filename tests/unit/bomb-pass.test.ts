import { describe, expect, it } from 'vitest';
import { checkBombAnswer, nextBombHolder, normalizeBombAnswer, randomExplosionDelay } from '../../src/features/bomb-pass/demoEngine';

describe('폭탄 돌리기 미리보기 로직', () => {
  it('최대 시간을 지키되 최소 대기 시간을 강제하지 않는다', () => {
    expect(randomExplosionDelay(45, () => 0)).toBe(1);
    expect(randomExplosionDelay(45, () => 0.5)).toBe(22500);
    expect(randomExplosionDelay(45, () => 1)).toBe(45000);
  });

  it('잘못된 최대 시간을 거절한다', () => {
    expect(() => randomExplosionDelay(0)).toThrow(RangeError);
  });

  it('빈 답변·기존 답변을 거부하고 공백과 대소문자를 정규화한다', () => {
    expect(checkBombAnswer('  ', [])).toBeTruthy();
    expect(checkBombAnswer(' 사 과 ', ['사   과'])).toBeTruthy();
    expect(normalizeBombAnswer('  APPLE   PIE  ')).toBe('apple pie');
    expect(checkBombAnswer('바나나', ['사과'])).toBeNull();
  });

  it('순환 순서가 마지막 참가자에서 처음으로 이어진다', () => {
    expect(nextBombHolder(4, 5)).toBe(0);
    expect(nextBombHolder(1, 5)).toBe(2);
  });
});
