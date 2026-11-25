import { AccessDenied } from '../AccessDenied.js';
import { SHAREPOINT_MESSAGES as T, sharePointHash, type Site } from '../sharepoint.js';

/** Refus de droit sur un site : situation normale, expliquée, avec une seule issue (étape « Choisir »). */
export function SiteDenied({ site }: { site: Site }) {
  return (
    <AccessDenied
      title="Restauration non autorisée"
      href={sharePointHash(site.id)}
      exit={T.chooseOther}
    >
      {T.forbiddenSite(site.displayName)}
    </AccessDenied>
  );
}
