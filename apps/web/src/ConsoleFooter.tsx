import { COMPONENTS_HASH } from './routes.js';

/**
 * Pied de page : version du serveur et, en mode démo seulement, lien vers la page des
 * composants (hors navigation principale).
 */
export function ConsoleFooter({ version, demo }: { version?: string; demo: boolean }) {
  if (version === undefined && !demo) return null;
  return (
    <footer className="console-footer">
      {version !== undefined && <span>Version {version}</span>}
      {demo && (
        <>
          {version !== undefined && ' · '}
          <a href={COMPONENTS_HASH}>Composants</a> (démo seulement)
        </>
      )}
    </footer>
  );
}
