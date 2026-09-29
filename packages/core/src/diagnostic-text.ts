import { escapeControlCharacters } from './controls.js';
import { isPlainObject } from './plain.js';

/**
 * One reason a declaration can be wrong, or one kind of defect: the parts that hold at every site
 * that raises it. `diagnosticRule()` builds and freezes it.
 */
interface DiagnosticRule {
  readonly identity: string;
  readonly headline: string;
  readonly explanation: string;
  readonly docs: string | undefined;
}

/**
 * One declaration a fault points at, rebuilt from the facts core holds: the Command it sits on, the
 * authoring call, and the arguments that call received. `mark` is a dotted path into `arguments`
 * that the diagnostic underlines, and `note` prints beside the marks.
 */
interface Finding {
  readonly path?: readonly string[];
  readonly call: string;
  readonly arguments: readonly unknown[];
  readonly mark?: string;
  readonly note?: string;
}

/** The parts of one fault that differ at each site that raises its rule. */
interface DiagnosticParts {
  readonly sentence: string;
  readonly findings?: readonly Finding[];
  readonly correction?: string | readonly string[];
}

/** Everything one Developer Diagnostic prints, whichever class carries it. */
interface Anatomy {
  readonly rule: DiagnosticRule | undefined;
  /** The banner a fault with no rule prints. */
  readonly fallback: 'INVALID DECLARATION' | 'DEFECT';
  readonly sentence: string;
  readonly findings: readonly Finding[];
  /** A defect's own findings, already rendered: the author's source and the cause chain. */
  readonly evidence: readonly string[];
  readonly correction: string | readonly string[] | undefined;
}

/**
 * Where one diagnostic is printed: the column count its banner fills and its prose wraps to, and
 * the application name a finding's path opens with when `run()` reports the fault.
 */
interface Layout {
  readonly width: number;
  readonly application?: string | undefined;
}

/** The width a diagnostic takes in a thrown error's message, or when the stderr width is unknown. */
const messageWidth = 80;

/** How far a finding's code sits from the left edge. */
const findingIndent = '    ';

/** How deep a finding's argument is printed before the rest reads as an ellipsis. */
const depthLimit = 4;

/** The stand-in for a value a finding does not spell out: a function, a validator, or a cycle. */
const elided = '…';

/** A key an object literal can spell without quotes. */
const identifierKey = /^[A-Za-z_$][\w$]*$/u;

/** One column range of printed code, which a mark underlines. */
interface Span {
  start: number;
  end: number;
}

/** A string as a single-quoted JavaScript literal, with every control escaped. */
function quoteString(text: string): string {
  return `'${escapeControlCharacters(text.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`))}'`;
}

/**
 * Stand-ins a finding prints as the code they name, such as `new Command('get')` for the Command
 * value an attach received, which a finding would otherwise print as an ellipsis.
 */
const spellings = new WeakMap<object, string>();

/** A finding argument that prints as the code given, which the caller has already escaped. */
function spelled(code: string): object {
  const value = Object.freeze({});
  spellings.set(value, code);
  return value;
}

/** The code a stand-in prints as, or `undefined` for any other value. */
function spellingOf(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null ? spellings.get(value) : undefined;
}

/** Whether a value is a Standard Schema, which a finding prints as an ellipsis like a function. */
function isValidator(value: object): boolean {
  return '~standard' in value;
}

/** A primitive as JavaScript source, or `undefined` for an object or a function. */
function primitiveCode(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string': {
      return quoteString(value);
    }
    case 'number': {
      return Object.is(value, -0) ? '-0' : String(value);
    }
    case 'bigint': {
      return `${String(value)}n`;
    }
    case 'symbol': {
      return escapeControlCharacters(String(value));
    }
    case 'boolean':
    case 'undefined': {
      return String(value);
    }
    default: {
      return value === null ? 'null' : undefined;
    }
  }
}

/** One object key as an object literal spells it. */
function keyCode(key: string): string {
  return identifierKey.test(key) ? key : quoteString(key);
}

/** Where one value sits: its dotted path, and the containers above it, which a cycle repeats. */
interface Place {
  path: string;
  seen: ReadonlySet<object>;
}

/**
 * Printed code in progress, and the span each argument path and key covers, which a mark
 * underlines. Reading a value runs no author code beyond property reads, and a read that throws
 * prints an ellipsis.
 */
