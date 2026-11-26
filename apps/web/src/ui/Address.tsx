/**
 * Adresse ou identifiant. Le domaine est dans son propre `<span>` : en carte (sous 900 px), le CSS
 * y ajoute une occasion de coupe, de sorte qu'une adresse trop longue se coupe après le « @ ».
 * Au bureau (900 px et plus), dans une colonne de classe `address`, une adresse de 40 caractères
 * au plus (classe `addr-short`) reste sur une ligne.
 */
const SHORT = 40;

export function Address({ value }: { value: string }) {
  const at = value.indexOf('@');
  if (at < 0) return <>{value}</>;
  // Un seul élément : la cellule est une grille en carte, le texte ne doit pas s'y scinder.
  return (
    <span className={value.length <= SHORT ? 'addr addr-short' : 'addr'}>
      <span className="addr-local">{value.slice(0, at + 1)}</span>
      <span className="addr-domain">{value.slice(at + 1)}</span>
    </span>
  );
}
