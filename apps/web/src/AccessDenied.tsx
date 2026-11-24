import type { ReactNode } from 'react';
import { Alert } from './ui/index.js';

/**
 * Refus de droit : un avertissement à intitulé en gras, comme « Sauvegardes inaccessibles »,
 * puis un seul lien-bouton de sortie. Jamais un état vide : le refus n'est pas « rien ici ».
 */
export function AccessDenied({
  title,
  href,
  exit,
  children,
}: {
  title: string;
  href: string;
  exit: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Alert tone="warning" title={title}>
        {children}
      </Alert>
      <a className="btn btn-secondary access-denied-exit" href={href}>
        {exit}
      </a>
    </div>
  );
}
