import { Application, Command, GlobalOptions } from '@loomcli/core';
import type { ActionArgs, ActionHandler, ActionOptions } from '@loomcli/core';

// Each authoring call publishes only the calls that stay valid after it.
const globals = new GlobalOptions().option('file', { required: true, type: 'string' });

const freshCommand = new Command('fresh', { globals });
const freshApplication = new Application('fresh', { globals });
const partial = new Command('partial', { globals }).argument('path', { required: true });
const partialOption = new Command('partial-option', { globals }).option('raw', { type: 'boolean' });
const finished = new Command('get', { globals })
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(() => {});

// @ts-expect-error TS2339: A Command that registered its action declares no more arguments.
finished.argument;
// @ts-expect-error TS2339: A Command that registered its action declares no more options.
finished.option;
// @ts-expect-error TS2339: A Command registers one action, so the call does not return.
finished.action;

const group = new Application('group', { globals }).command(finished);
const openAfterChild = group.option('pretty', { type: 'boolean' }).command(finished);
const application = openAfterChild.action(({ options, out }) => out.print(options.file));

// @ts-expect-error TS2339: A Command with children declares no arguments.
group.argument;
// @ts-expect-error TS2339: An Application that registered its action declares no more arguments.
application.argument;
// @ts-expect-error TS2339: An Application that registered its action declares no more options.
application.option;
// @ts-expect-error TS2339: An Application that registered its action attaches no more children.
application.command;
// @ts-expect-error TS2339: The unnamed root answers to no bare token, so it has no name to alias.
freshApplication.alias;

// A group keeps `option()` and `command()` open and publishes `run()`.
// A root group builds; selecting no child is an input error, so this reads the member alone.
const groupRun: () => Promise<number> = group.run;
const applicationName: string = application.name;
const applicationRun: Promise<number> = application.run();

const withArgument = new Application('sized').argument('files', {
  required: true,
  variadic: true,
});
// @ts-expect-error TS2339: A Command with arguments attaches no children.
withArgument.command;

// The declaration helpers read the phantom types, so every state answers them.
const freshHandler: ActionHandler<typeof freshCommand> = ({ options, out }) =>
  out.print(options.file);
const freshApplicationHandler: ActionHandler<typeof freshApplication> = ({ options, out }) =>
  out.print(options.file);
const finishedHandler: ActionHandler<typeof finished> = ({ args, options, out }) =>
  out.print(`${args.path}:${String(options.raw)}`);
const finishedApplicationHandler: ActionHandler<typeof application> = ({ options, out }) =>
  out.print(`${options.file}:${String(options.pretty)}`);
const partialPath = (args: ActionArgs<typeof partial>) => args.path;
const finishedPath = (args: ActionArgs<typeof finished>) => args.path;
const finishedRaw = (options: ActionOptions<typeof finished>) => options.raw;
const finishedApplicationFile = (options: ActionOptions<typeof application>) => options.file;

// The state parameter defaults to `never`, so three type arguments accept any state.
type Globals = Record<'file', string>;
const anyStateFresh: Command<{}, {}, Globals> = freshCommand;
const anyStateFinished: Command<Record<'path', string>, Record<'raw', boolean>, Globals> = finished;
const anyStateApplication = application satisfies Application<{}, {}, Globals>;

function useCommand<CommandArgs, CommandOptions>(
  value: Command<CommandArgs, CommandOptions, Globals>,
) {
  return value;
}
const usedFresh = useCommand(freshCommand);
const usedPartial = useCommand(partial);
const usedFinished = useCommand(finished);

// One graph holds one globals table, so a child's globals are the Application's own type.
const wider = new GlobalOptions()
  .option('file', { required: true, type: 'string' })
  .option('depth', { type: 'string' });
const wide = new Command('wide', { globals: wider }).action(() => {});
// @ts-expect-error TS2345: A child cannot declare globals its Application does not declare.
new Application('subset', { globals }).command(wide);
const narrow = new Command('narrow', { globals }).action(() => {});
// @ts-expect-error TS2345: A child cannot drop globals its Application declares.
new Application('superset', { globals: wider }).command(narrow);

void groupRun;
void applicationName;
void applicationRun;
void freshHandler;
void freshApplicationHandler;
void finishedHandler;
void finishedApplicationHandler;
void partialPath;
void finishedPath;
void finishedRaw;
void finishedApplicationFile;
void anyStateFresh;
void anyStateFinished;
void anyStateApplication;
void usedFresh;
void usedPartial;
void usedFinished;

// Declaration emit must name a fresh builder's CommandMethod/ApplicationMethod state.
// Each export below forces one such state through the packed declaration compile.
export { freshApplication, partialOption, group, openAfterChild };
