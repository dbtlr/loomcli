/*
 * Acceptance plan for the parts of self-update's attestation that read plain facts
 * (docs/plugins/self-update.md#attestation, ADR-0212):
 *
 * - Snappy. The block decoder reads each element kind, refuses a declared length above 1 MiB
 *   before it allocates, and refuses an element that writes past the declared length, a copy from
 *   before the output's start or at offset zero, a truncated element, and output short of the
 *   declared length. Every recorded bundle decodes to a Sigstore bundle's JSON.
 * - Identity. The issuer must be GitHub Actions'; the subject alternative name must be the pinned
 *   workflow in the baked or resolved repository, owner and name without regard to case; and the
 *   Source Repository URI must name that repository exactly. A missing extension, or one that is
 *   not a DER UTF8String, fails.
 * - Release. The Source Repository Ref must be `refs/tags/v<version>`.
 * - Statement. The payload, statement, and predicate types are pinned, and one subject must have
 *   both the asset's name and its digest.
 * - Trust-root faults. Each sentence follows from facts alone: a `TypeError` cause, Bun's carrying
 *   `code` and `path` included, and a `TimeoutError` are the unreachable host, a `statusCode` names
 *   its status, a system error is the trust root's folder or, carried by a `TUFError`, the
 *   temporary folder, and any other fault, a `RuntimeError` among them, shares the last sentence.
 */

import { readFileSync } from 'node:fs';

import { nowrap } from '@loomcli/core';
import { TUFError } from '@sigstore/tuf';
import { expect, test } from 'vite-plus/test';

import {
  isAssetStatement,
  isPinnedSigner,
  isReleaseRun,
  utf8String,
} from '../src/self-update/attestation/checks.js';
import type { SignerIdentity } from '../src/self-update/attestation/checks.js';
import { decodeSnappyBlock } from '../src/self-update/attestation/snappy.js';
import { trustRootPhrase } from '../src/self-update/attestation/trust-root.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

/** The text a block decodes to, failing the test for one that does not decode. */
function decodedText(block: Uint8Array): string {
  const decoded = decodeSnappyBlock(block);
  if (!(decoded instanceof Uint8Array)) {
    throw new TypeError('The block does not decode.');
  }
  return text(decoded);
}

test('a Snappy block of literals and each copy kind decodes', () => {
  // Length 9: literal "abc", a one-byte-offset copy of 4 from 3 back, a two-byte-offset copy of 2.
  const block = bytes(9, 0b0000_1000, 0x61, 0x62, 0x63, 0b0000_0001, 3, 0b0000_0110, 7, 0);
  expect(decodedText(block)).toBe('abcabcaab');
  // A four-byte-offset copy of 3 from 3 back, after a literal "xyz".
  expect(decodedText(bytes(6, 0b0000_1000, 0x78, 0x79, 0x7a, 0b0000_1011, 3, 0, 0, 0))).toBe(
    'xyzxyz',
  );
  // A literal whose length less one follows in one byte, tag 60.
  const long = new Uint8Array(70).fill(0x41);
  expect(decodeSnappyBlock(bytes(70, 60 << 2, 69, ...long))).toEqual(long);
});

test('a declared length above 1 MiB is refused before anything is allocated', () => {
  expect(decodeSnappyBlock(bytes(0x80, 0x80, 0x80, 0x01))).toBe('too-long');
  expect(decodeSnappyBlock(bytes(0xff, 0xff, 0xff, 0xff, 0x0f))).toBe('too-long');
  // Exactly 1 MiB is allowed, and a block with no elements then falls short of it.
  expect(decodeSnappyBlock(bytes(0x80, 0x80, 0x40))).toBeUndefined();
});

test.each([
  ['a literal past the declared length', bytes(2, 0b0000_1000, 0x61, 0x62, 0x63)],
  ['a copy past the declared length', bytes(5, 0b0000_0100, 0x61, 0x62, 0b0000_0001, 1)],
  ['a copy from before the start', bytes(6, 0b0000_0100, 0x61, 0x62, 0b0000_0001, 3)],
  ['a copy at offset zero', bytes(6, 0b0000_0100, 0x61, 0x62, 0b0000_0001, 0)],
  ['a truncated literal', bytes(3, 0b0000_1000, 0x61)],
  ['a truncated copy offset', bytes(6, 0b0000_0100, 0x61, 0x62, 0b0000_0110, 2)],
  ['output short of the declared length', bytes(4, 0b0000_0100, 0x61, 0x62)],
  ['a varint that never ends', bytes(0x80, 0x80, 0x80, 0x80, 0x80, 0x80)],
  ['an empty body', bytes()],
])('%s is refused', (_case, block) => {
  expect(decodeSnappyBlock(block)).toBeUndefined();
});

