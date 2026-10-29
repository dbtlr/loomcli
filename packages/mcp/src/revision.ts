/**
 * The revision this package speaks per request, with no handshake. Every version check and every
 * answer that names it reads this constant, so moving to a later revision is a change to it and
 * the code that revision changes, never a dependency update.
 */
export const protocolRevision = '2026-07-28';

/**
 * The latest initialize-era revision, which answers an `initialize` that asks for a revision this
 * package does not serve.
 */
export const latestHandshakeRevision = '2025-11-25';

/** The initialize-era revision whose implementation info has no description, which the next added. */
export const undescribedHandshakeRevision = '2025-06-18';

/**
 * The initialize-era revisions this package also serves, latest first, for a client that opens its
 * connection with `initialize`. For a server that serves tools alone, the two answer alike, except
 * for the implementation info's description.
 */
export const handshakeRevisions = [latestHandshakeRevision, undescribedHandshakeRevision] as const;

/** One initialize-era revision. */
export type HandshakeRevision = (typeof handshakeRevisions)[number];
