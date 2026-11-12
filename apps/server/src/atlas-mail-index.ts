import type { MailMetadata, SnapshotMailReader } from '@backup365/core';

/** Entrée du manifeste d'un instantané mail, telle que le SDK la renvoie (camelCase). */
export interface AtlasManifestEntry {
  objectId: string;
  sizeBytes: number;
  subject?: string | undefined;
  folderId?: string | undefined;
  from?: { name?: string | undefined; address: string } | undefined;
  /** Pièces jointes stockées à part : entrées JSON seulement (les MIME les embarquent). */
  attachments?: readonly { name: string }[] | undefined;
  /** Date de réception ISO 8601 : renseignée pour les entrées MIME seulement. */
  receivedAt?: string | undefined;
}

/**
 * Sous-ensemble de `AtlasInstance` lu pour indexer : `outlook.getSnapshotDetail`, qui renvoie le
 * manifeste sans déchiffrer aucun mail et sans Graph (docs/adr/0003).
 */
export interface AtlasManifestReader {
  outlook: {
    getSnapshotDetail(
      snapshotId: string,
    ): Promise<{ createdAt: Date; entries: readonly AtlasManifestEntry[] } | undefined>;
  };
}

/** Manifeste introuvable pour un instantané listé ; le message ne porte aucun identifiant. */
export class SnapshotManifestMissingError extends Error {
  constructor() {
    super('manifeste introuvable');
    this.name = 'SnapshotManifestMissingError';
  }
}

/** Date ISO 8601 UTC, ou `undefined` si la valeur est absente ou invalide. */
function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * Adaptateur du port `SnapshotMailReader` au-dessus de `outlook.getSnapshotDetail` : une lecture
 * du manifeste par instantané, sans corps ni déchiffrement.
 *
 * Choix (docs/adr/0003) : le manifeste ne porte pas les destinataires, qui restent donc vides
 * (le filtre `to` ne trouve rien) ; la date est `receivedAt` quand le SDK la donne, sinon la date
 * de l'instantané. Le dossier est l'identifiant de dossier du manifeste.
 */
export class AtlasSdkSnapshotMailReader implements SnapshotMailReader {
  constructor(private readonly atlas: AtlasManifestReader) {}

  async readMails(_mailboxId: string, snapshotId: string): Promise<MailMetadata[]> {
    const detail = await this.atlas.outlook.getSnapshotDetail(snapshotId);
    // Un instantané listé sans manifeste (écriture en cours, stockage incohérent) ne doit pas être
    // marqué indexé : l'erreur, sans contenu, le fait reprendre au cycle suivant.
    if (!detail) throw new SnapshotManifestMissingError();
    const fallback = detail.createdAt.toISOString();
    return detail.entries.map((entry) => ({
      messageId: entry.objectId,
      sender: entry.from?.address ?? '',
      recipients: [],
      subject: entry.subject ?? '',
      date: validIso(entry.receivedAt) ?? fallback,
      folder: entry.folderId ?? '',
      size: Number.isInteger(entry.sizeBytes) && entry.sizeBytes >= 0 ? entry.sizeBytes : 0,
      attachments: (entry.attachments ?? []).map((a) => a.name),
    }));
  }
}
