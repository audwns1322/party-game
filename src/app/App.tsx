import { useEffect, useState } from 'react';
import { usePath } from '../lib/router';
import { loadSession, type StoredSession } from '../lib/session';
import { Entry } from '../features/room/Entry';
import { Home } from '../features/room/Home';
import { Lobby } from '../features/room/Lobby';

export function App() {
  const path = usePath();
  const code = path.match(/^\/room\/(\d{6})\/?$/)?.[1] ?? null;
  const [session, setSession] = useState<StoredSession | null>(() => (code ? loadSession(code) : null));
  useEffect(() => { setSession(code ? loadSession(code) : null); }, [code]);

  if (!code) return <Home onIssued={(issued, nickname) => setSession({ ...issued, nickname })} />;
  if (!session) return <Entry code={code} onIssued={(issued, nickname) => setSession({ ...issued, nickname })} />;
  return <Lobby key={session.token} session={session} />;
}
