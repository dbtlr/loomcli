import { elided, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { asSentence, DeclarationError, reasonOf } from './errors.js';
import { partFinding, slotSite } from './facts.js';
import { isPlainObject } from './plain.js';
import { unreadableDeclaration } from './plugin-rules.js';

/**
 * One declaring call's read of the object an author passed it, under way. It remembers the slot it
 * is reading, so a read that throws names the slot it threw in, or no slot when the object itself
 * threw.
 */
class DeclarationRead {
  /** The top-level key being read, or `undefined` while the object itself is read. */
  slot: string | undefined = undefined;

  /**
   * A shallow copy of one plain object's own enumerable keys, as a spread takes it. Each key's read
   * is under that key's slot, so a getter or a trap that throws for one key names it.
   */
  record<Declared extends object>(declared: Declared): Declared {
    const enter = (key: string | symbol) => {
      this.slot = typeof key === 'string' ? key : undefined;
    };
    // The getter runs on the author's object, as a read of it would, and never on this proxy.
    const tracked = new Proxy(declared, {
      get: (target, key) => {
        enter(key);
        return Reflect.get(target, key);
      },
      getOwnPropertyDescriptor: (target, key) => {
        enter(key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const copy = { ...tracked };
    this.slot = undefined;
    return copy;
  }

  /**
   * Replaces the value one key of a copy holds with `copy` of it, read under that key's slot. An
   * absent key stays absent, so a finding prints the copy with the keys the author wrote.
   */
  nested<Captured extends object, Key extends keyof Captured & string>(
    captured: Captured,
    key: Key,
    copy: (value: Captured[Key]) => Captured[Key],
  ): void {
    if (Object.hasOwn(captured, key)) {
      this.slot = key;
      captured[key] = copy(captured[key]);
      this.slot = undefined;
    }
  }
}

/**
 * Authoring's one read of an object a declaring call receives, inside one try: the prototype check
 * and the copy `capture` takes. Every later check, stored value, and finding reads that copy and
 * never the author's object again, so a getter runs once and a read that threw is never repeated.
 * A value that is not a plain object answers `undefined`, which the caller reports under its own
 * rule with the value as declared. A read that throws, from a getter or a proxy trap, is the fault
 * `unreadable` builds from the thrown value and the slot it threw in.
 */
function captureDeclaration<Declared, Captured>(
  declared: Declared,
  capture: (plain: Declared & Record<string, unknown>, read: DeclarationRead) => Captured,
  unreadable: (thrown: unknown, slot: string | undefined) => DeclarationError,
): Captured | undefined {
  const read = new DeclarationRead();
  try {
    return isPlainObject(declared) ? capture(declared, read) : undefined;
  } catch (error) {
    throw unreadable(error, read.slot);
  }
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
 * argument. Its finding marks the slot whose read threw, or the whole argument when the object
 * itself threw, and prints that part elided, because a read that threw is never repeated.
 */
function unreadableArgument(
  declaration: { readonly call: string; readonly named: unknown; readonly subject: string },
  declared: 'definition' | 'options',
): (thrown: unknown, slot: string | undefined) => DeclarationError {
  const { call, named, subject } = declaration;
  const shown = spelled(elided);
  return (thrown, slot) => {
    const finding =
      slot === undefined
        ? { arguments: [named, shown], call, mark: '1' }
        : partFinding(slotSite(declaration, slot, shown), []);
    return unreadableFault({ declared, findings: [finding], subject }, thrown);
  };
}

export { captureDeclaration, unreadableArgument, unreadableFault };
