import { useId, useState, type FormEvent } from 'react';
import {
  AUDIT_NOTICE,
  UNREACHABLE,
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
  name,
  type = 'text',
  autoComplete,
  revealed = false,
  onValue,
}: {
  label: string;
  name: string;
  type?: 'text' | 'password';
  autoComplete: string;
  revealed?: boolean;
  onValue?: (value: string) => void;
}) {
  const id = useId();
  const secret = type === 'password';
  const [shown, setShown] = useState(revealed);
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      <br />
      <input
        id={id}
        name={name}
        type={secret && !shown ? 'password' : 'text'}
        autoComplete={autoComplete}
        required
        onChange={onValue && ((e) => onValue(e.currentTarget.value))}
      />
      {secret && (
        <>
          {' '}
          <button
            type="button"
            aria-controls={id}
            aria-pressed={shown}
            aria-label={`${shown ? 'Masquer' : 'Afficher'} : ${label}`}
            onClick={() => {
              setShown(!shown);
            }}
          >
            {shown ? 'Masquer' : 'Afficher'}
          </button>
        </>
      )}
    </p>
  );
}

/** Erreur réseau ou serveur, avec le bouton « Réessayer ». */
export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <>
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>
        Réessayer
      </button>
    </>
  );
}

/**
 * Formulaire de connexion ou de création du premier administrateur. `notice` annonce une session
 * perdue (expirée ou refusée).
 */
export function CredentialsView({
  mode,
  error,
  notice,
  busy = false,
  onSubmit,
}: {
  mode: 'login' | 'setup';
  error?: string;
  notice?: string;
  busy?: boolean;
  onSubmit?: (form: FormData) => void;
}) {
  const setup = mode === 'setup';
  const [typed, setTyped] = useState('');
  return (
    <main tabIndex={-1}>
      <h1>{setup ? 'Créer le compte administrateur' : 'Connexion à la console'}</h1>
      {setup && (
        <p>
          Aucun compte n’existe encore. Ce compte gère les comptes, les plans et les restaurations.
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
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {setup ? 'Créer le compte administrateur' : 'Se connecter'}
        </button>
      </form>
      <p>{AUDIT_NOTICE}</p>
    </main>
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
  onSession,
}: {
  mode: 'login' | 'setup';
  notice?: string;
  onSession: (session: SessionInfo) => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = (form: FormData) => {
    if (mode === 'setup' && text(form, 'password') !== text(form, 'confirm')) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(undefined);
    authenticate(mode, text(form, 'username').trim(), text(form, 'password')).then(
      (outcome: Outcome<SessionInfo>) => {
        setBusy(false);
        if (!outcome.ok) setError(outcome.message);
        else onSession(outcome.value);
      },
      () => {
        setBusy(false);
        setError(UNREACHABLE);
      },
    );
  };
  return (
    <CredentialsView mode={mode} error={error} notice={notice} busy={busy} onSubmit={submit} />
  );
}

/** Changement de son mot de passe ; imposé après une réinitialisation par un administrateur. */
export function PasswordView({
  forced,
  error,
  done = false,
  onSubmit,
  onCancel,
}: {
  forced: boolean;
  error?: string;
  done?: boolean;
  onSubmit?: (form: FormData) => void;
  /** Retour sans changer (absent quand le changement est imposé). */
  onCancel?: () => void;
}) {
  return (
    <main tabIndex={-1}>
      <h1>Choisissez un nouveau mot de passe</h1>
      {forced && (
        <p>Votre mot de passe a été réinitialisé : choisissez-en un nouveau pour continuer.</p>
      )}
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
        />
        <p>12 caractères minimum. Une phrase de passe convient.</p>
        <Field
          label="Confirmer le nouveau mot de passe"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
        {error && <p role="alert">{error}</p>}
        {done && <p role="status">Mot de passe modifié.</p>}
        <button type="submit">Enregistrer et continuer</button>
        {!forced && (
          <>
            {' '}
            <button type="button" onClick={onCancel}>
              Annuler
            </button>
          </>
        )}
      </form>
    </main>
  );
}

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
  const submit = (form: FormData) => {
    if (text(form, 'next') !== text(form, 'confirm')) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    changePassword(text(form, 'current'), text(form, 'next')).then(
      (outcome) => {
        if (outcome.ok) {
          setError(undefined);
          setDone(true);
          onDone();
        } else setError(outcome.message);
      },
      () => setError(UNREACHABLE),
    );
  };
  return (
    <PasswordView forced={forced} error={error} done={done} onSubmit={submit} onCancel={onCancel} />
  );
}
