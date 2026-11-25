import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Problem as OneDriveProblem } from './OneDrivePage.js';
import { Problem as SharePointProblem } from './SharePointPage.js';
import { StorageUnavailable } from './StorageUnavailable.js';
import { Button } from './ui/index.js';

// Le test appelle le composant comme une fonction, hors rendu : pas de contexte.
vi.mock('./role.js', () => ({ useAdmin: () => false }));

type Clickable = ReactElement<{ onClick?: () => void }>;

/** Premier élément de l'arbre dont le type est `type` (pas de DOM dans ces tests). */
function find(node: ReactNode, type: unknown): Clickable | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node as Clickable;
  for (const child of Children.toArray(node.props.children)) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return undefined;
}

const pages = [
  ['OneDrive', OneDriveProblem],
  ['SharePoint', SharePointProblem],
] as const;

describe.each(pages)('%s, storage unavailable', (_name, Problem) => {
  it('shows a warning alert with the icon and a bold title, not an empty state', () => {
    const html = renderToStaticMarkup(<Problem status="unconfigured" onRetry={() => undefined} />);
    expect(html).toContain('alert alert-warning');
    expect(html).toContain('role="alert"');
    expect(html).toContain('⚠');
    expect(html).toContain('<strong class="alert-title">Sauvegardes inaccessibles</strong>');
    expect(html).toContain('Le stockage n’est pas configuré ou ne répond pas');
    expect(html).not.toContain('class="empty"');
    expect(html).not.toContain('<a');
  });

  it('offers one secondary «\u202FRéessayer\u202F» button after the alert', () => {
    const html = renderToStaticMarkup(<Problem status="unconfigured" onRetry={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('btn-secondary');
    expect(html.indexOf('alert-warning')).toBeLessThan(html.indexOf('<button'));
    expect(html).toContain('Réessayer');
  });

  it('reloads the list when «\u202FRéessayer\u202F» is clicked', () => {
    const onRetry = vi.fn();
    const wired = Problem({ status: 'unconfigured', onRetry }) as ReactElement<{
      onRetry: () => void;
    }>;
    expect(wired.type).toBe(StorageUnavailable);
    find(StorageUnavailable(wired.props), Button)?.props.onClick?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('StorageUnavailable layout hook', () => {
  it('keeps «\u202FRéessayer\u202F» a direct child of .storage-unavailable (full width on mobile)', () => {
    const html = renderToStaticMarkup(StorageUnavailable({ onRetry: () => undefined }));
    expect(html).toMatch(
      /^<div class="storage-unavailable">.*<button[^>]*>Réessayer<\/button><\/div>$/s,
    );
  });
});