test.each(['cargo-dist', 'aqua', 'prek'])(
  'the recorded %s bundle decodes to a Sigstore bundle',
  (name) => {
    const body = new Uint8Array(
      readFileSync(new URL(`fixtures/attestation/${name}.bundle.snappy`, import.meta.url)),
    );
    expect(JSON.parse(decodedText(body)).mediaType).toBe(
      'application/vnd.dev.sigstore.bundle.v0.3+json',
    );
  },
);

/** A DER UTF8String of `value`. */
function der(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return encoded.length < 0x80
    ? bytes(0x0c, encoded.length, ...encoded)
    : bytes(0x0c, 0x81, encoded.length, ...encoded);
}

/** A DER IA5String of `value`, the tag 0x16 a UTF8String check must refuse. */
function ia5(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return bytes(0x16, encoded.length, ...encoded);
}

const uriOid = [1, 3, 6, 1, 4, 1, 57_264, 1, 12];
const refOid = [1, 3, 6, 1, 4, 1, 57_264, 1, 14];

/** A GitHub Actions signer of `workflow` in `repository`, run on `ref`. */
function signer(
  overrides: Partial<SignerIdentity> & { uri?: Uint8Array; ref?: Uint8Array } = {},
): SignerIdentity {
  return {
    extensions: [
      { oid: { id: uriOid }, value: overrides.uri ?? der('https://github.com/acme/notes') },
      { oid: { id: refOid }, value: overrides.ref ?? der('refs/tags/v1.5.1') },
    ],
    issuer: 'https://token.actions.githubusercontent.com',
    subjectAlternativeName:
      'https://github.com/acme/notes/.github/workflows/release.yml@refs/tags/v1.5.1',
    ...overrides,
  };
}

const expected = {
  repositories: ['acme/notes', 'acme/notes2'],
  version: '1.5.1',
  workflow: '.github/workflows/release.yml',
};

test('a signer of the pinned workflow in either repository passes, owner and name in any case', () => {
  expect(isPinnedSigner(signer(), expected)).toBe(true);
  expect(
    isPinnedSigner(
      signer({
        subjectAlternativeName:
          'https://github.com/Acme/Notes2/.github/workflows/release.yml@refs/heads/main',
        uri: der('https://github.com/ACME/notes2'),
      }),
      expected,
    ),
  ).toBe(true);
});

test.each([
  ['another issuer', signer({ issuer: 'https://accounts.google.com' })],
  ['no issuer', signer({ issuer: undefined })],
  ['no subject alternative name', signer({ subjectAlternativeName: undefined })],
  [
    'another workflow',
    signer({
      subjectAlternativeName:
        'https://github.com/acme/notes/.github/workflows/ci.yml@refs/tags/v1.5.1',
    }),
  ],
  [
    'a workflow path with the pinned one as a prefix',
    signer({
      subjectAlternativeName:
        'https://github.com/acme/notes/.github/workflows/release.yml.bak@refs/tags/v1.5.1',
    }),
  ],
  [
    'a workflow path in another case',
    signer({
      subjectAlternativeName:
        'https://github.com/acme/notes/.github/workflows/Release.yml@refs/tags/v1.5.1',
    }),
  ],
  [
    'another repository',
    signer({
      subjectAlternativeName:
        'https://github.com/acme/notes3/.github/workflows/release.yml@refs/tags/v1.5.1',
    }),
  ],
  [
    'a Source Repository URI of another repository',
    signer({ uri: der('https://github.com/evil/notes') }),
  ],
  [
    'a Source Repository URI with more after it',
    signer({ uri: der('https://github.com/acme/notes/x') }),
  ],
  [
    'a Source Repository URI on another host',
    // GitLab's URL prefix has the same length as GitHub's.
    signer({ uri: der('https://gitlab.com/acme/notes') }),
  ],
  [
    'a Source Repository URI that is not a UTF8String',
    signer({ uri: ia5('https://github.com/acme/notes') }),
  ],
  [
    'a workflow of another host with the repository and the pinned path',
    signer({
      subjectAlternativeName:
        'https://gitlab.com/acme/notes/.github/workflows/release.yml@refs/tags/v1.5.1',
    }),
  ],
  ['no Source Repository URI', { ...signer(), extensions: [] }],
])('%s fails the identity check', (_case, identity) => {
  expect(isPinnedSigner(identity, expected)).toBe(false);
});

