import { COMPONENTS_HASH } from './routes.js';

/**
 * Pied de page : version du serveur et, en mode démo seulement, lien vers la page des
 * composants (hors navigation principale).
 */
export function ConsoleFooter({ version, demo }: { version?: string; demo: boolean }) {
  if (version === undefined && !demo) return null;
  return (
    <footer className="console-footer">
      {version !== undefined && <span className="console-footer-item">Version {version}</span>}
      {demo && (
        <span className="console-footer-item console-footer-link">
          <a href={COMPONENTS_HASH}>Composants</a>&nbsp;(démo seulement)
        </span>
      )}
    </footer>
  );
}
