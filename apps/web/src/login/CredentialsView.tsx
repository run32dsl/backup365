import { useState, type FormEvent } from 'react';
import { FailureAlert } from '../FailureAlert.js';
import {
  AUDIT_NOTICE,
  MICROSOFT_LABEL,
  MICROSOFT_LOGIN_URL,
  formatCountdown,
  lockedMessage,
  setupRecap,
} from '../session.js';
import { Alert, Button } from '../ui/index.js';
import { AuthBlock } from './AuthBlock.js';
import { Field } from './Field.js';

/**
 * Formulaire de connexion ou de création du premier administrateur. `notice` annonce une session
 * perdue (expirée ou refusée).
 */
export function CredentialsView({
  mode,
  error,
  requestId,
  notice,
  busy = false,
  lockedSec = 0,
  lockedStartSec,
  announcement = '',
  microsoft = false,
  refusal,
  onSubmit,
}: {
  /** Refus de Microsoft au retour de la connexion : bandeau d'erreur « Accès refusé ». */
  refusal?: string;
  /** Connexion Microsoft configurée : le bouton s'affiche sous le formulaire local. */
  microsoft?: boolean;
  mode: 'login' | 'setup';
  error?: string;
  /** Identifiant de la requête refusée, à donner au support. */
  requestId?: string;
  notice?: string;
  busy?: boolean;
  /** Secondes restantes de verrouillage (0 : pas verrouillé). */
  lockedSec?: number;
  /** Durée au début du verrouillage : l'alerte la lit une fois, sans suivre le décompte. */
  lockedStartSec?: number;
  /** Texte lu par la région `status` du décompte (début, toutes les 30 s, fin). */
  announcement?: string;
  onSubmit?: (form: FormData) => void;
}) {
  const setup = mode === 'setup';
  const locked = lockedSec > 0;
  const [typed, setTyped] = useState('');
  return (
    <AuthBlock>
      <h1>{setup ? 'Créer le compte administrateur' : 'Connexion à la console'}</h1>
      {refusal && !setup && (
        <Alert tone="error" title="Accès refusé">
          <span className="alert-detail">{refusal}</span>
        </Alert>
      )}
      {locked && (
        <Alert tone="warning" title="Connexion temporairement bloquée">
          <span className="sr-only">{lockedMessage(lockedStartSec ?? lockedSec)}</span>
          <span aria-hidden="true">
            Nouvel essai possible dans{' '}
            <span className="countdown">{formatCountdown(lockedSec)}</span>.
          </span>
        </Alert>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {setup && (
        <p>
          Aucun compte n’existe encore. Ce compte gère les comptes, les plans et les restaurations.
        </p>
      )}
      {notice && <Alert tone="info">{notice}</Alert>}
      <form
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          onSubmit?.(new FormData(e.currentTarget));
        }}
      >
        <Field
          label="Identifiant"
          name="username"
          autoComplete="username"
          onValue={setup ? setTyped : undefined}
        />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
        />
        {setup && (
          <>
            <p>12 caractères minimum. Une phrase de passe convient.</p>
            <Field
              label="Confirmer le mot de passe"
              name="confirm"
              type="password"
              autoComplete="new-password"
            />
            <p role="status">{setupRecap(typed.trim())}</p>
          </>
        )}
        {error && !locked && <FailureAlert problem={{ message: error, requestId }} />}
        <Button type="submit" busy={busy} disabled={locked}>
          {setup ? 'Créer le compte administrateur' : 'Se connecter'}
        </Button>
      </form>
      {microsoft && !setup && (
        <>
          <p className="auth-or" aria-hidden="true">
            ou
          </p>
          <a className="btn btn-secondary auth-microsoft" href={MICROSOFT_LOGIN_URL}>
            {MICROSOFT_LABEL}
          </a>
        </>
      )}
      <p className="auth-audit">{AUDIT_NOTICE}</p>
    </AuthBlock>
  );
}
