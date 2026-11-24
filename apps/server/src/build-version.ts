/**
 * Version affichée dans le pied de page : « <version du paquet> · <commit court> » pour une image
 * construite (le commit est injecté au build, BACKUP365_BUILD_COMMIT), « dev » sinon. Jamais « 0.0.0 ».
 */
export function displayVersion(packageVersion: string, buildCommit: string | undefined): string {
  const commit = (buildCommit ?? '').trim();
  if (!/^[0-9a-f]{7}$/.test(commit) || packageVersion === '' || packageVersion === '0.0.0') {
    return 'dev';
  }
  return `${packageVersion} · ${commit}`;
}
