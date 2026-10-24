import { Application, processHandle } from '@loomcli/core';

new Application('inline')
  .argument('files', { required: true, variadic: true })
  .action(async ({ args, host, out }) => {
    const files: string[] = args.files;
    const cwd: string = host.cwd;
    await out.print(`${cwd}: ${files.join(', ')}`);

    // @ts-expect-error TS2322: Files contain strings, never numbers.
    const invalidFiles: number[] = args.files;
    // @ts-expect-error TS2339: Only declared arguments exist.
    args.unknown;
    // @ts-expect-error TS2345: Output requires a string.
    await out.print(123);
    // @ts-expect-error TS2339: The Host cannot set an exit code.
    host.setExitCode(5);
    return invalidFiles;
  });

new Application('documents')
  .argument('documents', { required: true, variadic: true })
  .action(({ args }) => {
    const documents: string[] = args.documents;
    // @ts-expect-error TS2339: Another Application cannot add arguments here.
    args.files;
    return documents.length;
  });

new Application('files')
  .argument('files', { required: true, variadic: true })
  .action(({ args }) => {
    const files: string[] = args.files;
    // @ts-expect-error TS2339: Argument inference stays local to this Application.
    args.documents;
    return files;
  });

new Application('sync-return').action(() => ({ ignored: true }));
new Application('async-return').action(async () => Promise.resolve('ignored'));

// @ts-expect-error TS2554: The Application constructor has no global output type parameter.
new Application<{ forged: number }>('forged');

// A handle takes no supplied exitCode, signals, or publishEnv: processHandle decides each itself.
void new Application('handle-fields').run({
  process: processHandle({
    // @ts-expect-error TS2353: A supplied field cannot set the exit code core writes.
    exitCode: 0,
  }),
});
void new Application('handle-fields').run({
  process: processHandle({
    // @ts-expect-error TS2353: A supplied field cannot replace the real process's signal source.
    signals: processHandle().signals,
  }),
});
void new Application('handle-fields').run({
  process: processHandle({
    // @ts-expect-error TS2353: A supplied field cannot replace where environment additions go.
    publishEnv: () => undefined,
  }),
});
