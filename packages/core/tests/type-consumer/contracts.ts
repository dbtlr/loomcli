import { Application } from '@loomcli/core';

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

// @ts-expect-error TS2554: A globals type argument still requires its GlobalOptions value.
new Application<{ forged: number }>('forged');

void new Application('host-override').run({
  host: {
    // @ts-expect-error TS2353: Host overrides cannot control the exit code.
    setExitCode() {},
  },
});
