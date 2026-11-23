import { Application, locate } from '@loomcli/core';
import type { TypedInputs } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import type { Completer, CompleterContext } from '@loomcli/plugins/completion';
import { completionArgument, completionInput } from '@loomcli/plugins/completion/extension';

// An input names a completer, and the plugin's settings hold the function.
const named = completionInput({ values: 'task' });
const namedArgument = completionArgument({ values: 'task' });

// A completer reads the word, the typed inputs, the signal, and the host; it answers values now or later.
const byWord: Completer = ({ host, signal, typed, word }: CompleterContext) => {
  const project: readonly string[] | undefined = typed.options.get('project');
  const first: readonly string[] | undefined = typed.arguments.get('ref');
  void host.cwd;
  return signal.aborted ? [] : [word, ...(project ?? []), ...(first ?? [])];
};
const later: Completer = async () => [{ description: 'First.', value: 'a-1' }, 'a-2'];
const plugin = completion({ values: { late: later, task: byWord } });
const plain = completion();

// The typed words come from core's position, on every kind but none.
const graph = new Application('kit').inspect();
const position = locate(graph, ['']);
const typed: TypedInputs | undefined = position.kind === 'none' ? undefined : position.typed;

// @ts-expect-error TS2345: An input names one hint, so a name never sits beside another.
const two = completionInput({ files: true, values: 'task' });

// @ts-expect-error TS2322: A completer's name is text.
const number = completionInput({ values: 3 });

// @ts-expect-error TS2322: A setting holds a function for each name.
const text = completion({ values: { task: 'a-1' } });

// @ts-expect-error TS2322: A completer returns text, or a value with its description.
const numbers = completion({ values: { task: () => [1, 2] } });

// @ts-expect-error TS2322: A value's description is text.
const badDescription = completion({ values: { task: () => [{ description: 3, value: 'a' }] } });

// @ts-expect-error TS2322: A value names the text to insert, `value`, and no other key.
const badKey = completion({ values: { task: () => [{ text: 'a' }] } });

// @ts-expect-error TS2322: A completer answers values, not one text.
const single = completion({ values: { task: () => 'a-1' } });

// @ts-expect-error TS2345: A completer takes the context alone.
const wrongCall = byWord('a');

// @ts-expect-error TS2322: The context holds the word being completed, not the whole line.
const noLine: Completer = ({ line }: CompleterContext & { line: string }) => [line];

export {
  badDescription,
  badKey,
  named,
  namedArgument,
  noLine,
  number,
  numbers,
  plain,
  plugin,
  single,
  text,
  two,
  typed,
  wrongCall,
};
