import { useState } from 'react';

/** Shown once after join/recovery. The code is never stored by the app. */
export function RecoveryNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <div className="card">
        <h2 id="recovery-title">개인 복구 코드</h2>
        <p>다른 기기에서 이어서 참가할 때 필요해요. <strong>지금 한 번만 보여드려요.</strong> 다른 사람에게 보여주지 마세요.</p>
        <p className="recovery" aria-label="복구 코드">{code}</p>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } }}>
          {copied ? '복사했어요' : '복사하기'}
        </button>
        <button type="button" className="primary" onClick={onDone}>저장했어요</button>
      </div>
    </div>
  );
}
