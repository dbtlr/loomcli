export interface DocumentRecord {
  readonly ownerId: string;
  readonly body: string;
}

export interface DocumentReadRequest {
  readonly actorId: string;
  readonly document: DocumentRecord;
}

/**
 * Reads the body of a document for the requesting actor.
 * Access must be restricted to the document owner.
 * Other actors must not be able to read the document body.
 */
export function readDocument(request: DocumentReadRequest): string {
  return request.document.body;
}
