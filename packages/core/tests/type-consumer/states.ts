import { Application, Command, GlobalOptions } from '@loom/core';
import type { ActionArgs, ActionHandler, ActionOptions } from '@loom/core';

// Each authoring call publishes only the calls that stay valid after it.
const globals = new GlobalOptions().option('file', { required: true, type: 'string' });

const freshCommand = new Command('fresh', globals);
const freshApplication = new Application('fresh', globals);
const partial = new Command('partial', globals).argument('path', { required: true });
const finished = new Command('get', globals)
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(() => {});

// @ts-expect-error TS2339: A Command that registered its action declares no more arguments.
finished.argument;
// @ts-expect-error TS2339: A Command that registered its action declares no more options.
finished.option;
// @ts-expect-error TS2339: A Command registers one action, so the call does not return.
finished.action;

const group = new Application('group', globals).command(finished);
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

// A group keeps its children open and still runs, and the finished Application keeps both members.
const groupRun: Promise<number> = group.run();
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
