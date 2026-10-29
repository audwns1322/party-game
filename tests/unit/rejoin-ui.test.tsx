import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/api';
import { Lobby } from '../../src/features/room/Lobby';

const state = vi.hoisted(() => ({ fatal: null as ApiError | null }));
vi.mock('../../src/features/room/useRoom', () => ({ useRoom: () => state }));
afterEach(() => vi.unstubAllGlobals());

const render = (code: string) => {
  vi.stubGlobal('location', { origin: 'https://test.example' });
  return renderToStaticMarkup(<Lobby session={{ room_id: 'room', code, player_id: 'player', token: 'test-token' }} />);
};

it('uses document navigation to rejoin after access loss, resetting the stale session and fatal hook state', () => {
  state.fatal = new ApiError('FORBIDDEN', 403);
  expect(render('123456')).toMatch(/<a[^>]*href="\/room\/123456"[^>]*>이 방에 다시 참가하기<\/a>/);
});

it('does not offer rejoining a closed room', () => {
  state.fatal = new ApiError('ROOM_CLOSED', 410);
  expect(render('123456')).not.toContain('이 방에 다시 참가하기');
});
