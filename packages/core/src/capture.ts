import { elided, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { asSentence, DeclarationError, reasonOf } from './errors.js';
import { copyOwnKeys, decidePlain } from './plain.js';
import { unreadableDeclaration } from './plugin-rules.js';

/**
 * One declaring call's read of the object an author passed it, under way. It remembers the slot it
 * is reading, so a read that throws names the slot it threw in, or no slot when the object itself
 * threw.
 */
class DeclarationRead {
  /** The top-level key being read, or `undefined` while the object itself is read. */
  slot: string | undefined = undefined;

  /** The copy of every own string key of one object, each read under its own slot. */
  record(declared: object): Record<string, unknown> {
    const copy = copyOwnKeys(declared, (key) => {
      this.slot = key;
    });
    this.slot = undefined;
    return copy;
  }

  /**
   * Replaces the value one key of a copy holds with `copy` of it, read under that key's slot. An
   * absent key stays absent, so a finding prints the copy with the keys the author wrote.
   */
  nested(captured: Record<string, unknown>, key: string, copy: (value: unknown) => unknown): void {
    if (Object.hasOwn(captured, key)) {
      this.slot = key;
      captured[key] = copy(captured[key]);
      this.slot = undefined;
    }
  }
}

/** The two faults one declaring call raises when it cannot capture what it was given. */
interface CaptureFaults {
  /** The value is not a plain object, so it has no keys for core to read. */
  readonly notAnObject: () => DeclarationError;
  /** A read threw the value it receives, in the top-level slot it names, or in the object itself. */
  readonly unreadable: (thrown: unknown, slot: string | undefined) => DeclarationError;
}

/**
 * Authoring's one read of an object a declaring call receives, inside one try: the verdict on its
 * prototype, the copy of every own string key, and the copies `nested` takes of the parts it holds,
 * each judged plain once by `decidePlain`. Every later check, stored value, and finding reads that
 * copy and never the author's object again, so a getter runs once and a read that threw is never
 * repeated. A value that is not a plain object is the not-an-object fault, and a read that throws,
 * from a getter or a proxy trap, is the unreadable fault, named by the slot it threw in.
 */
function captureDeclaration<Declared>(
  declared: Declared,
  nested: (copy: Record<string, unknown>, read: DeclarationRead) => void,
  faults: CaptureFaults,
): Declared & Record<string, unknown> {
  const read = new DeclarationRead();
  let copy: Record<string, unknown> | undefined = undefined;
  try {
    if (decidePlain(declared)) {
      copy = read.record(declared);
      nested(copy, read);
    }
  } catch (error) {
    throw faults.unreadable(error, read.slot);
  }
  if (copy === undefined) {
    throw faults.notAnObject();
  }
  // Last resort: no typed path exists.
  // The copy is built key by key, so the compiler types it as a record of unknown values.
  // A spread would keep the declared type, but it reads enumerable keys alone and names no slot.
  // It holds because the copy holds every own string key of the declared plain object.
  // Each holds the value read from it once, or that value's copy of the same kind.
  // No declaration type declares a symbol key, and none reads its prototype.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return copy as Declared & Record<string, unknown>;
}

/**
 * What a finding prints for a declaration whose read threw: the slot it threw in, elided, under the
 * keys that lead to it, or the whole declaration elided. A read that threw is never repeated.
 */
function elidedRead(slot: string | undefined): { keys: readonly string[]; shown: unknown } {
  return slot === undefined
    ? { keys: [], shown: spelled(elided) }
    : { keys: [slot], shown: Object.fromEntries([[slot, spelled(elided)]]) };
}

/** What one unreadable declaration is: an input's config, a plugin's definition, or an options object. */
type Unreadable = 'config' | 'definition' | 'options';

/**
 * The fault for a declaration whose read threw, named by `subject` and marked by `findings`. The
 * thrown value's reason ends the sentence and the value itself is the fault's cause.
 */
function unreadableFault(
  report: {
    readonly declared: Unreadable;
    readonly findings: readonly Finding[];
    readonly subject: string;
  },
  thrown: unknown,
): DeclarationError {
  const { declared, findings, subject } = report;
  return new DeclarationError(
    unreadableDeclaration,
    {
      correction: `Declare the ${declared} as a plain object literal whose properties read without throwing.`,
      findings,
      sentence: `${subject} ${declared} could not be read: ${asSentence(reasonOf(thrown))}`,
    },
    { cause: thrown },
  );
}

/**
 * The unreadable fault of the object a `plugin()` call or a constructor receives as its second
 * argument. Its finding marks the top-level slot whose read threw, or the whole argument when the
 * object itself threw, and prints that part elided.
 */
function unreadableArgument(
  declaration: { readonly call: string; readonly named: unknown; readonly subject: string },
  declared: 'definition' | 'options',
): (thrown: unknown, slot: string | undefined) => DeclarationError {
  const { call, named, subject } = declaration;
  return (thrown, slot) => {
    const { keys, shown } = elidedRead(slot);
    const finding = { arguments: [named, shown], call, mark: ['1', ...keys].join('.') };
    return unreadableFault({ declared, findings: [finding], subject }, thrown);
  };
}

export type { CaptureFaults };
export { captureDeclaration, elidedRead, unreadableArgument, unreadableFault };
