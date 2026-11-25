import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  closeMenuOnEscape,
  ConsoleView,
  ForbiddenView,
  MAX_ADMIN_NAV_ENTRIES,
  navEntries,
  redirectLegacyHash,
  screenFor,
  screenOf,
  skipToContent,
} from './App.js';

describe('skip link target', () => {
  it('renders the screen main as a focusable target', () => {
    expect(renderToString(<ForbiddenView />)).toContain('<main tabindex="-1"');
  });
});

type El = { type?: unknown; props: { children?: unknown; [k: string]: unknown } };

/** Éléments de l'arbre rendu par `ConsoleView`, dans l'ordre du document. */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    out.push(el);
    elements(el.props.children, out);
  }
  return out;
}

const user = { id: 1, username: 'marie', role: 'operator' as const, mustChangePassword: false };

function view(menuOpen: boolean, handlers: Partial<Parameters<typeof ConsoleView>[0]> = {}) {
  return (
    <ConsoleView
      user={user}
      entries={navEntries('home', false)}
      menuOpen={menuOpen}
      onToggleMenu={() => undefined}
      onCloseMenu={() => undefined}
      onLogout={() => undefined}
      {...handlers}
    >
      <main tabIndex={-1}>Contenu</main>
    </ConsoleView>
  );
}

const tree = (menuOpen: boolean, handlers?: Parameters<typeof view>[1]) =>
  elements(ConsoleView(view(menuOpen, handlers).props));

const byClass = (els: El[], name: string) => els.find((e) => e.props.className === name)!;

describe('confirmation after a password change', () => {
  it('shows the flash as a status alert above the screen, and nothing without it', () => {
    const html = renderToString(view(false, { flash: 'Mot de passe modifié.' }));
    expect(html).toMatch(/role="status"[^>]*>.*Mot de passe modifié\./);
    expect(html.indexOf('Mot de passe modifié.')).toBeLessThan(html.indexOf('Contenu'));
    expect(renderToString(view(false))).toContain('<div role="status"></div>');
  });
});

describe('password link', () => {
  it('is current only on the password page', () => {
    const on = renderToString(view(false, { passwordCurrent: true }));
    expect(on).toContain('<a href="#/password" aria-current="page">Mot de passe</a>');
    expect(renderToString(view(false))).not.toContain('href="#/password" aria-current');
  });
});

