import { useEffect, useRef, useState } from 'react';
import {
  RETRY_NOW,
  UNREACHABLE,
  authenticate,
  loadOidcEnabled,
  lockedMessage,
  type Outcome,
  type SessionInfo,
} from '../session.js';
import { CredentialsView } from './CredentialsView.js';
import { text } from './Field.js';

/** Connexion ou premier démarrage : appelle l'API, puis remet la session à l'application. */
export function CredentialsPage({
  mode,
  notice,
  refusal,
  onSession,
}: {
  mode: 'login' | 'setup';
  notice?: string;
  refusal?: string;
  onSession: (session: SessionInfo) => void;
}) {
  const [error, setError] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Fin du verrouillage (horloge murale) et secondes restantes, recalculées chaque seconde.
  const [until, setUntil] = useState<number>();
  const [lockedSec, setLockedSec] = useState(0);
  const [startSec, setStartSec] = useState<number>();
  const [announcement, setAnnouncement] = useState('');
  const [microsoft, setMicrosoft] = useState(false);
  useEffect(() => {
    if (mode === 'login') void loadOidcEnabled().then(setMicrosoft);
  }, [mode]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (until === undefined) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLockedSec(left);
      if (left === 0) {
        clearInterval(timer);
        setUntil(undefined);
        setAnnouncement(RETRY_NOW);
        // Le bouton se réactive au rendu suivant ; le champ identifiant reprend le focus.
        setTimeout(() => {
          root.current?.querySelector<HTMLInputElement>('input[name="username"]')?.focus();
        }, 0);
      } else if (left % 30 === 0) setAnnouncement(lockedMessage(left));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [until]);
  const submit = (form: FormData) => {
    if (lockedSec > 0) return;
    if (mode === 'setup' && text(form, 'password') !== text(form, 'confirm')) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setRequestId(undefined);
    setAnnouncement('');
    authenticate(mode, text(form, 'username').trim(), text(form, 'password')).then(
      (outcome: Outcome<SessionInfo>) => {
        setBusy(false);
        if (outcome.ok) onSession(outcome.value);
        else if (outcome.retryAfterSec) {
          setUntil(Date.now() + outcome.retryAfterSec * 1000);
          setLockedSec(outcome.retryAfterSec);
          setStartSec(outcome.retryAfterSec);
        } else {
          setError(outcome.message);
          setRequestId(outcome.requestId);
        }
      },
      () => {
        setBusy(false);
        setError(UNREACHABLE);
      },
    );
  };
  return (
    <div ref={root} className="login-page-body">
      <CredentialsView
        mode={mode}
        error={error}
        requestId={requestId}
        notice={notice}
        refusal={refusal}
        busy={busy}
        lockedSec={lockedSec}
        lockedStartSec={startSec}
        announcement={announcement}
        microsoft={microsoft}
        onSubmit={submit}
      />
    </div>
  );
}
