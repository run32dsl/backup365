import { Alert, Button } from './ui/index.js';

/**
 * Stockage des sauvegardes indisponible (OneDrive, SharePoint) : un avertissement, comme
 * « Restauration indisponible » sur la fiche d'un mail, puis l'action « Réessayer ».
 */
export function StorageUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div>
      <Alert tone="warning" title="Sauvegardes inaccessibles">
        Le stockage n’est pas configuré ou ne répond pas. Prévenez un administrateur.
      </Alert>
      <Button variant="secondary" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
