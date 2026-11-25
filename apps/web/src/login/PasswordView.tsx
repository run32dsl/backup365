import type { FormEvent } from 'react';
import { Alert, Button, WizardActions } from '../ui/index.js';
import { AuthBlock } from './AuthBlock.js';
import { Field } from './Field.js';

/** Texte de la notification affichée par la console après un changement réussi. */
export const PASSWORD_CHANGED = 'Mot de passe modifié.';

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
    <AuthBlock plain={!forced}>
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
        {forced ? (
          <Button type="submit">Enregistrer et continuer</Button>
        ) : (
          <WizardActions
            back={
              <Button variant="secondary" onClick={onCancel}>
                Annuler
              </Button>
            }
          >
            <Button type="submit">Enregistrer</Button>
          </WizardActions>
        )}
      </form>
    </AuthBlock>
  );
}
