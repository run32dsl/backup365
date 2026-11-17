import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import { RESET_TEXTS } from './accounts.js';
import { AuditReminder, REASON, ReasonField } from './RestoreJourney.js';
import { Alert, Button, Dialog } from './ui/index.js';

/** Étape 2 : récapitulatif et motif obligatoire. Sans état : le motif vide donne `error`. */
export function ResetReasonForm({
  username,
  error,
  busy = false,
  onSubmit,
  onCancel,
}: {
  username: string;
  error?: string;
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
      <p>
        Compte : <strong>{username}</strong>
      </p>
      <p>
        Un mot de passe temporaire sera créé et affiché une seule fois. {username} devra le changer
        à sa prochaine connexion.
      </p>
      <ReasonField of="de la réinitialisation" value={reason} error={error} onChange={setReason} />
      <AuditReminder extra={RESET_TEXTS.audit} />
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
  password,
  copied = false,
  copyFailed = false,
  handed = false,
  codeRef,
  onCopy,
  onHanded,
  onDone,
}: {
  password: string;
  copied?: boolean;
  copyFailed?: boolean;
  handed?: boolean;
  codeRef?: Ref<HTMLElement>;
  onCopy?: () => void;
  onHanded?: (checked: boolean) => void;
  onDone?: () => void;
}) {
  return (
    <div>
      <p>{RESET_TEXTS.once}</p>
      <div className="button-row temp-password-row">
        <code
          ref={codeRef}
          className="temp-password"
          tabIndex={0}
          role="textbox"
          aria-readonly="true"
          aria-label="Mot de passe temporaire"
        >
          {password}
        </code>
        <Button variant="secondary" onClick={onCopy}>
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
        <Button
          type="button"
          aria-disabled={!handed || undefined}
          onClick={handed ? onDone : undefined}
        >
          Terminer
        </Button>
      </div>
    </div>
  );
}

/**
 * Réinitialisation en deux boîtes successives (le choix du compte est l'étape 1, dans la page) :
 * `reset` désigne le compte ; `run` appelle l'API et rend le mot de passe ou un message d'erreur.
 * Le mot de passe ne vit que dans l'état de ce composant et disparaît à la fermeture.
 */
export function ResetPasswordDialog({
  username,
  run,
  onClose,
}: {
  username: string | null;
  run: (reason: string) => Promise<{ password: string } | { error: string }>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [handed, setHanded] = useState(false);
  const code = useRef<HTMLElement>(null);
  useEffect(() => {
    setError(undefined);
    setBusy(false);
    setPassword(undefined);
    setCopied(false);
    setCopyFailed(false);
    setHanded(false);
  }, [username]);
  // Étape 3 : le focus va sur le mot de passe.
  useEffect(() => {
    if (password !== undefined) code.current?.focus();
  }, [password]);

  const copy = () => {
    if (password === undefined) return;
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
    <Dialog
      open={username !== null}
      title={password === undefined ? RESET_TEXTS.title : RESET_TEXTS.resultTitle}
      // Échap et « Fermer » restent sans effet tant que la case n'est pas cochée.
      onClose={password === undefined || handed ? onClose : () => undefined}
    >
      {password === undefined ? (
        <ResetReasonForm
          username={username ?? ''}
          error={error}
          busy={busy}
          onCancel={onClose}
          onSubmit={(reason) => {
            if (busy) return;
            if (!reason) {
              setError(REASON.error);
              return;
            }
            setError(undefined);
            setBusy(true);
            void run(reason).then((result) => {
              setBusy(false);
              if ('password' in result) setPassword(result.password);
              else setError(result.error);
            });
          }}
        />
      ) : (
        <TemporaryPasswordView
          password={password}
          copied={copied}
          copyFailed={copyFailed}
          handed={handed}
          codeRef={code}
          onCopy={copy}
          onHanded={setHanded}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}
