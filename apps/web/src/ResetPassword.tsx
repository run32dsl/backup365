import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import { RESET_TEXTS } from './accounts.js';
import type { Problem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { REASON, REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import { Alert, Button, Dialog, ResultList } from './ui/index.js';

/** Étape 2 : récapitulatif et motif obligatoire. Sans état : le motif vide donne `error`. */
export function ResetReasonForm({
  username,
  error,
  failure,
  busy = false,
  onSubmit,
  onCancel,
}: {
  username: string;
  error?: string;
  failure?: Problem | undefined;
  busy?: boolean;
  onSubmit?: (reason: string) => void;
  onCancel?: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit?.(reason.trim());
      }}
    >
      <ResultList rows={[['Compte', username]]} />
      <p>
        Un mot de passe temporaire sera créé et affiché une seule fois. Ce compte devra le changer à
        sa prochaine connexion.
      </p>
      <ReasonField
        of="de la réinitialisation"
        placeholder={REASON_EXAMPLES.resetPassword}
        value={reason}
        error={error}
        onChange={setReason}
      />
      {failure && <FailureAlert problem={failure} />}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" busy={busy}>
          Réinitialiser
        </Button>
      </div>
    </form>
  );
}

/** Étape 3 : le mot de passe temporaire, « Copier », et la case qui autorise la fermeture. */
export function TemporaryPasswordView({
  username,
  password,
  copied = false,
  copyFailed = false,
  handed = false,
  copyRef,
  onCopy,
  onHanded,
  onDone,
}: {
  username: string;
  password: string;
  copied?: boolean;
  copyFailed?: boolean;
  handed?: boolean;
  copyRef?: Ref<HTMLButtonElement>;
  onCopy?: () => void;
  onHanded?: (checked: boolean) => void;
  onDone?: () => void;
}) {
  return (
    <div>
      <ResultList rows={[['Compte', username]]} />
      <p>{RESET_TEXTS.once}</p>
      <div className="button-row temp-password-row">
        <code className="temp-password" role="group" aria-label="Mot de passe temporaire">
          {password}
        </code>
        <Button variant="secondary" ref={copyRef} onClick={onCopy}>
          {copied ? 'Copié' : 'Copier'}
        </Button>
        <span role="status">
          {copied && (
            <>
              <span aria-hidden="true">✓ </span>
              Mot de passe copié
            </>
          )}
        </span>
      </div>
      {copyFailed && <Alert tone="warning">{RESET_TEXTS.copyFailed}</Alert>}
      <p className="field-help">La boîte ne se ferme qu’après avoir coché la case ci-dessous.</p>
      <div className="field">
        <label className="choice">
          <input
            type="checkbox"
            checked={handed}
            onChange={(e) => onHanded?.(e.currentTarget.checked)}
          />
          {RESET_TEXTS.handed}
        </label>
      </div>
      <div className="button-row dialog-actions">
        <Button type="button" disabled={!handed} onClick={onDone}>
          Terminer
        </Button>
      </div>
    </div>
  );
}

/**
 * Étape « mot de passe temporaire », commune à la création et à la réinitialisation : copie,
 * focus sur « Copier » et case « J'ai transmis le mot de passe ». `onHanded` informe la
 * boîte, qui n'est fermable qu'une fois la case cochée. Le mot de passe ne vit que dans l'état
 * de l'appelant et disparaît à la fermeture.
 */
export function TemporaryPasswordStep({
  username,
  password,
  onHanded,
  onDone,
}: {
  username: string;
  password: string;
  onHanded: (handed: boolean) => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [handed, setHanded] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    copyButton.current?.focus();
  }, []);
  const copy = () => {
    // `navigator.clipboard` est absent hors contexte sécurisé (console en HTTP) : même message.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(password))
      .then(
        () => {
          setCopied(true);
          setCopyFailed(false);
        },
        () => {
          setCopied(false);
          setCopyFailed(true);
        },
      );
  };
  return (
    <TemporaryPasswordView
      username={username}
      password={password}
      copied={copied}
      copyFailed={copyFailed}
      handed={handed}
      copyRef={copyButton}
      onCopy={copy}
      onHanded={(checked) => {
        setHanded(checked);
        onHanded(checked);
      }}
      onDone={onDone}
    />
  );
}

/**
 * Réinitialisation en deux boîtes successives (le choix du compte est l'étape 1, dans la page) :
 * `reset` désigne le compte ; `run` appelle l'API et rend le mot de passe ou un message d'erreur.
 */
export function ResetPasswordDialog({
  username,
  run,
  onClose,
}: {
  username: string | null;
  run: (reason: string) => Promise<{ password: string } | { error: Problem }>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string>();
  const [handed, setHanded] = useState(false);
  useEffect(() => {
    setError(undefined);
    setFailure(undefined);
    setBusy(false);
    setPassword(undefined);
    setHanded(false);
  }, [username]);

  return (
    <Dialog
      open={username !== null}
      title={password === undefined ? RESET_TEXTS.title : RESET_TEXTS.resultTitle}
      // Ni « ✕ » ni Échap tant que la case n'est pas cochée.
      dismissible={password === undefined || handed}
      onClose={onClose}
    >
      {password === undefined ? (
        <ResetReasonForm
          username={username ?? ''}
          error={error}
          failure={failure}
          busy={busy}
          onCancel={onClose}
          onSubmit={(reason) => {
            if (busy) return;
            if (!reason) {
              setError(REASON.error);
              return;
            }
            setError(undefined);
            setFailure(undefined);
            setBusy(true);
            void run(reason).then((result) => {
              setBusy(false);
              if ('password' in result) setPassword(result.password);
              else setFailure(result.error);
            });
          }}
        />
      ) : (
        <TemporaryPasswordStep
          username={username ?? ''}
          password={password}
          onHanded={setHanded}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}
