/**
 * A run's `host.spawn`: the one way a run starts a child program, through its process handle.
 * Core fills the child's working directory and environment from the run, and passes `inherit` to
 * the handle only for a stream that is the handle's own, so a run whose streams are capture sinks,
 * as an invocation by name's are, hands the child those streams instead.
 */
import { isAbsolute, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { Child, ChildExit, Host, ProcessHandle, SpawnOptions } from './types.js';

/** The handle's own streams a run's streams may be: an argv run's, and none for a call by name. */
interface OwnStreams {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
}

/** What one run's `host.spawn` reads: the handle's spawn, and the run's place and streams. */
interface SpawnScene {
  readonly spawn: ProcessHandle['spawn'];
  /** The run's working directory, or `undefined` when its capture could not read it. */
  readonly cwd: string | undefined;
  /** The run's environment, the very map environment preparation adds to. */
  readonly env: Host['env'];
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly own: OwnStreams;
}

/** One output stream's choice as the handle receives it: `inherit` only for the handle's own. */
type OutputChoice = 'capture' | 'ignore' | 'inherit' | Writable;

/** The choice the handle receives for one output stream: the run's own stream unless it is the handle's. */
function outputFor(choice: OutputChoice, run: Writable, own: Writable | undefined): OutputChoice {
  if (choice !== 'inherit') {
    return choice;
  }
  return run === own ? 'inherit' : run;
}

/** A child that never started: the runtime refused it, or the run's cwd could not be read. */
function unstartedChild(reason: Error): Child {
  const exit: ChildExit = { error: reason, kind: 'unstarted' };
  return { exited: Promise.resolve(exit), kill: () => undefined };
}

/** The working directory a child runs in: the run's, or the option resolved against it. */
function childDirectory(run: string | undefined, option: string | undefined): string | undefined {
  if (option !== undefined && isAbsolute(option)) {
    return option;
  }
  if (run === undefined) {
    return undefined;
  }
  return option === undefined ? run : resolve(run, option);
}

/** The options an attached child's call names, the place apart. */
type Attached = Exclude<SpawnOptions, { readonly detached: true }>;

/**
 * Starts an attached child: each output's `inherit` mapped, and a stdin `inherit` passed on only
 * when the run's stdin is the handle's, else the child reads an ended stdin.
 */
function spawnAttached(
  scene: SpawnScene,
  call: { command: string; args: string[]; place: { cwd: string; env: Host['env'] } },
  options: Attached,
): Child {
  const { input, signal, stderr = 'capture', stdin, stdout = 'capture' } = options;
  const attached = {
    ...call.place,
    stderr: outputFor(stderr, scene.stderr, scene.own.stderr),
    stdout: outputFor(stdout, scene.stdout, scene.own.stdout),
    ...(signal === undefined ? {} : { signal }),
  };
  if (stdin === 'inherit') {
    return scene.stdin === scene.own.stdin
      ? scene.spawn(call.command, call.args, { ...attached, stdin: 'inherit' })
      : scene.spawn(call.command, call.args, attached);
  }
  return scene.spawn(
    call.command,
    call.args,
    input === undefined ? attached : { ...attached, input },
  );
}

/**
 * The `host.spawn` of one run. Each call fills `cwd` and `env` and maps `inherit` before it calls
 * the handle; a stdin the run does not share with the handle gives the child an ended stdin.
 */
function hostSpawn(scene: SpawnScene): Host['spawn'] {
  return (command, args, options = {}) => {
    const cwd = childDirectory(scene.cwd, options.cwd);
    if (cwd === undefined) {
      return unstartedChild(new Error('The current working directory cannot be read.'));
    }
    const place = { cwd, env: { ...(options.env ?? scene.env) } };
    if (options.detached === true) {
      return scene.spawn(command, [...args], { ...place, detached: true });
    }
    return spawnAttached(scene, { args: [...args], command, place }, options);
  };
}

export type { OwnStreams };
export { hostSpawn, unstartedChild };
