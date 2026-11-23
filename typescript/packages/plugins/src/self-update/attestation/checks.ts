/*
 * The checks an attestation passes once Sigstore's checks hold, under ADR-0212: the signing
 * identity, the release, and the statement. Each reads plain facts, so a test can state them.
 */

/** The issuer every GitHub Actions run's certificate names. */
const githubActionsIssuer = 'https://token.actions.githubusercontent.com';

/** Where a repository's URI and a workflow's subject alternative name start. */
const githubPrefix = 'https://github.com/';

/** Fulcio's Source Repository URI and Source Repository Ref extensions. */
const sourceRepositoryUri = '1.3.6.1.4.1.57264.1.12';
const sourceRepositoryRef = '1.3.6.1.4.1.57264.1.14';

/** The statement an attestation of a release asset makes. */
const inTotoPayloadType = 'application/vnd.in-toto+json';
const statementType = 'https://in-toto.io/Statement/v1';
const provenanceType = 'https://slsa.dev/provenance/v1';

/** A DER `UTF8String`'s tag, and the bits of a length byte that say how many length bytes follow. */
const utf8StringTag = 0x0c;
const longLength = 0x80;
const lengthBytes = 0x7f;
const byteValues = 256;

/** Where a DER value's tag and first length byte are, and the bytes they take. */
const tagAt = 0;
const lengthAt = 1;
const headerBytes = 2;

/** The length no length bytes declare, where a long-form length's sum starts. */
const noLength = 0;

/** A certificate extension the verifier returns: its object identifier and its DER value. */
interface Extension {
  readonly oid: { readonly id: readonly number[] };
  readonly value: Uint8Array;
}

/** The signer's identity, as the verifier returns it. */
interface SignerIdentity {
  readonly issuer: string | undefined;
  readonly subjectAlternativeName: string | undefined;
  readonly extensions: readonly Extension[];
}

/** What the identity and release checks compare against. */
interface Expected {
  /** The repositories the signer may name: the baked one and the one a redirect resolved. */
  readonly repositories: readonly string[];
  /** The pinned workflow's path. */
  readonly workflow: string;
  /** The version being installed, without its `v`. */
  readonly version: string;
}

/**
 * The length a DER value's header declares and where its content starts, short or long form, or
 * `undefined` for a header that runs past the value.
 */
function derLength(der: Uint8Array): { length: number; start: number } | undefined {
  const first = der.at(lengthAt);
  if (first === undefined) {
    return undefined;
  }
  if ((first & longLength) !== longLength) {
    return { length: first, start: headerBytes };
  }
  const start = headerBytes + (first & lengthBytes);
  if (start > der.length) {
    return undefined;
  }
  const length = der
    .subarray(headerBytes, start)
    .reduce((value, byte) => value * byteValues + byte, noLength);
  return { length, start };
}

/** The text of a DER `UTF8String`, or `undefined` for a value that is not one whole. */
function utf8String(der: Uint8Array): string | undefined {
  if (der.at(tagAt) !== utf8StringTag) {
    return undefined;
  }
  const header = derLength(der);
  if (header === undefined || header.start + header.length !== der.length) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(der.subarray(header.start));
  } catch {
    return undefined;
  }
}

/** The decoded value of the extension with `oid`, or `undefined` when it is missing or not a `UTF8String`. */
function extensionText(identity: SignerIdentity, oid: string): string | undefined {
  const found = identity.extensions.find((extension) => extension.oid.id.join('.') === oid);
  return found === undefined ? undefined : utf8String(found.value);
}

/**
 * What follows `repository` in `text`, when `text` is the GitHub prefix and then that repository,
 * whose owner and name compare without regard to case, and `undefined` otherwise.
 */
function afterRepository(text: string, repository: string): string | undefined {
  const end = githubPrefix.length + repository.length;
  return text.startsWith(githubPrefix) &&
    text.slice(githubPrefix.length, end).toLowerCase() === repository.toLowerCase()
    ? text.slice(end)
    : undefined;
}

/** Whether the subject alternative name is the pinned workflow in one of the repositories, at any ref. */
function isPinnedWorkflow(name: string, { repositories, workflow }: Expected): boolean {
  return repositories.some(
    (repository) => afterRepository(name, repository)?.startsWith(`/${workflow}@`) === true,
  );
}

/** Whether the Source Repository URI names one of the repositories, and nothing more. */
function isRepository(uri: string, { repositories }: Expected): boolean {
  return repositories.some((repository) => afterRepository(uri, repository) === '');
}

/** Whether the signer is a GitHub Actions run of the pinned workflow in the application's repository. */
function isPinnedSigner(identity: SignerIdentity, expected: Expected): boolean {
  const uri = extensionText(identity, sourceRepositoryUri);
  return (
    identity.issuer === githubActionsIssuer &&
    identity.subjectAlternativeName !== undefined &&
    isPinnedWorkflow(identity.subjectAlternativeName, expected) &&
    uri !== undefined &&
    isRepository(uri, expected)
  );
}

/** Whether the run that signed was on the release's own tag. */
function isReleaseRun(identity: SignerIdentity, { version }: Expected): boolean {
  return extensionText(identity, sourceRepositoryRef) === `refs/tags/v${version}`;
}

/** A member of a parsed JSON value, or `undefined` when the value is not an object. */
function member(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** The statement a payload parses to, or `undefined` for one that is not JSON. */
function parsedStatement(payload: Uint8Array): unknown {
  try {
    const statement: unknown = JSON.parse(new TextDecoder().decode(payload));
    return statement;
  } catch {
    return undefined;
  }
}

/** The envelope an attestation's statement comes in. */
interface Envelope {
  readonly payloadType: string;
  readonly payload: Uint8Array;
}

/** The asset the statement must name: its name and its SHA-256 digest. */
interface Subject {
  readonly asset: string;
  readonly digest: string;
}

/** Whether one subject of the statement has both the asset's name and its digest. */
function namesAsset(subjects: unknown, { asset, digest }: Subject): boolean {
  return (
    Array.isArray(subjects) &&
    subjects.some((subject: unknown) => {
      const sha256 = member(member(subject, 'digest'), 'sha256');
      return (
        member(subject, 'name') === asset &&
        typeof sha256 === 'string' &&
        sha256.toLowerCase() === digest.toLowerCase()
      );
    })
  );
}

/** Whether the envelope holds an in-toto SLSA provenance statement that names the asset with its digest. */
function isAssetStatement(envelope: Envelope, subject: Subject): boolean {
  if (envelope.payloadType !== inTotoPayloadType) {
    return false;
  }
  const statement = parsedStatement(envelope.payload);
  return (
    member(statement, '_type') === statementType &&
    member(statement, 'predicateType') === provenanceType &&
    namesAsset(member(statement, 'subject'), subject)
  );
}

export type { Envelope, Expected, Extension, SignerIdentity, Subject };
export { isAssetStatement, isPinnedSigner, isReleaseRun, utf8String };
