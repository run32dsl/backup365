import type { ReactNode } from 'react';
import type { IndexedMail } from '@backup365/core';
import { dateTimeOf, folderLabel, quoted } from './format.js';

/**
 * Liste libellée et « Ce qui va se passer » de la restauration d'un mail, communs à la boîte
 * d'origine et à la boîte d'un autre compte (issue #574) : mêmes libellés pour les deux rôles.
 */

export type RestorableMail = Pick<
  IndexedMail,
  'mailboxId' | 'messageId' | 'subject' | 'date' | 'folder'
>;

/** Boîtes d'une restauration vers un autre compte : l'origine, puis la destination une fois choisie. */
export interface TransferBoxes {
  origin: string;
  target?: string | undefined;
}

/**
 * Rappel du mail et de sa boîte. Vers un autre compte : « Boîte d'origine » puis « Boîte de
 * destination » (quand elle est choisie) ; sinon « Boîte ».
 */
export function recallRows(mail: RestorableMail, boxes?: TransferBoxes): [string, string][] {
  const date = dateTimeOf(mail.date);
  const subject = mail.subject === '' ? '(sans objet)' : mail.subject;
  const head: [string, string] = ['Mail', date ? `${subject} · ${date} UTC` : subject];
  if (!boxes) return [head, ['Boîte', mail.mailboxId]];
  return [
    head,
    ['Boîte d’origine', boxes.origin],
    ...(boxes.target ? [['Boîte de destination', boxes.target] as [string, string]] : []),
  ];
}

/** Dossier d'origine du mail et dossier de destination, nouveau dans la boîte visée. */
export function folderRows(
  mail: RestorableMail,
  folder: string,
  failed = false,
  transfer = false,
): [string, ReactNode][] {
  return [
    ['Dossier d’origine', folderLabel(mail.folder)],
    failed
      ? ['Dossier visé', folder]
      : [
          'Restauré dans le dossier',
          <>
            {folder}
            <span className="meta-note">
              {transfer
                ? 'nouveau dossier créé dans la boîte de destination'
                : 'nouveau dossier créé dans la boîte'}
            </span>
          </>,
        ],
  ];
}

/** Puce « Ce qui va se passer » : nomme le dossier de destination entre guillemets. */
export const copyBullet = (folder: string, transfer = false): string =>
  `Le mail sera copié dans le dossier ${quoted(folder)} de la boîte ${transfer ? 'de destination' : 'd’origine'}.`;

/** « Ce qui va se passer » : le dossier créé, rien d'écrasé, rien du contenu au journal. */
export function WhatHappens({ folder, transfer = false }: { folder: string; transfer?: boolean }) {
  return (
    <>
      <h3>Ce qui va se passer</h3>
      <ul>
        <li>{copyBullet(folder, transfer)}</li>
        <li>Aucun mail existant ne sera modifié ni écrasé.</li>
        <li>Le contenu du mail n’est jamais inscrit au journal d’audit.</li>
      </ul>
    </>
  );
}
