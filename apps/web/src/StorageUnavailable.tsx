import { ADMIN_RETRY } from './apiError.js';
import { useAdmin } from './role.js';
import { Alert, Button } from './ui/index.js';

/**
 * Stockage des sauvegardes indisponible (OneDrive, SharePoint) : un avertissement, comme
 * « Restauration indisponible » sur la fiche d'un mail, puis l'action « Réessayer ». Un
 * administrateur reçoit la conduite à tenir, pas le conseil de se prévenir lui-même.
 */
export function StorageUnavailable({ onRetry }: { onRetry: () => void }) {
  const admin = useAdmin();
  return (
    <div className="storage-unavailable">
      <Alert tone="warning" title="Sauvegardes inaccessibles">
        Le stockage n’est pas configuré ou ne répond pas.{' '}
        {admin ? ADMIN_RETRY : 'Prévenez un administrateur.'}
      </Alert>
      <Button variant="secondary" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
