import type { ReactNode } from 'react';

/** Bloc centré commun aux écrans d'accès : nom du produit, puis le contenu de l'écran. */
export function AuthBlock({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  // Dans la console (changement volontaire), la barre latérale porte déjà le nom du produit.
  if (plain) return <main tabIndex={-1}>{children}</main>;
  return (
    <main tabIndex={-1} className="auth">
      <p className="auth-brand">backup365</p>
      <p className="auth-tagline">Console de sauvegarde Microsoft 365</p>
      {children}
    </main>
  );
}
