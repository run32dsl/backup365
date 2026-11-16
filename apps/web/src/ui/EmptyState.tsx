import type { ReactNode } from 'react';

/** État vide : une phrase claire et, au plus, un bouton d'action. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <p>{children}</p>
      {action}
    </div>
  );
}
