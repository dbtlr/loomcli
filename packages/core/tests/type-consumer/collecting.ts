import { extension, plugin, readExtension } from '@loomcli/core';
import type { AttachedCommand, CommandNode, OptionNode } from '@loomcli/core';
import { z } from 'zod';

const note = z.object({ note: z.string() });

// A collecting extension publishes `collect: true`, and an ordinary one `collect: false`.
const notes = extension('@fixture/notes/command', {
  collect: true,
  schema: note,
  target: 'command',
});
const single = extension('@fixture/single/command', { schema: note, target: 'command' });
const explicit = extension('@fixture/explicit/command', {
  collect: false,
  schema: note,
  target: 'command',
});
const optionNotes = extension('@fixture/notes/option', {
  collect: true,
  schema: note,
  target: 'option',
});

const collecting: true = notes.collect;
const ordinary: false = single.collect;
const declaredOrdinary: false = explicit.collect;

declare const node: CommandNode;
declare const option: OptionNode;
declare const attached: AttachedCommand;

// A collecting read is a read-only list, and an ordinary read is one output or undefined.
const list: readonly { readonly note: string }[] = readExtension(node, notes);
const one: { readonly note: string } | undefined = readExtension(node, single);
const optionList: readonly { readonly note: string }[] = readExtension(option, optionNotes);

// A lifecycle hook reads the value it receives through the same typed read, and its record.
const reader = plugin('@fixture/reader', {
  onCommandAttach: (command) => {
    const seen: readonly { readonly note: string }[] = readExtension(command, notes);
    const record: Readonly<Record<string, unknown>> = command.extensions;
    return seen.length > 0 && Object.keys(record).length > 0
      ? command.extend(notes({ note: 'more' }))
      : command;
  },
});

// @ts-expect-error TS2741: a collecting read is a list, never one output or undefined.
const wrongShape: { readonly note: string } | undefined = readExtension(node, notes);

// @ts-expect-error TS2769: the value a hook receives is a Command, never an option node.
readExtension(attached, optionNotes);

// @ts-expect-error TS2769: collect is true or false.
extension('@fixture/bad/command', { collect: 'yes', schema: note, target: 'command' });

export {
  collecting,
  declaredOrdinary,
  explicit,
  list,
  notes,
  one,
  optionList,
  optionNotes,
  ordinary,
  reader,
  single,
  wrongShape,
};