describe('keyboard path of the console', () => {
  it('tabs through skip link, Menu, nav entries, account links, then the content', () => {
    const html = renderToString(view(true));
    const stops = [...html.matchAll(/<(a|button|main)\b[^>]*>(.*?)<\/\1>/g)].map((m) =>
      m[2]!.replace(/<[^>]*>/g, ''),
    );
    expect(stops).toEqual([
      'Aller au contenu',
      'Menu',
      '⌂Accueil',
      '▤Sources',
      '↺Restaurer',
      '≡Activités',
      'Mot de passe',
      'Se déconnecter',
      'Contenu',
    ]);
  });

  it('relies on native focusable elements only, with no positive tabindex', () => {
    const els = tree(true);
    const handled = els.filter((e) => typeof e.props.onClick === 'function');
    expect(handled.map((e) => e.type)).toEqual(['a', 'button', 'button']);
    expect(els.filter((e) => e.type === 'a').every((e) => typeof e.props.href === 'string')).toBe(
      true,
    );
    expect(renderToString(view(true))).not.toMatch(/tabindex="[1-9]/);
  });

  it('moves focus to the main content from the skip link, without changing the anchor', () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();
    const querySelector = vi.fn((selector: string) => (selector === 'main' ? { focus } : null));
    vi.stubGlobal('document', { querySelector });
    try {
      (byClass(tree(false), 'skip-link').props.onClick as (e: unknown) => void)({ preventDefault });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(querySelector).toHaveBeenCalledWith('main');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('does not fail when no main is rendered yet', () => {
    expect(() => {
      skipToContent({ preventDefault: () => undefined }, { querySelector: () => null });
    }).not.toThrow();
  });

  it('toggles the menu from the Menu button and exposes its state', () => {
    const onToggleMenu = vi.fn();
    const toggle = byClass(tree(false, { onToggleMenu }), 'menu-toggle');
    expect(toggle.type).toBe('button');
    (toggle.props.onClick as () => void)();
    expect(onToggleMenu).toHaveBeenCalledOnce();

    const closed = renderToString(view(false));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('data-open="false"');
    const open = renderToString(view(true));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="sidebar-menu"');
    expect(open).toMatch(/id="sidebar-menu"[^>]*data-open="true"/);
  });

  it('closes the open menu on Escape and gives focus back to the Menu button', () => {
    const onCloseMenu = vi.fn();
    const focus = vi.fn();
    const querySelector = vi.fn((selector: string) =>
      selector === '.menu-toggle' ? { focus } : null,
    );
    const onKeyDown = byClass(tree(true, { onCloseMenu }), 'sidebar').props.onKeyDown as (
      e: unknown,
    ) => void;
    onKeyDown({ key: 'Tab', currentTarget: { querySelector } });
    expect(onCloseMenu).not.toHaveBeenCalled();
    onKeyDown({ key: 'Escape', currentTarget: { querySelector } });
    expect(onCloseMenu).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('ignores Escape while the menu is closed', () => {
    const close = vi.fn();
    const focus = vi.fn();
    closeMenuOnEscape(
      { key: 'Escape', currentTarget: { querySelector: () => ({ focus }) } },
      false,
      close,
    );
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('navEntries', () => {
  const top = (admin: boolean) => navEntries('home', admin).map((e) => e.label);
  const current = (screen: Parameters<typeof navEntries>[0]) =>
    navEntries(screen, true)
      .filter((e) => e.current)
      .map((e) => e.label);

  it('keeps five entries for an administrator and four for an operator', () => {
    expect(top(true)).toEqual(['Accueil', 'Sources', 'Restaurer', 'Activités', 'Réglages']);
    expect(top(false)).toEqual(['Accueil', 'Sources', 'Restaurer', 'Activités']);
    expect(navEntries('home', true).map((e) => e.href)).toEqual([
      '#/',
      '#/plans',
      '#/search',
      '#/activites',
      '#/comptes',
    ]);
    expect(navEntries('home', true).every((e) => e.icon.length > 0)).toBe(true);
  });

  it('reaches the source status from Sources and the accounts from Réglages, for administrators', () => {
    expect(screenOf('#/sources')).toBe('status');
    expect(screenFor('#/sources', true)).toBe('status');
    expect(screenFor('#/sources', false)).toBe('forbidden');
    expect(screenFor('#/comptes', false)).toBe('forbidden');
    expect(current('status')).toEqual(['Sources']);
    expect(current('plans')).toEqual(['Sources']);
    expect(current('accounts')).toEqual(['Réglages']);
    expect(current('forbidden')).toEqual(['Réglages']);
  });

  it('redirects the former #/etat address to #/sources', () => {
    expect(redirectLegacyHash('#/etat')).toBe('#/sources');
    expect(redirectLegacyHash('#/sources')).toBeNull();
    expect(redirectLegacyHash('#/audit')).toBeNull();
  });

  it('keeps at most 5 entries for an administrator, on every screen', () => {
    const screens = ['home', 'search', 'mail', 'onedrive', 'sharepoint', 'plans', 'audit'] as const;
    for (const screen of [...screens, 'status', 'accounts', 'forbidden'] as const) {
      expect(navEntries(screen, true).length).toBeLessThanOrEqual(MAX_ADMIN_NAV_ENTRIES);
    }
    expect(MAX_ADMIN_NAV_ENTRIES).toBe(5);
  });

  it('keeps Restaurer current on the search, the mail sheet, OneDrive and SharePoint', () => {
    for (const screen of ['search', 'mail', 'onedrive', 'sharepoint'] as const) {
      expect(current(screen)).toEqual(['Restaurer']);
    }
    expect(current('home')).toEqual(['Accueil']);
    expect(current('audit')).toEqual(['Activités']);
  });

  it('renders only native links, with the icon hidden from assistive technology', () => {
    const html = renderToString(view(true, { entries: navEntries('onedrive', false) }));
    expect(html).toContain('<a href="#/search" aria-current="page">');
    expect(html).toContain('<span class="nav-icon" aria-hidden="true">↺</span>');
    expect(html).toContain('<span class="nav-label">Restaurer</span>');
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(nav).not.toMatch(/<button/);
    expect([...nav.matchAll(/<a\b[^>]*>/g)].every((m) => m[0].includes('href="#/'))).toBe(true);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
