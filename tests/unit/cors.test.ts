import { expect, it, vi } from 'vitest';
import { withCors } from '../../supabase/functions/_shared/security';
it('allows configured browser origins and rejects others before handler', async () => {
  const handler = vi.fn(async () => Response.json({ ok: true }));
  const cors = withCors(handler, ['https://party.example']);
  const denied = await cors(new Request('https://api.example', { headers: { Origin: 'https://evil.example' } }));
  expect(denied.status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
  const response = await cors(new Request('https://api.example', { method: 'OPTIONS', headers: { Origin: 'https://party.example' } }));
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://party.example');
  expect(handler).not.toHaveBeenCalled();
});
