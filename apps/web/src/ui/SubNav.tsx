export type SubNavLink = { href: string; label: string; current: boolean };

/**
 * Sélecteur de vue d'une rubrique (source à restaurer, plans ou état des sources) : des liens
 * natifs, pas un `role="tab"`. Il défile horizontalement sous 900 px plutôt que de déborder.
 */
export function SubNav({ label, links }: { label: string; links: SubNavLink[] }) {
  return (
    <nav className="subnav" aria-label={label}>
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
