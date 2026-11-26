import { expect, test } from '@playwright/test';
import { SCREENS, bannerPages, distinctPages } from './screens.mjs';

// Tests sans navigateur ni serveur : la liste des pages que parcourt le test du bandeau du mode
// démo. Ce test ouvrait une page par capture ; sa durée approchait son délai à chaque écran ajouté.

const pageKey = (s: { hash: string; role: string | null }): string => `${s.role ?? ''} ${s.hash}`;

test('pages distinctes : une entrée par rôle et ancre, dans l’ordre de première apparition', () => {
  expect(
    distinctPages([
      { name: 'teams-choisir', hash: '#/teams', role: 'operator' },
      { name: 'teams-motif', hash: '#/teams', role: 'operator' },
      { name: 'sources', hash: '#/sources', role: 'admin' },
      { name: 'sources-operateur', hash: '#/sources', role: 'operator' },
      { name: 'connexion', hash: '', role: null },
      { name: 'teams-echec', hash: '#/teams', role: 'operator' },
    ]),
  ).toEqual([
    { name: 'teams-choisir', hash: '#/teams', role: 'operator' },
    { name: 'sources', hash: '#/sources', role: 'admin' },
    { name: 'sources-operateur', hash: '#/sources', role: 'operator' },
    { name: 'connexion', hash: '', role: null },
  ]);
});

test('bandeau du mode démo : chaque page des captures est ouverte, une seule fois', () => {
  const pages = bannerPages();
  const keys = pages.map(pageKey);
  expect(new Set(keys).size).toBe(keys.length);
  // Aucune page n'est oubliée : chaque écran clair, hors version d'image, y retrouve la sienne.
  for (const screen of SCREENS.filter((s) => !s.scheme && !s.buildCommit)) {
    expect(keys, screen.name).toContain(pageKey(screen));
  }
});

test('bandeau du mode démo : un écran de plus sur une page déjà ouverte n’ajoute aucune visite', () => {
  const before = bannerPages();
  const [known] = before;
  const more = [...SCREENS, { ...known!, name: 'ecran-de-plus', prepare: async () => {} }];
  expect(bannerPages(more)).toEqual(before);
  // Les variantes de thème et de version d'image ne sont pas visitées.
  const variants = [
    ...SCREENS,
    { name: 'page-sombre', hash: '#/page-sombre', role: 'admin' as const, scheme: 'dark' as const },
    { name: 'page-image', hash: '#/page-image', role: 'admin' as const, buildCommit: 'abc1234' },
  ];
  expect(bannerPages(variants)).toEqual(before);
});
