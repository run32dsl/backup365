import { useState } from 'react';
import { Alert, Button, FormField } from '../ui/index.js';

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

/** Valeur texte d'un champ de formulaire ; chaîne vide s'il est absent. */
export const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
