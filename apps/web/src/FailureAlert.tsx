import type { Problem } from './apiError.js';
import { ConfigurationLink } from './ConfigurationBlock.js';
import { Alert } from './ui/index.js';

/**
 * Erreur d'une action : le message qui dit quoi faire et l'identifiant de requête en petit pour
 * le support.
 */
export function FailureAlert({ problem }: { problem: Problem }) {
  return (
    <Alert tone="error">
      {problem.message}
      {problem.code === 'backup_not_configured' ? <ConfigurationLink /> : null}
      {problem.requestId ? (
        <small className="alert-detail request-id">
          Identifiant de requête : <code>{problem.requestId}</code>
        </small>
      ) : null}
    </Alert>
  );
}
