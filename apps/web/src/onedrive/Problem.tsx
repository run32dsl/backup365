import { StorageUnavailable } from '../StorageUnavailable.js';
import { ONEDRIVE_MESSAGES as T } from '../onedrive.js';
import { Button, EmptyState } from '../ui/index.js';

export function Problem({
  status,
  onRetry,
}: {
  status: 'unconfigured' | 'no_backup' | 'error';
  onRetry: () => void;
}) {
  if (status === 'unconfigured') {
    return <StorageUnavailable onRetry={onRetry} />;
  }
  if (status === 'no_backup') {
    return (
      <EmptyState action={<a href="#/">Voir l’état des sauvegardes</a>}>{T.noBackup}</EmptyState>
    );
  }
  return (
    <div role="alert" className="empty">
      <p>{T.readError}</p>
      <Button onClick={onRetry}>Réessayer</Button>
    </div>
  );
}
