export async function fetchPersonalSnapshot(baseUrl: string, publicKey: string, roomId: string, token: string) {
  // Credential in header only; never URL, analytics or logs.
  const endpoint = new URL('/functions/v1/m0-snapshot', baseUrl);
  endpoint.searchParams.set('room_id', roomId);
  const response = await fetch(endpoint, { headers: { apikey: publicKey, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!response.ok) throw new Error(`SNAPSHOT_${response.status}`);
  return response.json() as Promise<{ room_id: string; player_id: string; role: 'citizen' | 'liar'; word: string | null; version: number }>;
}