class CodePrinter {
  text: string;
  readonly spans = new Map<string, Span>();

  constructor(text: string) {
    this.text = text;
  }

  /** Appends one value and records the span it covers under its path. */
  value(value: unknown, place: Place): void {
    const start = this.text.length;
    try {
      // Nested members append while the composite is read, so its tail appends after them.
      const tail = this.composite(value, place);
      this.text += tail;
    } catch {
      this.text = `${this.text.slice(0, start)}${elided}`;
    }
    this.spans.set(place.path, { end: this.text.length, start });
  }

  /** Appends each item with a comma between, as a list of arguments or members is written. */
  separated<Item>(items: readonly Item[], write: (item: Item, index: number) => void): void {
    for (const [index, item] of items.entries()) {
      if (index > 0) {
        this.text += ', ';
      }
      write(item, index);
    }
  }

  /**
   * The code for one value, appending nested members as it goes and returning what is left to
   * append. A function, a validator, a class instance, a cycle, and a value deeper than the limit
   * print an ellipsis.
   */
  private composite(value: unknown, { path, seen }: Place): string {
    const known = primitiveCode(value) ?? spellingOf(value);
    if (known !== undefined) {
      return known;
    }
    if (typeof value !== 'object' || value === null || seen.has(value) || seen.size >= depthLimit) {
      return elided;
    }
    const inner = { path, seen: new Set([...seen, value]) };
    if (Array.isArray(value)) {
      return this.list(value, inner);
    }
    return isValidator(value) || !isPlainObject(value) ? elided : this.record(value, inner);
  }

  /** One array literal. Its members append in place, so each records its own span. */
  private list(list: readonly unknown[], { path, seen }: Place): string {
    this.text += '[';
    // A hole reads as undefined, so the list is copied before it is walked.
    this.separated([...list], (member, index) => {
      this.value(member, { path: `${path}.${String(index)}`, seen });
    });
    return ']';
  }

  /** One object literal. A key's span covers the whole `key: value` pair, which a mark underlines. */
  private record(record: object, place: Place): string {
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return '{}';
    }
    this.text += '{ ';
    this.separated(keys, (key) => {
      this.member(key, Reflect.get(record, key), place);
    });
    return ' }';
  }

  /** One `key: value` pair of an object literal. */
  private member(key: string, value: unknown, { path, seen }: Place): void {
    const start = this.text.length;
    const member = `${path}.${key}`;
    this.text += `${keyCode(key)}: `;
    this.value(value, { path: member, seen });
    this.spans.set(member, { end: this.text.length, start });
  }
}

/** One call with its arguments, and the span each argument and key covers inside the line. */
function printCall(prefix: string, finding: Finding): CodePrinter {
  const printer = new CodePrinter(`${prefix}${escapeControlCharacters(finding.call)}(`);
  const seen = new Set<object>();
  printer.separated(finding.arguments, (argument, index) => {
    printer.value(argument, { path: String(index), seen });
  });
  printer.text += ')';
  return printer;
}

/** One value as the JavaScript a finding prints for it. */
function valueCode(value: unknown): string {
  const printer = new CodePrinter('');
  printer.value(value, { path: '', seen: new Set() });
  return printer.text;
}

/** The line of carets under a finding's mark, with its note beside it, or none. */
function markLine(printed: CodePrinter, finding: Finding): string[] {
  const span = finding.mark === undefined ? undefined : printed.spans.get(finding.mark);
  if (span === undefined) {
    return [];
  }
  const carets = '^'.repeat(Math.max(1, span.end - span.start));
  const note = finding.note === undefined ? '' : ` ${escapeControlCharacters(finding.note)}`;
  return [`${' '.repeat(span.start)}${carets}${note}`];
}

/**
 * The receiver a finding's call sits on: the Command its path names, or the Application for the
 * root, and the comment above it that opens with the path, after the application name when known.
 */
function receiverLines(path: readonly string[], application: string | undefined): string[] {
  const words = application === undefined ? path : [application, ...path];
  const comment = words.length === 0 ? [] : [`// ${escapeControlCharacters(words.join(' '))}`];
  const last = path.at(-1);
  if (last !== undefined) {
    return [...comment, `new Command(${quoteString(last)})`];
  }
  return [
    ...comment,
    `new Application(${application === undefined ? elided : quoteString(application)})`,
  ];
}

