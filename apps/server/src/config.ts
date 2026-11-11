/** Lit un port TCP (entier de 1 à 65535) ; lève une erreur explicite sinon. */
export function parsePort(raw: string | undefined, fallback = 3000): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT invalide : attendu un entier entre 1 et 65535');
  }
  return port;
}
