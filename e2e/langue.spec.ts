import { writeFileSync } from 'node:fs';
import { chromium, type Browser } from '@playwright/test';
import { DEFAULT_LANG, launchOptions, requestedLang, signInAs } from './browser.mjs';
import { expect, test } from './fixtures.js';
import { SCREENS, WIDTHS } from './screens.mjs';

/**
 * Les filtres de date ne dépendent pas de la langue du navigateur (issue #234). Deux preuves :
 *
 * 1. le formulaire ne contient aucun champ de date natif (`date`, `datetime-local`, `time`…), seul
 *    élément dont le navigateur choisit le gabarit (« mm/dd/yyyy », « --:-- ») ; cette preuve
 *    vaut pour tout navigateur ;
 * 2. chaque écran à filtres est photographié dans un Chromium lancé en français, puis en anglais
 *    (`--lang=en-US`), et les deux images du formulaire sont identiques au pixel près.
 *
 * La seconde ne distingue les langues que si le navigateur en a plusieurs : un Chromium installé
 * avec la seule ressource `en-US.pak` (conteneurs des agents) affiche ses champs natifs en
 * « mm/dd/yyyy » quels que soient `--lang` et `locale`. Le test « témoin » le dit au lieu de le
 * taire.
 */
const FILTER_SCREENS = [
  'recherche',
  'recherche-date-invalide',
  'journal-audit',
  'journal-audit-date-invalide',
];
const LANGS = [DEFAULT_LANG, 'en-US'];
/** Gabarits des champs de date natifs : aucun ne doit apparaître, dans aucune langue. */
const NATIVE_HINTS = /mm\/dd\/yyyy|yyyy|--:--|\(exclu\)/u;
/** Champs dont le navigateur choisit le gabarit selon sa langue. */
const NATIVE_DATE_INPUTS = ['date', 'datetime-local', 'time', 'month', 'week']
  .map((type) => `input[type="${type}"]`)
  .join(', ');

test('requestedLang lit --lang, puis BACKUP365_LANG, et refuse une balise mal formée', () => {
  expect(requestedLang(['--lang=en-US'], {})).toBe('en-US');
  expect(requestedLang(['--lang=en-US'], { BACKUP365_LANG: 'de-DE' })).toBe('en-US');
  expect(requestedLang([], { BACKUP365_LANG: 'de-DE' })).toBe('de-DE');
  expect(requestedLang([], {})).toBeUndefined();
  expect(() => requestedLang(['--lang=anglais'], {})).toThrow(/fr-FR ou en-US/u);
  expect(launchOptions({}, 'en-US').args).toContain('--lang=en-US');
  expect(launchOptions({ BACKUP365_LANG: 'en-US' }).args).toContain('--lang=en-US');
  expect(launchOptions({}).args.join(' ')).not.toContain('--lang');
});

