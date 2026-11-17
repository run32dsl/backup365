import { CONFIG_HASH, CONFIG_LINK_LABEL, type Problem } from './apiError.js';
import { Alert } from './ui/index.js';

/**
 * Erreur d'une action : le message qui dit quoi faire, un lien vers la configuration quand la
 * sauvegarde n'est pas reliée, et l'identifiant de requête en petit pour le support.
 */
export function FailureAlert({ problem }: { problem: Problem }) {
  return (
    <Alert tone="error">
      {problem.message}
      {problem.code === 'backup_not_configured' ? (
        <span className="alert-detail">
          <a href={CONFIG_HASH}>{CONFIG_LINK_LABEL}</a>
        </span>
      ) : null}
      {problem.requestId ? (
        <small className="alert-detail request-id">
          Identifiant de requête : <code>{problem.requestId}</code>
        </small>
      ) : null}
    </Alert>
  );
}
