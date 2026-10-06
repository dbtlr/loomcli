import { viewMediaType } from './command-rules.js';
import { DeclarationError, InternalError, notTextReason, quoted, reasonOf } from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import type { FailureForm } from './form.js';
import { failureEncoderTaken, foreignValue, notAFunction, notAList } from './plugin-rules.js';
import { pluginSentence } from './plugin.js';
import type { BuiltPlugin } from './plugin.js';
import { brokenFailureEncoder } from './rules.js';

/** Phantom key. It brands a failure encoding and holds no runtime value. */
declare const failureEncoding: unique symbol;

/**
 * A function that writes one failure's form in one media type. It runs synchronously, receives the
 * form alone, and returns the text core writes to stderr as it is, its trailing newline included.
 */
type FailureEncoder = (form: FailureForm) => string;

/** One encoding as core reads it back: the media type it answers, and the encoder. */
interface EncodingRecord {
  mediaType: string;
  encoder: FailureEncoder;
}

/** Authored encodings register here, so the public type publishes nothing to reach. */
const records = new WeakMap<object, EncodingRecord>();

/** The runtime value `encodeFailure()` returns. Its record lives in the registry above. */
class FailureEncodingDeclaration {
  declare readonly [failureEncoding]: true;

  constructor(record: EncodingRecord) {
    records.set(this, record);
    Object.freeze(this);
  }
}

/** An opaque encoding pairing one media type with the encoder that writes it. */
type FailureEncoding = Pick<FailureEncodingDeclaration, typeof failureEncoding>;

/** The finding for one `encodeFailure()` call, marking the argument at `mark`. */
function encodeFinding(mediaType: unknown, encoder: unknown, mark: string) {
  return { arguments: [mediaType, encoder], call: 'encodeFailure', mark };
}

/**
 * Pairs a media type with the encoder that writes a failed run's form in it. A plugin lists the
 * pair under its `failureEncoders`, and a failed `run()` whose selected view declares the media type
 * writes the encoder's text to stderr in place of the failure view. Media types compare as the
 * exact strings core stores, so core judges no grammar.
 */
function encodeFailure(mediaType: string, encoder: FailureEncoder): FailureEncoding {
  if (typeof mediaType !== 'string') {
    throw new DeclarationError(viewMediaType, {
      correction: 'Supply a media type such as "application/json".',
      findings: [encodeFinding(mediaType, encoder, '0')],
      sentence: 'encodeFailure() received a media type that is not a string.',
    });
  }
  if (typeof encoder !== 'function') {
    throw new DeclarationError(notAFunction, {
      correction: 'Supply a function of the failure form that returns a string.',
      findings: [encodeFinding(mediaType, encoder, '1')],
      sentence: 'encodeFailure() received an encoder that is not a function.',
    });
  }
  return new FailureEncodingDeclaration({ encoder, mediaType });
}

/** The fix a `failureEncoders` slot's list fault and entry fault share. */
const encodingSupply = 'encodeFailure(mediaType, encoder)';

/**
 * One plugin's `failureEncoders` list, by media type, in list order. `site` names the plugin at the
 * start of a sentence and holds the call that declared the list, which a fault marks. The slot is
 * read defensively, because a JavaScript author reaches it with any value.
 */
function readEncodings(site: FactSite, declared: unknown): ReadonlyMap<string, FailureEncoder> {
  const encoders = new Map<string, FailureEncoder>();
  const positions = new Map<string, number>();
  // A spread visits a hole as undefined, so a hole is an entry that is not an encoding.
  for (const [index, entry] of [...encodingList(site, declared)].entries()) {
    const record = encodingRecord(site, entry, index);
    const first = positions.get(record.mediaType);
    if (first !== undefined) {
      throw new DeclarationError(failureEncoderTaken, {
        correction: 'Register one.',
        findings: [
          partFinding(site, [first], 'the first encoding'),
          partFinding(site, [index], 'the second encoding'),
        ],
        sentence: `${site.subject} registers two failure encoders for ${quoted(record.mediaType)}.`,
      });
    }
    positions.set(record.mediaType, index);
    encoders.set(record.mediaType, record.encoder);
  }
  return encoders;
}

/** The entries of one `failureEncoders` slot: a list, or none when the slot is omitted. */
function encodingList(site: FactSite, declared: unknown): readonly unknown[] {
  if (declared !== undefined && !Array.isArray(declared)) {
    throw new DeclarationError(notAList, {
      correction: `Supply a list of values returned by ${encodingSupply}.`,
      findings: [partFinding(site, [])],
      sentence: `${site.subject} declares failureEncoders that are not an array.`,
    });
  }
  return declared ?? [];
}

/** The record behind one entry of a `failureEncoders` slot, whose every other value is its fault. */
function encodingRecord(site: FactSite, entry: unknown, index: number): EncodingRecord {
  const record = typeof entry === 'object' && entry !== null ? records.get(entry) : undefined;
  if (!record) {
    throw new DeclarationError(foreignValue, {
      correction: `Supply the value returned by ${encodingSupply}.`,
      findings: [partFinding(site, [index])],
      sentence: `${site.subject} holds a failure encoder entry that is not an encoding.`,
    });
  }
  return record;
}

/** One installed plugin's encoder for one media type, which a broken encoder's report names. */
interface InstalledEncoder {
  identity: string;
  mediaType: string;
  encoder: FailureEncoder;
}

/** Every installed plugin's encoders, by media type; no two plugins share one. */
type EncoderRegistry = ReadonlyMap<string, InstalledEncoder>;

/** Every installed plugin's encoders, in installation order, which installation proved distinct. */
function encoderRegistry(plugins: readonly BuiltPlugin[]): EncoderRegistry {
  return new Map(
    plugins.flatMap(({ failureEncoders, identity }) =>
      [...failureEncoders].map(([mediaType, encoder]): [string, InstalledEncoder] => [
        mediaType,
        { encoder, identity, mediaType },
      ]),
    ),
  );
}

/** What one encoder answered: its text, or why it broke and what it threw. */
type EncoderAnswer =
  | { kind: 'encoded'; text: string }
  | { kind: 'broken'; reason: string; cause: unknown };

/**
 * One encoder's call. An encoder is synchronous, so a returned promise is a value that is not a
 * string like any other: it receives a rejection handler and is otherwise ignored, as a view's is.
 */
function callEncoder(installed: InstalledEncoder, form: FailureForm): EncoderAnswer {
  let encoded: unknown = undefined;
  try {
    encoded = installed.encoder(form);
  } catch (error) {
    return { cause: error, kind: 'broken', reason: reasonOf(error) };
  }
  return typeof encoded === 'string'
    ? { kind: 'encoded', text: encoded }
    : { cause: undefined, kind: 'broken', reason: notTextReason('encoder', encoded) };
}

/** The defect one broken encoder reports in a development build. */
function encoderDefect(
  installed: InstalledEncoder,
  answer: EncoderAnswer & { kind: 'broken' },
): InternalError {
  return new InternalError(brokenFailureEncoder, {
    cause: answer.cause,
    correction: 'Return the encoded failure as a string, and throw nothing from the encoder.',
    sentence: `${pluginSentence(installed.identity)} failed to encode the failure as ${quoted(installed.mediaType)}: ${answer.reason}`,
  });
}

export type { EncoderAnswer, EncoderRegistry, FailureEncoder, FailureEncoding, InstalledEncoder };
export { callEncoder, encodeFailure, encoderDefect, encoderRegistry, readEncodings };