test.describe('filtres de date identiques en français et en anglais', () => {
  const browsers = new Map<string, Browser>();

  test.beforeAll(async () => {
    for (const lang of LANGS) {
      browsers.set(lang, await chromium.launch(launchOptions(process.env, lang)));
    }
  });
  test.afterAll(async () => {
    for (const browser of browsers.values()) await browser.close();
  });

  /** Photo du formulaire de filtres d'un écran, et ce que le formulaire donne à lire. */
  async function shoot(lang: string, name: string, width: number, baseURL: string) {
    const screen = SCREENS.find((s) => s.name === name);
    if (!screen?.role) throw new Error(`Écran à filtres inconnu : ${name}`);
    const context = await browsers.get(lang)!.newContext({
      viewport: { width, height: 800 },
      baseURL,
      locale: lang,
      timezoneId: 'UTC',
    });
    try {
      await signInAs(context, baseURL, screen.role);
      const page = await context.newPage();
      await page.goto(`/${screen.hash}`);
      await page.locator('main').waitFor();
      await screen.prepare?.(page);
      const form = page.locator('form.filters');
      // Photo de la page entière, découpée au formulaire, depuis le haut de la page : une photo
      // de l'élément dépend du défilement laissé par le clic (lissage des coins différent d'une
      // prise à l'autre, dans une même langue).
      await page.evaluate(() => window.scrollTo(0, 0));
      const clip = await form.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return {
        language: await page.evaluate(() => navigator.language),
        text: await form.innerText(),
        types: await form
          .getByLabel(/^(Du|Au) \(UTC\)$/u)
          .evaluateAll((els) => els.map((el) => el.getAttribute('type'))),
        native: await form.locator(NATIVE_DATE_INPUTS).count(),
        image: await page.screenshot({ fullPage: true, clip, animations: 'disabled' }),
      };
    } finally {
      await context.close();
    }
  }

  /** Pixels qui diffèrent entre deux PNG, et le rectangle qui les contient (décodage par Chromium). */
  async function pixelDiff(a: Buffer, b: Buffer) {
    const page = await browsers.get(DEFAULT_LANG)!.newPage();
    try {
      return await page.evaluate(
        async (sources) => {
          const [x, y] = await Promise.all(
            sources.map(async (base64) => {
              const img = new Image();
              img.src = `data:image/png;base64,${base64}`;
              await img.decode();
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              return ctx.getImageData(0, 0, img.width, img.height);
            }),
          );
          if (!x || !y || x.width !== y.width || x.height !== y.height) {
            return { sameSize: false, pixels: -1, box: null };
          }
          let pixels = 0;
          const box = { left: x.width, top: x.height, right: -1, bottom: -1 };
          for (let i = 0; i < x.data.length; i += 4) {
            if (x.data.subarray(i, i + 4).every((v, k) => v === y.data[i + k])) continue;
            pixels += 1;
            const [px, py] = [(i / 4) % x.width, Math.floor(i / 4 / x.width)];
            box.left = Math.min(box.left, px);
            box.top = Math.min(box.top, py);
            box.right = Math.max(box.right, px);
            box.bottom = Math.max(box.bottom, py);
          }
          return { sameSize: true, pixels, box: pixels ? box : null };
        },
        [a.toString('base64'), b.toString('base64')],
      );
    } finally {
      await page.close();
    }
  }

  test('témoin : un champ de date natif change avec la langue du navigateur', async () => {
    // Même boîte pour tous les types : les images se comparent pixel à pixel.
    const FIELD_BOX = 'box-sizing: border-box; width: 200px; height: 32px';
    /** Photo d'un champ seul, dans le navigateur de cette langue. */
    const field = async (lang: string, type: string) => {
      const page = await browsers.get(lang)!.newPage({ locale: lang });
      try {
        await page.setContent(`<input type="${type}" aria-label="Champ" style="${FIELD_BOX}">`);
        return await page.getByLabel('Champ').screenshot();
      } finally {
        await page.close();
      }
    };
    const [frDate, enDate, frText] = [
      await field(DEFAULT_LANG, 'date'),
      await field('en-US', 'date'),
      await field(DEFAULT_LANG, 'text'),
    ];
    // La comparaison voit un écart quand il y en a un (gabarit natif contre champ vide).
    expect((await pixelDiff(frDate, frText)).pixels).toBeGreaterThan(0);
    // Écart entre les langues : nul si le navigateur n'a qu'une langue, et les comparaisons d'images
    // ci-dessous ne distinguent alors rien ; l'absence de champ natif reste vérifiée.
    const { pixels } = await pixelDiff(frDate, enDate);
    test.skip(
      pixels === 0,
      'Ce Chromium affiche ses champs natifs dans une seule langue (ressources de langue absentes) : ' +
        'les images en fr-FR et en en-US ne peuvent pas différer ici.',
    );
    expect(pixels).toBeGreaterThan(0);
  });

  for (const name of FILTER_SCREENS) {
    for (const width of WIDTHS) {
      test(`${name} en ${width} px`, async ({ baseURL }, testInfo) => {
        const fr = await shoot(DEFAULT_LANG, name, width, baseURL!);
        const en = await shoot('en-US', name, width, baseURL!);
        // Les deux images sont jointes au rapport : en cas d'écart, on voit lequel.
        for (const [lang, shot] of [
          [DEFAULT_LANG, fr],
          ['en-US', en],
        ] as const) {
          const path = testInfo.outputPath(`${lang}.png`);
          writeFileSync(path, shot.image);
          await testInfo.attach(lang, { path, contentType: 'image/png' });
        }
        expect(fr.language).toBe('fr-FR');
        expect(en.language).toBe('en-US');
        for (const shot of [fr, en]) {
          expect(shot.native).toBe(0);
          expect(shot.types).toEqual(['text', 'text']);
          expect(shot.text).toContain('Du (UTC)');
          expect(shot.text).toContain('Au (UTC)');
          expect(shot.text).not.toMatch(NATIVE_HINTS);
        }
        expect(en.text).toBe(fr.text);
        expect(await pixelDiff(fr.image, en.image)).toEqual({
          sameSize: true,
          pixels: 0,
          box: null,
        });
      });
    }
  }
});