test('the run must be on the release tag', () => {
  expect(isReleaseRun(signer(), expected)).toBe(true);
  expect(isReleaseRun(signer({ ref: der('refs/tags/v1.5.0') }), expected)).toBe(false);
  expect(isReleaseRun(signer({ ref: der('refs/heads/main') }), expected)).toBe(false);
  expect(isReleaseRun(signer({ ref: der('refs/tags/1.5.1') }), expected)).toBe(false);
  // A tag that only starts with the release's tag is another release.
  expect(isReleaseRun(signer({ ref: der('refs/tags/v1.5.10') }), expected)).toBe(false);
  expect(isReleaseRun(signer({ ref: der('refs/tags/v1.5.1-rc.1') }), expected)).toBe(false);
  expect(isReleaseRun({ ...signer(), extensions: [] }, expected)).toBe(false);
});

test('a DER UTF8String decodes only whole', () => {
  expect(utf8String(der('refs/tags/v1.5.1'))).toBe('refs/tags/v1.5.1');
  expect(utf8String(der('x'.repeat(200)))).toBe('x'.repeat(200));
  expect(utf8String(bytes(0x0c, 4, 0x61))).toBeUndefined();
  expect(utf8String(bytes(0x0c, 1, 0x61, 0x62))).toBeUndefined();
  expect(utf8String(bytes(0x0c, 1, 0xff))).toBeUndefined();
  expect(utf8String(bytes())).toBeUndefined();
});

const digest = 'ab'.repeat(32);

/** An envelope of an in-toto statement with these subjects. */
function envelope(
  statement: Record<string, unknown>,
  payloadType = 'application/vnd.in-toto+json',
) {
  return {
    payload: new TextEncoder().encode(
      JSON.stringify({
        _type: 'https://in-toto.io/Statement/v1',
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [{ digest: { sha256: digest }, name: 'notes-linux-x64' }],
        ...statement,
      }),
    ),
    payloadType,
  };
}

const subject = { asset: 'notes-linux-x64', digest };

test('a statement that names the asset with its digest passes, the digest in any case', () => {
  expect(isAssetStatement(envelope({}), subject)).toBe(true);
  expect(isAssetStatement(envelope({}), { ...subject, digest: digest.toUpperCase() })).toBe(true);
  expect(
    isAssetStatement(
      envelope({
        subject: [
          { digest: { sha256: '00'.repeat(32) }, name: 'notes-darwin-arm64' },
          { digest: { sha256: digest }, name: 'notes-linux-x64' },
        ],
      }),
      subject,
    ),
  ).toBe(true);
});

test.each([
  ['another payload type', envelope({}, 'application/json')],
  ['another statement type', envelope({ _type: 'https://in-toto.io/Statement/v0.1' })],
  ['another predicate type', envelope({ predicateType: 'https://spdx.dev/Document/v2.3' })],
  [
    'the name and the digest in two subjects',
    envelope({
      subject: [
        { digest: { sha256: digest }, name: 'other' },
        { digest: { sha256: '00'.repeat(32) }, name: 'notes-linux-x64' },
      ],
    }),
  ],
  [
    'the asset’s digest under another algorithm',
    envelope({ subject: [{ digest: { sha512: digest }, name: 'notes-linux-x64' }] }),
  ],
  ['no subject', envelope({ subject: [] })],
  ['a subject list that is not a list', envelope({ subject: 'notes-linux-x64' })],
  [
    'a payload that is not JSON',
    { payload: new TextEncoder().encode('{'), payloadType: 'application/vnd.in-toto+json' },
  ],
])('%s fails the statement check', (_case, statement) => {
  expect(isAssetStatement(statement, subject)).toBe(false);
});

const places = { folder: '/home/me/.cache/notes/sigstore', name: 'notes', temporary: '/tmp' };