/** One finding as indented code: the rebuilt call, and the marks under the part at fault. */
function findingSection(finding: Finding, application: string | undefined): string {
  const receiver = finding.path === undefined ? [] : receiverLines(finding.path, application);
  const printed = printCall(finding.path === undefined ? '' : '  .', finding);
  return [...receiver, printed.text, ...markLine(printed, finding)]
    .map((line) => `${findingIndent}${line}`.trimEnd())
    .join('\n');
}

/** Prose wrapped to the width at spaces. A word wider than the width keeps a line of its own. */
function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

/**
 * The sentence with every control escaped. A declaration fault's sentence is written by the author
 * of a rule, so its line breaks, such as the issue lines under a rejected default, stay breaks; a
 * defect's sentence can carry a thrown value's reason, so it stays on one line.
 */
function sentenceText(anatomy: Anatomy): string {
  return anatomy.fallback === 'DEFECT'
    ? escapeControlCharacters(anatomy.sentence)
    : anatomy.sentence.split('\n').map(escapeControlCharacters).join('\n');
}

/** The banner: two hyphens, the headline in capitals, a run of hyphens, and the rule's identity. */
function bannerLine(anatomy: Anatomy, width: number): string {
  const { rule } = anatomy;
  const title = rule === undefined ? anatomy.fallback : rule.headline.toUpperCase();
  const left = `-- ${escapeControlCharacters(title)} `;
  const right = rule === undefined ? '' : ` ${escapeControlCharacters(rule.identity)}`;
  const fill = Math.max(2, width - left.length - right.length);
  return `${left}${'-'.repeat(fill)}${right}`;
}

/** The correction: one imperative sentence, or one fix per line when several fit. */
function correctionSection(correction: Anatomy['correction']): string[] {
  if (correction === undefined) {
    return [];
  }
  if (typeof correction === 'string') {
    return [escapeControlCharacters(correction)];
  }
  return correction.length === 0
    ? []
    : [correction.map((fix) => `- ${escapeControlCharacters(fix)}`).join('\n')];
}

/**
 * One Developer Diagnostic as plain text with no trailing newline: the banner, the sentence, the
 * findings, the explanation, the correction, and the docs link, separated by one blank line, each
 * left out when the fault does not carry it. The banner is returned apart, so a caller that styles
 * it can.
 */
function diagnosticSections(anatomy: Anatomy, layout: Layout): { banner: string; body: string } {
  const { rule } = anatomy;
  const sections = [
    sentenceText(anatomy),
    ...anatomy.findings.map((finding) => findingSection(finding, layout.application)),
    ...anatomy.evidence,
    ...(rule === undefined ? [] : [wrap(escapeControlCharacters(rule.explanation), layout.width)]),
    ...correctionSection(anatomy.correction),
    ...(rule?.docs === undefined ? [] : [`See ${escapeControlCharacters(rule.docs)}`]),
  ];
  return { banner: bannerLine(anatomy, layout.width), body: sections.join('\n\n') };
}

/** The whole diagnostic as the plain text a thrown fault's message holds. */
function diagnosticText(anatomy: Anatomy, layout: Layout = { width: messageWidth }): string {
  const { banner, body } = diagnosticSections(anatomy, layout);
  return `${banner}\n\n${body}`;
}

/** Every descriptor built through `registerRule`, so a hand-built object is not a rule. */
const rules = new WeakSet();

/** One frozen descriptor from parts already checked, which every site raising it shares. */
function registerRule(
  identity: string,
  definition: { readonly headline: string; readonly explanation: string; readonly docs?: string },
): DiagnosticRule {
  const rule: DiagnosticRule = Object.freeze({
    docs: definition.docs,
    explanation: definition.explanation,
    headline: definition.headline,
    identity,
  });
  rules.add(rule);
  return rule;
}

/** Whether a value is a descriptor `diagnosticRule()` built. */
function isDiagnosticRule(value: unknown): value is DiagnosticRule {
  return typeof value === 'object' && value !== null && rules.has(value);
}

export type { Anatomy, DiagnosticParts, DiagnosticRule, Finding, Layout };
export {
  diagnosticSections,
  diagnosticText,
  isDiagnosticRule,
  messageWidth,
  quoteString,
  registerRule,
  spelled,
  valueCode,
  wrap,
};
