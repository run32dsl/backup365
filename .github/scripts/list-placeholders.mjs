#!/usr/bin/env node
// Liste les issues dont le titre ou le corps contient encore un nom provisoire « SUIVI » +
// chiffre. La recherche de GitHub cherche des mots entiers, pas un motif : elle ne trouve pas
// ces noms à partir du seul mot SUIVI, d'où ce filtre sur l'export JSON.
// Usage : gh issue list --state open --limit 1000 --json number,title,body \
//           | node .github/scripts/list-placeholders.mjs
// Même motif que check-placeholders.sh. Les commentaires ne sont pas lus.
// Code de sortie : 0 si aucune issue, 1 s'il en reste, 2 si l'entrée est invalide.
import { readFileSync } from 'node:fs';

const pattern = /SUIVI[ _-]?[0-9]+/g;
let issues = null;
try {
  issues = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // Traité juste après : une entrée illisible n'est pas un tableau.
}
if (!Array.isArray(issues)) {
  // Entrée vide ou invalide (gh en échec, par exemple) : ne pas la confondre avec une liste.
  console.error('Entrée invalide : un tableau JSON est attendu (sortie de gh issue list --json).');
  process.exit(2);
}
let found = 0;
for (const { number, title, body } of issues) {
  const names = `${title ?? ''}\n${body ?? ''}`.match(pattern);
  if (names) {
    found += 1;
    console.log(`#${number} : ${[...new Set(names)].join(', ')}`);
  }
}
if (found === 0) console.log('Aucune issue avec un nom provisoire.');
process.exit(found === 0 ? 0 : 1);
