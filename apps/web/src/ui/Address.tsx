/**
 * Adresse ou identifiant. Le domaine est dans son propre `<span>` : en carte (sous 900 px), le CSS
 * y ajoute une occasion de coupe, de sorte qu'une adresse trop longue se coupe après le « @ ».
 * Au bureau (900 px et plus), dans une colonne de classe `address`, l'enveloppe `addr` garde sur
 * une ligne une adresse de 40 caractères au plus.
 */
export function Address({ value }: { value: string }) {
  const at = value.indexOf('@');
  if (at < 0) return <>{value}</>;
  // Un seul élément : la cellule est une grille en carte, le texte ne doit pas s'y scinder.
  return (
    <span className="addr">
      <span className="addr-local">{value.slice(0, at + 1)}</span>
      <span className="addr-domain">{value.slice(at + 1)}</span>
    </span>
  );
}
