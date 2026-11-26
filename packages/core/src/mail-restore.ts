/** Résultat d'une restauration d'un mail : des comptes, jamais de contenu. */
export interface MailRestoreOutcome {
  /** Messages créés dans la boîte visée. */
  restored: number;
  /** Erreurs signalées par le service de restauration. */
  errors: number;
}

/**
 * Restauration d'un mail sauvegardé dans sa boîte d'origine, ou dans la boîte `targetMailbox`
 * d'un autre compte, dans un dossier créé pour l'occasion (jamais d'écrasement). Adaptateur SDK :
 * `outlook.restore` (docs/adr/0012, docs/adr/0024).
 */
export interface MailRestorer {
  restoreMessage(
    snapshotId: string,
    messageRef: string,
    folderName: string,
    targetMailbox?: string,
  ): Promise<MailRestoreOutcome>;
}
