import { lazy, Suspense, useEffect, useState } from 'react';
import { usePath } from '../lib/router';
import { loadSession, type StoredSession } from '../lib/session';
import { Entry } from '../features/room/Entry';
import { Home } from '../features/room/Home';
import { Lobby } from '../features/room/Lobby';
const QuoridorPreview = lazy(() => import('../features/quoridor/QuoridorPreview').then(module => ({ default: module.QuoridorPreview })));
const BombPassPreview = lazy(() => import('../features/bomb-pass/BombPassPreview').then(module => ({ default: module.BombPassPreview })));

export function App() {
  const path = usePath();
  const code = path.match(/^\/room\/(\d{6})\/?$/)?.[1] ?? null;
  const [session, setSession] = useState<StoredSession | null>(() => (code ? loadSession(code) : null));
  useEffect(() => { setSession(code ? loadSession(code) : null); }, [code]);

  if (path === '/quoridor-preview') return <Suspense fallback={<main style={{ minHeight: '100vh', background: '#0c1119', color: '#f7f2eb', padding: 32 }}>3D 게임판을 준비하고 있습니다…</main>}><QuoridorPreview /></Suspense>;
  if (path === '/bomb-pass-preview') return <Suspense fallback={<main>폭탄 돌리기 미리보기를 준비하고 있어요…</main>}><BombPassPreview /></Suspense>;
  if (path === '/bomb-pass/local') return <Suspense fallback={<main>폭탄 돌리기 현장 모드를 준비하고 있어요…</main>}><BombPassPreview local /></Suspense>;
  if (!code) return <Home onIssued={(issued, nickname) => setSession({ ...issued, nickname })} />;
  if (!session) return <Entry code={code} onIssued={(issued, nickname) => setSession({ ...issued, nickname })} />;
  return <Lobby key={session.token} session={session} />;
}
