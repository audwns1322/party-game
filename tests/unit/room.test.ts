import { describe, expect, it } from 'vitest';
import { errorCode, newRecoveryCode, normalizeCode, normalizeNickname, normalizeRecoveryCode } from '../../supabase/functions/_shared/room';

describe('input normalization', () => {
  it('nickname: NFKC, trimmed, 2-16 graphemes, no invisible/bidi/filler characters', () => {
    const C = String.fromCodePoint;
    expect(normalizeNickname('  철수   영희 ')).toEqual({ display: '철수 영희', key: '철수영희' });
    expect(normalizeNickname(C(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + '가족').display).toHaveLength(10);
    for (const bad of ['가', 'a'.repeat(17), 'ab' + C(0x7), 'ab' + C(0x202e), 'Al' + C(0xad) + 'pha', C(0x3164, 0x3164), C(0x2800, 0x2800),
      'ab' + C(0x200d) + 'c', 'ab' + C(0xd800), 'ab' + C(0xe0041), 42, null]) expect(() => normalizeNickname(bad)).toThrow();
  });
  it('nickname key folds look-alikes so impersonation collides', () => {
    const C = String.fromCodePoint;
    const key = (v: string) => normalizeNickname(v).key;
    expect(key('Alpha')).toBe(key(C(0xff21, 0xff4c, 0xff50, 0xff48, 0xff41)));
    expect(key('All')).toBe(key('Al1'));
    expect(key('ace')).toBe(key(C(0x430, 0x441, 0x435)));
    expect(() => normalizeNickname(C(0x410) + 'lpha')).toThrow();
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
