import { ConfigurationLink } from '../ConfigurationBlock.js';
import { problemMessage, splitTitle, type Problem } from '../apiError.js';
import { useAdmin } from '../role.js';
import { Alert } from '../ui/index.js';

/** Échec d'une action sur les plans : la phrase pour l'utilisateur, sans détail technique. */
export function PlanFailure({ problem }: { problem: Problem }) {
  const message = problemMessage(problem, useAdmin());
  // Toujours une erreur : l'action demandée n'a pas eu lieu, connexion manquante comprise (#604).
  const { title, text } =
    problem.code === 'backup_not_configured'
      ? splitTitle(message)
      : { title: undefined, text: message };
  return (
    <Alert tone="error" {...(title ? { title } : {})}>
      {text}
      {problem.code === 'backup_not_configured' ? <ConfigurationLink /> : null}
    </Alert>
  );
}
