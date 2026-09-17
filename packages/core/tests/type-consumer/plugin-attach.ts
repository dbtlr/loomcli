import { plugin } from '@loomcli/core';
import type {
  AttachedCommand,
  CommandAttachHook,
  PluginDefinition,
  ResultView,
} from '@loomcli/core';

// The record a hook reshapes with holds erased views, because a hook reads no declared type.
const json: ResultView = { render: () => 'json\n' };

// A hook reads the facts of the Command it received and returns a value derived from it.
const attach: CommandAttachHook = (command) => {
  const name: string | null = command.name;
  const path: readonly string[] = command.path;
  const declared: readonly string[] = [...command.arguments, ...command.options];
  const names: readonly string[] = command.result?.views ?? [];
  const reshaped: AttachedCommand = command.result === null ? command : command.views({ json });
  void [name, path, declared];
  return reshaped
    .argument('subject', { required: true })
    .extend()
    .option('format', { description: `Select one of: ${names.join(', ')}.`, type: 'string' });
};

const definition: PluginDefinition = { onCommandAttach: attach };

// @ts-expect-error TS2322: A hook returns the attached Command it received.
const empty: PluginDefinition = { onCommandAttach: () => undefined };

const closed: CommandAttachHook = (command) => {
  // @ts-expect-error TS2339: A hook registers no action.
  command.action(() => {});
  // @ts-expect-error TS2339: A hook declares no alias.
  command.alias('c');
  // @ts-expect-error TS2339: A hook attaches no child.
  command.command(command);
  const record = command.result;
  if (record !== null) {
    // @ts-expect-error TS2349: A result is a fact a hook reads, never a call it makes.
    record({ views: { json } });
  }
  return command;
};

void plugin('@acme/out', definition);
void empty;
void closed;

export { attach };
