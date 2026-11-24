import { problemMessage, type Problem } from './apiError.js';
import { useAdmin } from './role.js';
import { ConfigurationLink } from './ConfigurationBlock.js';
import { Alert } from './ui/index.js';

/**
 * Erreur d'une action : le message qui dit quoi faire et l'identifiant de requête en petit pour
 * le support.
 */
export function FailureAlert({ problem }: { problem: Problem }) {
  const admin = useAdmin();
  return (
    <Alert tone="error">
      {problemMessage(problem, admin)}
      {problem.code === 'backup_not_configured' ? <ConfigurationLink /> : null}
      {problem.requestId ? (
        <small className="alert-detail request-id">
          Identifiant de requête : <code>{problem.requestId}</code>
        </small>
      ) : null}
    </Alert>
  );
}
