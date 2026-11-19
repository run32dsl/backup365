import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FailureAlert } from './FailureAlert.js';
import { Alert, Button, FormField, WizardActions } from './ui/index.js';
import {
  AUDIT_NOTICE,
  RETRY_NOW,
  lockedMessage,
  formatCountdown,
  UNREACHABLE,
  MICROSOFT_LABEL,
  MICROSOFT_LOGIN_URL,
  loadOidcEnabled,
  authenticate,
  setupRecap,
  changePassword,
  type Outcome,
  type SessionInfo,
} from './session.js';

/**
 * Champ de formulaire : étiquette visible, jamais de valeur préremplie. Un champ de mot de passe
 * porte un bouton « Afficher » / « Masquer » ; `revealed` fixe son état initial.
 */
export function Field({
  label,
  help,
  name,
  type = 'text',
  autoComplete,
  revealed = false,
  onValue,
}: {
  label: string;
  help?: string;
  name: string;
  type?: 'text' | 'password';
  autoComplete: string;
  revealed?: boolean;
  onValue?: (value: string) => void;
}) {
  const secret = type === 'password';
  const [shown, setShown] = useState(revealed);
  return (
    <FormField
      label={label}
      help={help}
      name={name}
      type={secret && !shown ? 'password' : 'text'}
      autoComplete={autoComplete}
      required
      onChange={onValue && ((e) => onValue(e.currentTarget.value))}
      adornment={(id) =>
        secret && (
          <Button
            variant="secondary"
            aria-controls={id}
            aria-pressed={shown}
            aria-label={`${shown ? 'Masquer' : 'Afficher'} : ${label}`}
            onClick={() => {
              setShown(!shown);
            }}
          >
            {shown ? 'Masquer' : 'Afficher'}
          </Button>
        )
      }
    />
  );
}

/** Erreur réseau ou serveur, avec le bouton « Réessayer ». */
export function ErrorView({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string | undefined;
  onRetry?: () => void;
}) {
  return (
    <Alert
      tone="error"
      action={
        <Button variant="secondary" onClick={onRetry}>
          Réessayer
        </Button>
      }
    >
      {message}
      {requestId ? (
        <small className="alert-detail request-id">
          Identifiant de requête : <code>{requestId}</code>
        </small>
      ) : null}
    </Alert>
  );
}

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
    <>
      <div className="login-brand">
        <p className="login-brand-name">backup365</p>
        <p className="login-brand-tagline">Console de sauvegarde Microsoft 365</p>
      </div>
      <main className="login-card" tabIndex={-1}>
        <h1>{setup ? 'Créer le compte administrateur' : 'Connexion à la console'}</h1>
        {refusal && !setup && (
          <Alert tone="error">
            <strong className="alert-title">Accès refusé</strong>
            <span className="alert-detail">{refusal}</span>
          </Alert>
        )}
        {locked && (
          <Alert tone="warning">
            <span className="sr-only">{lockedMessage(lockedStartSec ?? lockedSec)}</span>
            <span aria-hidden="true">
              Connexion impossible pour le moment. Nouvel essai possible dans{' '}
              <span className="countdown">{formatCountdown(lockedSec)}</span>.
            </span>
          </Alert>
        )}
        <p className="sr-only" role="status">
          {announcement}
        </p>
        {setup && (
          <p>
            Aucun compte n’existe encore. Ce compte gère les comptes, les plans et les
            restaurations.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
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
            <p className="login-or">ou</p>
            <a className="btn btn-secondary" href={MICROSOFT_LOGIN_URL}>
              {MICROSOFT_LABEL}
            </a>
          </>
        )}
        <p className="login-audit">{AUDIT_NOTICE}</p>
      </main>
    </>
  );
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

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

/**
 * Changement de son mot de passe ; imposé après une réinitialisation par un administrateur (titre
 * propre à ce cas). `saved` affiche la confirmation sous le titre de la page volontaire.
 */
export function PasswordView({
  forced,
  error,
  saved = false,
  onSubmit,
  onCancel,
}: {
  forced: boolean;
  error?: string;
  saved?: boolean;
  onSubmit?: (form: FormData) => void;
  /** Retour sans changer (absent quand le changement est imposé). */
  onCancel?: () => void;
}) {
  return (
    <main tabIndex={-1}>
      <h1>{forced ? 'Choisissez un nouveau mot de passe' : 'Mot de passe'}</h1>
      {forced ? (
        <p>Votre mot de passe est temporaire. Choisissez-en un nouveau pour continuer.</p>
      ) : (
        <p>Changez le mot de passe de votre compte de la console.</p>
      )}
      {saved && <Alert tone="success">{PASSWORD_CHANGED}</Alert>}
      <form
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          onSubmit?.(new FormData(e.currentTarget));
        }}
      >
        <Field
          label="Mot de passe actuel"
          name="current"
          type="password"
          autoComplete="current-password"
        />
        <Field
          label="Nouveau mot de passe"
          name="next"
          type="password"
          autoComplete="new-password"
          help="12 caractères minimum. Une phrase de passe convient."
        />

        <Field
          label="Confirmer le nouveau mot de passe"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
        {error && <Alert tone="error">{error}</Alert>}
        <WizardActions
          back={
            !forced && (
              <Button variant="secondary" onClick={onCancel}>
                Annuler
              </Button>
            )
          }
        >
          <Button type="submit">{forced ? 'Enregistrer et continuer' : 'Enregistrer'}</Button>
        </WizardActions>
      </form>
    </main>
  );
}

/** Texte de la notification affichée par la console après un changement réussi. */
export const PASSWORD_CHANGED = 'Mot de passe modifié.';

/**
 * Change le mot de passe puis rend la main (`onDone`) : l'appelant redirige et affiche la
 * confirmation. Le formulaire rempli n'est plus montré après le succès.
 */
export function PasswordPage({
  forced,
  onDone,
  onCancel,
}: {
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const submit = (form: FormData) => {
    setConfirmed(false);
    if (text(form, 'next') !== text(form, 'confirm')) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    changePassword(text(form, 'current'), text(form, 'next')).then(
      (outcome) => {
        if (outcome.ok) {
          setError(undefined);
          // Imposé : l'appelant ouvre la console. Volontaire : on reste sur la page, formulaire
          // vidé (remonté par sa clé), confirmation sous le titre.
          if (forced) setDone(true);
          else {
            setSaved((n) => n + 1);
            setConfirmed(true);
          }
          onDone();
        } else setError(outcome.message);
      },
      () => setError(UNREACHABLE),
    );
  };
  if (done) {
    return (
      <main tabIndex={-1}>
        <p role="status">Ouverture de la console…</p>
      </main>
    );
  }
  return (
    <PasswordView
      key={saved}
      forced={forced}
      error={error}
      saved={confirmed}
      onSubmit={submit}
      onCancel={onCancel}
    />
  );
}
