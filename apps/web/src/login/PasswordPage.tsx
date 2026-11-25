import { useState } from 'react';
import { UNREACHABLE, changePassword } from '../session.js';
import { text } from './Field.js';
import { PasswordView } from './PasswordView.js';

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
      <div className="login-page-body">
        <main tabIndex={-1}>
          <p role="status">Ouverture de la console…</p>
        </main>
      </div>
    );
  }
  const view = (
    <PasswordView
      key={saved}
      forced={forced}
      error={error}
      saved={confirmed}
      onSubmit={submit}
      onCancel={onCancel}
    />
  );
  // Imposé : même mise en page que la connexion (bloc à la même hauteur, version dessous).
  return forced ? <div className="login-page-body">{view}</div> : view;
}
