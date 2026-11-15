import {
  MailContentUnavailableError,
  type MailContent,
  type MailContentReader,
} from '@backup365/core';

/**
 * Sous-ensemble de `AtlasInstance` lu pour exporter un mail : `outlook.readMessage`. Comme les
 * autres lectures, il n'exige pas Graph (docs/adr/0005). L'instance réelle y est assignable.
 */
export interface AtlasMessageReader {
  outlook: {
    readMessage(
      snapshotId: string,
      messageRef: string,
    ): Promise<
      | {
          raw: Uint8Array;
          message?: Record<string, unknown> | undefined;
          attachments: { name: string; contentType: string; sizeBytes: number }[];
          payloadFormat?: 'mime' | undefined;
        }
      | undefined
    >;
  };
}

/** Adaptateur du port `MailContentReader` au-dessus de `outlook.readMessage` du SDK. */
export class AtlasSdkMailContentReader implements MailContentReader {
  constructor(private readonly atlas: AtlasMessageReader) {}

  async readMessage(snapshotId: string, messageRef: string): Promise<MailContent | null> {
    let result;
    try {
      result = await this.atlas.outlook.readMessage(snapshotId, messageRef);
    } catch (err) {
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new MailContentUnavailableError('Contenu du mail indisponible', { cause: err });
    }
    if (!result) return null;
    return {
      format: result.payloadFormat === 'mime' ? 'mime' : 'graph-json',
      raw: result.raw,
      ...(result.message ? { message: result.message } : {}),
      attachments: result.attachments.map((a) => ({
        name: a.name,
        contentType: a.contentType,
        size: a.sizeBytes,
      })),
    };
  }
}
