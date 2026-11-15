/** Pièce jointe d'un mail sauvegardé, sans son contenu. */
export interface MailAttachmentInfo {
  name: string;
  contentType: string;
  size: number;
}

/** Contenu brut d'un mail sauvegardé, tel que le stockage le restitue. */
export interface MailContent {
  /** `mime` : `raw` est le message RFC 5322 d'origine. `graph-json` : charge utile Graph (ancien format). */
  format: 'mime' | 'graph-json';
  raw: Uint8Array;
  /** Charge utile Graph déjà analysée, pour le format `graph-json`. */
  message?: Record<string, unknown>;
  attachments: MailAttachmentInfo[];
}

/** Le contenu d'un mail ne peut pas être lu (stockage injoignable, phrase erronée…). */
export class MailContentUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailContentUnavailableError';
  }
}

/** Lecture du contenu d'un mail sauvegardé (adaptateur SDK : `outlook.readMessage`). */
export interface MailContentReader {
  /** `null` si l'instantané ou le message n'existe pas. */
  readMessage(snapshotId: string, messageRef: string): Promise<MailContent | null>;
}
