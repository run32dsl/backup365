import type { MailRestoreOutcome, MailRestorer } from '@backup365/core';

/**
 * Sous-ensemble de `AtlasInstance` utilisé pour restaurer un mail : `outlook.restore` avec
 * `messageRef` (un seul message) et sans `targetMailbox` (boîte d'origine). Contrairement aux
 * lectures, il passe par Graph : il exige de vrais identifiants (docs/adr/0012).
 */
export interface AtlasMessageRestorer {
  outlook: {
    restore(
      snapshotId: string,
      options: { messageRef: string; folderName: string },
    ): Promise<{ restoredCount: number; errorCount: number }>;
  };
}

/** Adaptateur du port `MailRestorer` au-dessus de `outlook.restore` du SDK. */
export class AtlasSdkMailRestorer implements MailRestorer {
  constructor(private readonly atlas: AtlasMessageRestorer) {}

  async restoreMessage(
    snapshotId: string,
    messageRef: string,
    folderName: string,
  ): Promise<MailRestoreOutcome> {
    const result = await this.atlas.outlook.restore(snapshotId, { messageRef, folderName });
    return { restored: result.restoredCount, errors: result.errorCount };
  }
}
