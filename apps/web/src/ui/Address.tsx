/**
 * Adresse ou identifiant. Le domaine est dans son propre `<span>` : en carte (sous 900 px), le CSS
 * y ajoute une occasion de coupe, de sorte qu'une adresse trop longue se coupe après le « @ ».
 */
export function Address({ value }: { value: string }) {
  const at = value.indexOf('@');
  if (at < 0) return <>{value}</>;
  // Un seul élément : la cellule est une grille en carte, le texte ne doit pas s'y scinder.
  return (
    <span className={value.length > 40 ? 'addr-long' : undefined}>
      <span className="addr-local">{value.slice(0, at + 1)}</span>
      <span className="addr-domain">{value.slice(at + 1)}</span>
    </span>
  );
}
