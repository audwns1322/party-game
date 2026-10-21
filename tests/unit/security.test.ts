import { describe, it, expect, vi } from 'vitest';
import { hashToken, newToken, snapshotHandler, publicVersionEvent } from '../../supabase/functions/_shared/security';
const room = '00000000-0000-4000-8000-000000000001';
const otherRoom = '00000000-0000-4000-8000-000000000002';
const token = 'a'.repeat(64);
const own = { room_id: room, player_id: 'player-a', role: 'citizen' as const, word: '사과', version: 1 };
const request = (credential: string | null = token, roomId = room, extra = '') => new Request(`https://example.test/snapshot?room_id=${roomId}${extra}`, { headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
describe('participant snapshot security', () => {
  it('hashes 256-bit credentials without retaining plaintext', async () => {
    const value = newToken();
    expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect(newToken()).not.toBe(value);
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('rejects absent and malformed credentials before database access', async () => {
    const lookup = vi.fn();
    const handler = snapshotHandler(lookup);
    for (const credential of [null, '123456', 'z'.repeat(64)]) expect((await handler(request(credential))).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('binds lookup to token hash and room; query player/role cannot impersonate', async () => {
    const lookup = vi.fn(async () => ({ ...own, credential_hash: 'must-not-leak', ballot: 'must-not-leak' }));
    const response = await snapshotHandler(lookup)(request(token, room, '&player_id=other&role=liar'));
    expect(lookup).toHaveBeenCalledWith(await hashToken(token), room);
    expect(await response.json()).toEqual(own);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('denies invalid, revoked and cross-room tokens', async () => {
    const lookup = async (hash: string, id: string) => hash === await hashToken(token) && id === room ? own : null;
    const handler = snapshotHandler(lookup);
    expect((await handler(request('b'.repeat(64)))).status).toBe(403);
    expect((await handler(request(token, otherRoom))).status).toBe(403);
  });
  it('never returns a word to the liar even when repository supplies one', async () => {
    const response = await snapshotHandler(async () => ({ ...own, role: 'liar' }))(request());
    expect(await response.json()).toEqual({ ...own, role: 'liar', word: null });
  });
  it('fails closed without exposing backend errors', async () => {
    const response = await snapshotHandler(async () => { throw new Error('secret database detail'); })(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'TEMPORARILY_UNAVAILABLE' });
  });
  it('rejects invalid rooms and methods', async () => {
    const handler = snapshotHandler(vi.fn());
    expect((await handler(request(token, '123456'))).status).toBe(400);
    expect((await handler(new Request('https://example.test', { method: 'POST' }))).status).toBe(405);
  });
});
describe('public realtime payload', () => {
  it('contains only room identity and version', () => {
    expect(publicVersionEvent(room, 2)).toEqual({ room_id: room, version: 2 });
    expect(() => publicVersionEvent(room, NaN)).toThrow();
    expect(() => publicVersionEvent(room, -1)).toThrow();
  });
});
