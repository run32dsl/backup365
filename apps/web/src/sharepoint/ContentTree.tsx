import { useEffect, useState } from 'react';
import type { Loaded } from '../onedrive.js';
import {
  SHAREPOINT_MESSAGES as T,
  breadcrumbLevels,
  breadcrumbLink,
  fetchSiteEntries,
  type SiteEntry,
} from '../sharepoint.js';
import { EmptyState } from '../ui/index.js';
import { Problem } from './Problem.js';
import { SiteEntriesTable } from './SiteEntriesTable.js';
import { LINK_SCOPE, type Selected } from './types.js';

/**
 * Contenu du site à une date, un niveau à la fois : chaque ligne (bibliothèque, dossier ou
 * fichier) se choisit par son bouton radio ; le nom d'une bibliothèque ou d'un dossier est un lien
 * qui l'ouvre. Le chemin ouvert est le fil d'Ariane.
 */
export function ContentTree({
  siteId,
  siteName,
  snapshotId,
  path,
  selected,
  onPath,
  onSelect,
}: {
  siteId: string;
  siteName: string;
  snapshotId: string;
  path: string;
  selected: Selected | null;
  onPath: (path: string) => void;
  onSelect: (selected: Selected | null) => void;
}) {
  const [entries, setEntries] = useState<Loaded<SiteEntry[]> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setEntries(null);
    void fetchSiteEntries(siteId, snapshotId, path).then((result) => {
      if (current) setEntries(result);
    });
    return () => {
      current = false;
    };
  }, [siteId, snapshotId, path, attempt]);

  const rows = entries?.status === 'ok' ? entries.data : [];
  const go = (to: string) => {
    onSelect(null);
    onPath(to);
  };
  const crumbs = breadcrumbLevels(siteName, path);

  return (
    <>
      <nav aria-label="Fil d'Ariane">
        <ol className="breadcrumb">
          {crumbs.map((c, i) => (
            <li key={c.path}>
              {i === crumbs.length - 1 && i > 0 ? (
                <span aria-current="location">{c.label}</span>
              ) : (
                // La racine reste un lien, même ouverte (demande de l'issue #355).
                <a
                  {...breadcrumbLink(c, siteId, LINK_SCOPE, go)}
                  aria-current={i === crumbs.length - 1 ? 'location' : undefined}
                >
                  {c.label}
                </a>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div aria-busy={entries === null} aria-live="polite">
        {entries === null && <p role="status">{T.loading}</p>}
        {entries && entries.status !== 'ok' && (
          <Problem
            status={entries.status}
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {entries?.status === 'ok' && rows.length === 0 && <EmptyState>{T.emptyFolder}</EmptyState>}
        {rows.length > 0 && (
          <SiteEntriesTable
            siteId={siteId}
            rows={rows}
            selected={selected}
            onOpen={go}
            onSelect={onSelect}
          />
        )}
      </div>
    </>
  );
}
