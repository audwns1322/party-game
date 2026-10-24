import { useEffect, useState } from 'react';
import type { Issued, Session } from '../lib/api';
import { usePath } from '../lib/router';
import { loadSession } from '../lib/session';
import { Entry } from '../features/room/Entry';
import { Home } from '../features/room/Home';
import { Lobby } from '../features/room/Lobby';
import { RecoveryNotice } from '../features/room/RecoveryNotice';

export function App() {
  const path = usePath();
  const code = path.match(/^\/room\/(\d{6})\/?$/)?.[1] ?? null;
  const [session, setSession] = useState<Session | null>(() => (code ? loadSession(code) : null));
  const [recovery, setRecovery] = useState<string | null>(null);

  useEffect(() => { setSession(code ? loadSession(code) : null); }, [code]);
  const issued = (value: Issued) => { setSession(value); setRecovery(value.recovery_code); };

  let page;
  if (!code) page = <Home onIssued={issued} />;
  else if (!session) page = <Entry code={code} onIssued={issued} />;
  else page = <Lobby key={session.token} session={session} />;
  return <>{page}{recovery && <RecoveryNotice code={recovery} onDone={() => setRecovery(null)} />}</>;
}
