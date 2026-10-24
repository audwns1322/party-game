import { describe, expect, it } from 'vitest';
import { errorCode, newRecoveryCode, normalizeCode, normalizeNickname, normalizeRecoveryCode } from '../../supabase/functions/_shared/room';

describe('input normalization', () => {
  it('nickname: NFC, trimmed, 2–16 code points, no control/bidi characters', () => {
    expect(normalizeNickname('  철수   영희 ')).toBe('철수 영희');
    expect(normalizeNickname('😀😀')).toBe('😀😀');
    for (const bad of ['가', 'a'.repeat(17), 'ab\u0007', 'ab‮', 42, null]) expect(() => normalizeNickname(bad)).toThrow();
  });
  it('room code: exactly six digits', () => {
    expect(normalizeCode(' 012345 ')).toBe('012345');
    for (const bad of ['12345', '1234567', '12a456', 123456]) expect(() => normalizeCode(bad)).toThrow();
  });
});

describe('recovery code', () => {
  it('has 128 bits of randomness (26 base32 chars) and is unique per call', () => {
    const codes = new Set(Array.from({ length: 200 }, newRecoveryCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(normalizeRecoveryCode(code)).toHaveLength(26);
  });
  it('accepts case, spacing and O/I/L confusions but rejects malformed input', () => {
    const code = newRecoveryCode();
    const typed = code.toLowerCase().replace(/-/g, ' ');
    expect(normalizeRecoveryCode(typed)).toBe(normalizeRecoveryCode(code));
    expect(normalizeRecoveryCode('O'.repeat(26))).toBe('0'.repeat(26));
    for (const bad of ['short', 'U'.repeat(26), 7]) expect(() => normalizeRecoveryCode(bad)).toThrow();
  });
});

it('maps only known database errors; everything else fails closed', () => {
  expect(errorCode(new Error('ROOM_FULL'))).toBe('ROOM_FULL');
  expect(errorCode({ message: 'HOST_ONLY' })).toBe('HOST_ONLY');
  expect(errorCode(new Error('duplicate key value violates unique constraint "x"'))).toBe('TEMPORARILY_UNAVAILABLE');
});
