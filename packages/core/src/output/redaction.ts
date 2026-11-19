/**
 * The field paths an Application redacts from every log event, under docs/core/logging.md's
 * Redaction: the declaration the constructor judges, and the tree the copy of each event's fields
 * reads as it walks them.
 */
import { registerRule } from '../diagnostics/diagnostic-text.js';
import { partFinding, slotSite } from '../diagnostics/facts.js';
import { DeclarationError } from '../failures/errors.js';
import { quoted } from '../failures/wording.js';

/**
 * The sentence of a `log.redact` entry that is not a dotted path of nonempty keys: the redaction
 * fault's Developer Diagnostic, which addresses the author.
 */
function redactPathSentence(path: string): string {
  return `The Application redacts ${quoted(path)}, which is not a dotted path of nonempty keys.`;
}

/** The redaction fault's correction. */
const redactPathCorrection = 'List dotted paths of nonempty keys, such as password or user.token.';

const invalidRedactPath = registerRule('@loomcli/core/invalid-redact-path', {
  explanation:
    'Core redacts each path log.redact lists from every log event when it copies the fields, so no onLog hook, log line, or record reads the value. A path splits on dots into object keys, so each key is nonempty.',
  headline: 'Invalid redact path',
});

/**
 * One step of the redaction tree: whether the value at this key is redacted, and the keys below it
 * that are. A redacted node covers everything under it, so it holds no keys.
 */
interface Redaction {
  readonly redacted: boolean;
  readonly keys: ReadonlyMap<string, Redaction>;
}

/** A node while the tree is built, which the copy reads through `Redaction`. */
interface Building {
  redacted: boolean;
  readonly keys: Map<string, Building>;
}

/** What a redacted value reads in every copy of the fields. */
const redactedValue = '[Redacted]';

/** Whether one path is dotted keys, each nonempty, with no escaping and no array index. */
function isRedactPath(path: string): boolean {
  return path.split('.').every((key) => key !== '');
}

/**
 * Marks the node under `keys` from `root` redacted, creating the nodes on the way, and drops the
 * keys below it. A path under one already redacted adds nothing.
 */
function redact(root: Building, keys: readonly string[]): void {
  let current = root;
  for (const key of keys) {
    if (current.redacted) {
      return;
    }
    const next = current.keys.get(key) ?? { keys: new Map(), redacted: false };
    current.keys.set(key, next);
    current = next;
  }
  current.redacted = true;
  current.keys.clear();
}

/**
 * The redaction tree an Application declares as `log: { redact }`, or `undefined` when it redacts
 * nothing, so a copy with no paths walks no tree. A path that is not dotted nonempty keys is a
 * declaration error from the constructor.
 */
function redactionOf(
  application: string,
  log: { readonly redact?: readonly string[] } | undefined,
): Redaction | undefined {
  const paths = log?.redact ?? [];
  const root: Building = { keys: new Map(), redacted: false };
  for (const [index, path] of paths.entries()) {
    if (!isRedactPath(path)) {
      const site = slotSite(
        { call: 'new Application', named: application, subject: 'The Application' },
        'log',
        log,
      );
      throw new DeclarationError(invalidRedactPath, {
        correction: redactPathCorrection,
        findings: [partFinding(site, ['redact', index])],
        sentence: redactPathSentence(path),
      });
    }
    redact(root, path.split('.'));
  }
  return root.keys.size === 0 ? undefined : root;
}

export type { Redaction };
export { redactedValue, redactionOf };