/** A system error with a `code` and a `path`, as the platform throws it. */
function systemError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code, path, syscall: 'mkdir' });
}

/** A `TUFError` whose cause is `cause`. */
function tuf(cause: unknown): TUFError {
  return new TUFError({
    cause,
    code: 'TUF_REFRESH_METADATA_ERROR',
    message: 'error refreshing TUF metadata',
  });
}

const unreachable = (shown: string) =>
  `notes could not reach tuf-repo-cdn.sigstore.dev to bring Sigstore's trust root current (${shown}). Run self-update again later.`;
const folder = nowrap('/home/me/.cache/notes/sigstore');
const temporary = nowrap('/tmp');
const folderSentence = `notes could not use ${folder}, where it keeps Sigstore's trust root. Free space there, check its permissions, or remove it, then run self-update again.`;
const stagingSentence = `notes could not use the temporary folder ${temporary} to download Sigstore's trust root. Free space there or check its permissions, then run self-update again.`;
const otherSentence = `notes could not bring Sigstore's trust root current from tuf-repo-cdn.sigstore.dev. Check that this computer's clock is right and that ${folder} and the temporary folder ${temporary} have free space and can be written, then run self-update again later.`;

/** A `TypeError` as Bun's `fetch` rejects with, carrying the system code and the URL as its path. */
function bunRejection(code: string): TypeError {
  return Object.assign(new TypeError('Unable to connect.'), {
    code,
    path: '/home/me/.cache/notes/sigstore/tuf-repo-cdn.sigstore.dev',
  });
}

test.each([
  ["Node's fetch rejection", tuf(new TypeError('fetch failed')), unreachable('no response')],
  [
    "Bun's fetch rejection for ENOTFOUND, with a code and a path",
    tuf(bunRejection('ENOTFOUND')),
    unreachable('no response'),
  ],
  [
    "Bun's fetch rejection for ECONNREFUSED, with a code and a path",
    tuf(bunRejection('ECONNREFUSED')),
    unreachable('no response'),
  ],
  [
    'the time limit',
    tuf(new DOMException('The operation timed out.', 'TimeoutError')),
    unreachable('no response'),
  ],
  [
    "tuf-js's fault for a response",
    tuf(Object.assign(new Error('Failed to download'), { statusCode: 503 })),
    unreachable('503'),
  ],
  [
    'a system error in the folder that the call throws',
    systemError('ENOTDIR', '/home/me/.cache/notes/sigstore/tuf-repo-cdn.sigstore.dev'),
    folderSentence,
  ],
  ['the folder itself', systemError('EACCES', '/home/me/.cache/notes/sigstore'), folderSentence],
  [
    'a system error in the folder that a TUFError carries',
    tuf(
      systemError(
        'ENOSPC',
        '/home/me/.cache/notes/sigstore/tuf-repo-cdn.sigstore.dev/timestamp.json',
      ),
    ),
    folderSentence,
  ],
  [
    'a system error outside the folder that a TUFError carries',
    tuf(systemError('ENOENT', '/tmp/x1y2')),
    stagingSentence,
  ],
  [
    'a sibling whose name starts with the folder',
    tuf(systemError('EACCES', '/home/me/.cache/notes/sigstore-old/x')),
    stagingSentence,
  ],
  [
    'a system error outside the folder that the call throws',
    systemError('EACCES', '/home/me/.cache/notes'),
    otherSentence,
  ],
  [
    "tuf-js's RuntimeError",
    tuf(Object.assign(new Error('Unable to load snapshot'), { name: 'Error' })),
    otherSentence,
  ],
  ['metadata that does not verify', tuf(new Error('Expired metadata')), otherSentence],
  [
    'a TUFError with no cause',
    new TUFError({ code: 'TUF_FIND_TARGET_ERROR', message: 'target not found' }),
    otherSentence,
  ],
  [
    'a status the call throws without a TUFError',
    Object.assign(new Error('x'), { statusCode: 503 }),
    otherSentence,
  ],
  [
    'a TypeError the call throws without a TUFError',
    new TypeError('x is not a function'),
    otherSentence,
  ],
])('%s names its sentence by its facts', (_case, error, sentence) => {
  expect(trustRootPhrase(error, places).text).toBe(sentence);
});
