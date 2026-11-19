import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  closeMenuOnEscape,
  ConsoleView,
  ForbiddenView,
  navEntries,
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
    const stops = [...html.matchAll(/<(a|button|main)\b[^>]*>(.*?)<\/\1>/g)].map((m) => m[2]);
    expect(stops).toEqual([
      'Aller au contenu',
      'Menu',
      'Tableau de bord',
      'Rechercher et restaurer',
      'OneDrive',
      'SharePoint',
      'Plans de protection',
      'Journal d’audit',
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
  it('lists only delivered screens, with Administration for admins only', () => {
    expect(navEntries('home', false).map((e) => e.label)).toEqual([
      'Tableau de bord',
      'Rechercher et restaurer',
      'OneDrive',
      'SharePoint',
      'Plans de protection',
      'Journal d’audit',
    ]);
    const admin = navEntries('home', true).map((e) => e.label);
    expect(admin).toHaveLength(8);
    expect(admin.slice(-2)).toEqual(['État détaillé', 'Administration']);
  });

  it('reaches the detailed status from the menu for an administrator only', () => {
    expect(navEntries('home', true).find((e) => e.label === 'État détaillé')?.href).toBe('#/etat');
    expect(screenOf('#/etat')).toBe('status');
    expect(screenFor('#/etat', true)).toBe('status');
    expect(navEntries('status', true).filter((e) => e.current)).toEqual([
      { href: '#/etat', label: 'État détaillé', current: true },
    ]);
    expect(navEntries('home', false).map((e) => e.href)).not.toContain('#/etat');
    expect(screenFor('#/etat', false)).toBe('forbidden');
  });

  it('marks exactly one entry as current, the search entry for a mail sheet', () => {
    const current = navEntries('mail', true).filter((e) => e.current);
    expect(current.map((e) => e.href)).toEqual(['#/search']);
  });
});
