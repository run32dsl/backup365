import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<AlertTone, { icon: string; role: 'alert' | 'status' }> = {
  info: { icon: 'ℹ', role: 'status' },
  success: { icon: '✔', role: 'status' },
  warning: { icon: '⚠', role: 'alert' },
  error: { icon: '✖', role: 'alert' },
};

/** Rôle ARIA d'une alerte : `alert` pour l'erreur et l'avertissement, `status` sinon. */
export const alertRole = (tone: AlertTone): 'alert' | 'status' => TONES[tone].role;

/** Message d'alerte : icône et texte, jamais la couleur seule ; sans détail technique. */
export function Alert({
  tone,
  children,
  action,
  id,
}: {
  tone: AlertTone;
  children: ReactNode;
  /** Action proposée, par exemple « Réessayer ». */
  action?: ReactNode;
  /** Identifiant, pour qu'un contrôle le cite par `aria-describedby`. */
  id?: string;
}) {
  const { icon, role } = TONES[tone];
  return (
    <div id={id} className={`alert alert-${tone}`} role={role}>
      <span aria-hidden="true">{icon}</span>
      <span className="alert-text">{children}</span>
      {action}
    </div>
  );
}
