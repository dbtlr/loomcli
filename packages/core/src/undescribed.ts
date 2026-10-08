import { undescribed } from './command-rules.js';
import type { BuiltCommand, BuiltGraph } from './command.js';
import { inputFinding } from './command.js';
import { spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import { declarerNote, siteFinding } from './facts.js';
import type { InputDeclaration } from './validation.js';

/** The note every finding of the check carries beside the member's name. */
const gapNote = 'no description';

/** The note for one undescribed input a Command holds, naming the plugin whose hook declared it. */
function inputNote(declarer: string | undefined): string {
  return declarer === undefined ? gapNote : `${gapNote}, ${declarerNote(declarer)}`;
}

/**
 * The gaps of one Command and of everything below it, depth first in authoring order: the Command
 * itself, then its arguments, then its local options, then each child. The root is no attached
 * Command, so its own gap is the caller's.
 */
function commandGaps(command: BuiltCommand, path: readonly string[]): Finding[] {
  const own =
    command.placement !== undefined && command.description === undefined
      ? [{ ...command.placement, note: gapNote }]
      : [];
  const inputs: InputDeclaration[] = [
    ...command.arguments.map((slot) => slot.input),
    ...command.inputs.filter((input) => input.kind === 'option'),
  ];
  const gaps = inputs
    .filter((input) => input.config.description === undefined)
    .map((input) => inputFinding(path, input, inputNote(command.declarers.get(input))));
  const below = [...command.children].flatMap(([name, child]) =>
    commandGaps(child, [...path, name]),
  );
  return [...own, ...gaps, ...below];
}

/**
 * The one fault that lists every Command, the root included, every global option, every local
 * option, and every argument one built graph leaves without a description, in graph order: the
 * global options, then each Command, the root first and then depth first. It is `undefined` when
 * nothing is left out. A plugin's members, a hook's inputs, and a hidden or deprecated member
 * answer the same rule.
 */
export function undescribedFault(
  graph: BuiltGraph,
  application: { name: string; description: string | undefined },
): DeclarationError | undefined {
  // The sites hold every global option in table order, the application's and then each plugin's.
  const globalGaps = [...graph.globals.sites]
    .filter(([input]) => input.config.description === undefined)
    .map(([, site]) => siteFinding(site, site.named, gapNote));
  const root: Finding[] =
    application.description === undefined
      ? [
          {
            arguments: [application.name, spelled('{ … }')],
            call: 'new Application',
            mark: '0',
            note: gapNote,
          },
        ]
      : [];
  const findings = [...globalGaps, ...root, ...commandGaps(graph.root, [])];
  if (findings.length === 0) {
    return undefined;
  }
  const count = findings.length;
  return new DeclarationError(undescribed, {
    correction: 'Give each one a description of one line.',
    findings,
    sentence:
      count === 1
        ? '1 declaration has no description.'
        : `${String(count)} declarations have no description.`,
  });
}
