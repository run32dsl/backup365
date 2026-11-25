import { useEffect, useRef } from 'react';

export type SubNavLink = { href: string; label: string; current: boolean };

/**
 * Sélecteur de vue d'une rubrique (source à restaurer, plans ou état des sources) : des liens
 * natifs, pas un `role="tab"`. Les libellés passent à la ligne sous 900 px ; si la barre déborde
 * malgré tout, l'entrée active est ramenée dans la zone visible au chargement.
 */
export function SubNav({ label, links }: { label: string; links: SubNavLink[] }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    if (el && el.scrollWidth > el.clientWidth) {
      el.querySelector('[aria-current="page"]')?.scrollIntoView?.({
        inline: 'nearest',
        block: 'nearest',
      });
    }
  }, [links]);
  return (
    <nav className="subnav" aria-label={label} ref={nav}>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} aria-current={l.current ? 'page' : undefined}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Les trois sources de restauration, dans cet ordre. */
export function RestoreSourceNav({ current }: { current: 'mail' | 'onedrive' | 'sharepoint' }) {
  return (
    <SubNav
      label="Source à restaurer"
      links={[
        { href: '#/search', label: 'Mails', current: current === 'mail' },
        { href: '#/onedrive', label: 'Fichiers OneDrive', current: current === 'onedrive' },
        { href: '#/sharepoint', label: 'Sites SharePoint', current: current === 'sharepoint' },
      ]}
    />
  );
}

/** Vues de « Sources » : les plans pour tous, l'état des sources pour les administrateurs. */
export function SourcesNav({ current, admin }: { current: 'plans' | 'status'; admin: boolean }) {
  if (!admin) return null;
  return (
    <SubNav
      label="Vue des sources"
      links={[
        { href: '#/plans', label: 'Plans de protection', current: current === 'plans' },
        { href: '#/sources', label: 'État des sources', current: current === 'status' },
      ]}
    />
  );
}
