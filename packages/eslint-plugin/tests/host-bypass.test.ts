import { hostBypass } from '../src/rules/host-bypass.js';
import { tester } from './support.js';

const bypass = (reached: string, instead: string) => ({
  data: { instead, reached },
  messageId: 'bypass',
});

tester.run('host-bypass', hostBypass, {
  invalid: [
    {
      code: `const dir = process.env.NOTES_DIR;
        const args = process.argv;
        const here = process.cwd();
        const os = [process.platform, process.arch];
        const id = process.getuid();`,
      errors: [
        bypass('process.env', 'host.env instead'),
        bypass('process.argv', 'host.argv instead'),
        bypass('process.cwd()', 'host.cwd instead'),
        bypass('process.platform', 'host.platform instead'),
        bypass('process.arch', 'host.arch instead'),
        bypass('process.getuid()', 'host.uid instead'),
      ],
    },
    {
      code: `process.stdin.read();
        process.stdout.write('a');
        process.stderr.write('b');
        process.exitCode = 1;
        process.exit(2);
        process.on('SIGINT', () => undefined);
        process.once('exit', () => undefined);
        process.pid;
        const whole = process;`,
      errors: [
        bypass('process.stdin', 'host.stdin instead'),
        bypass('process.stdout', 'out instead'),
        bypass('process.stderr', 'out instead'),
        bypass('process.exitCode', 'a result the action returns, or a failure it throws, instead'),
        bypass('process.exit()', 'a result the action returns, or a failure it throws, instead'),
        bypass('process.on()', "onShutdown, and the run's signal, instead"),
        bypass('process.once()', "onShutdown, and the run's signal, instead"),
        bypass('process.pid', "the run's host instead"),
        bypass('process', "the run's host instead"),
      ],
    },
    {
      // A computed member with a literal key reads the same member.
      code: `const value = process['env'];`,
      errors: [bypass('process.env', 'host.env instead')],
    },
    {
      code: `const a = globalThis.process.env;
        const b = global.process;`,
      errors: [
        bypass('globalThis.process.env', 'host.env instead'),
        bypass('global.process', "the run's host instead"),
      ],
    },
    {
      code: `import process from 'node:process';
        import * as proc from 'process';
        import { env, kill } from 'node:process';
        import 'process';`,
      errors: [
        bypass('process', "the run's host instead"),
        bypass('process', "the run's host instead"),
        bypass('process.env', 'host.env instead'),
        bypass('process.kill', "the run's host instead"),
        bypass('process', "the run's host instead"),
      ],
    },
    {
      code: `import { homedir, tmpdir as scratch, userInfo, cpus } from 'node:os';
        homedir();`,
      errors: [
        bypass('homedir()', 'host.home instead'),
        bypass('tmpdir()', 'host.tmpdir instead'),
        bypass(
          'userInfo()',
          'host.uid for who the user is, and host.env.USER for the name to show',
        ),
      ],
    },
    {
      code: `import os from 'os';
        import * as nodeOs from 'node:os';
        const home = os.homedir();
        const tmp = nodeOs.tmpdir();
        const cores = os.cpus();`,
      errors: [bypass('homedir()', 'host.home instead'), bypass('tmpdir()', 'host.tmpdir instead')],
    },
    {
      code: `import { spawn } from 'node:child_process';
        import * as child from 'child_process';
        import 'node:child_process';`,
      errors: [
        bypass('node:child_process', 'host.spawn instead'),
        bypass('child_process', 'host.spawn instead'),
        bypass('node:child_process', 'host.spawn instead'),
      ],
    },
    {
      // An import() with a literal specifier counts as an import.
      code: `async function load() {
          const child = await import('node:child_process');
          const proc = await import('process');
          const home = (await import('node:os')).homedir();
          const os = await import('os');
          return [child, proc, home, os.tmpdir()];
        }`,
      errors: [
        bypass('node:child_process', 'host.spawn instead'),
        bypass('process', "the run's host instead"),
        bypass('homedir()', 'host.home instead'),
        bypass('tmpdir()', 'host.tmpdir instead'),
      ],
    },
    {
      // An entry module is held to the rule like any other, because app.run() binds the real process.
      code: `import { application } from './application.js';
        await application.run({ argv: process.argv.slice(2) });`,
      errors: [bypass('process.argv', 'host.argv instead')],
      filename: 'src/main.ts',
    },
  ],
  valid: [
    // The run's host, and a binding the code declares itself, are not the global.
    `export const run = ({ host }) => host.env.NOTES_DIR ?? host.home;`,
    `function read(process) { return process.env; }`,
    `const { process } = context; process.env;`,
    `const process = { env: {} }; process.env;`,
    // A use the rule cannot trace is not reported.
    `Reflect.get(globalThis, 'process');`,
    `const name = 'node:child_process'; await import(name);`,
    // Os members other than the user's folders, and a type-only import, read nothing.
    `import { cpus, EOL } from 'node:os'; cpus(); EOL;`,
    `import type { ChildProcess } from 'node:child_process';`,
    `import { type ChildProcess } from 'node:child_process';`,
    `import type { Platform } from 'node:process';`,
    // A test file is where a machine fact is handed to a mock.
    {
      code: `import { tmpdir } from 'node:os'; const env = process.env;`,
      filename: 'src/notes.test.ts',
    },
    {
      code: `import { spawnSync } from 'node:child_process'; spawnSync('git');`,
      filename: 'tests/notes.spec.ts',
    },
  ],
});

tester.run('host-bypass destructuring and re-exports', hostBypass, {
  invalid: [
    {
      // A member destructured off a traced os binding reads it as a member read does.
      code: `import os from 'node:os';
        const { userInfo, cpus } = os;
        userInfo();`,
      errors: [
        bypass(
          'userInfo()',
          'host.uid for who the user is, and host.env.USER for the name to show',
        ),
      ],
    },
    {
      code: `import * as nodeOs from 'os';
        const { homedir: home, tmpdir } = nodeOs;`,
      errors: [bypass('homedir()', 'host.home instead'), bypass('tmpdir()', 'host.tmpdir instead')],
    },
    {
      code: `async function load() {
          const { homedir: h, 'tmpdir': t, ...rest } = await import('node:os');
          return [h, t, rest];
        }`,
      errors: [bypass('homedir()', 'host.home instead'), bypass('tmpdir()', 'host.tmpdir instead')],
    },
    {
      code: `export { homedir, cpus } from 'node:os';
        export { tmpdir as scratch } from 'os';
        export * from 'node:os';`,
      errors: [
        bypass('homedir()', 'host.home instead'),
        bypass('tmpdir()', 'host.tmpdir instead'),
        bypass('node:os', 'host.home, host.tmpdir, and host.uid instead'),
      ],
    },
    {
      code: `export { spawn } from 'node:child_process';
        export * from 'child_process';
        export * as child from 'node:child_process';`,
      errors: [
        bypass('node:child_process', 'host.spawn instead'),
        bypass('child_process', 'host.spawn instead'),
        bypass('node:child_process', 'host.spawn instead'),
      ],
    },
    {
      code: `export { env } from 'node:process';
        export * from 'process';`,
      errors: [
        bypass('process.env', 'host.env instead'),
        bypass('process', "the run's host instead"),
      ],
    },
  ],
  valid: [
    // A type-only re-export runs nothing.
    `export type { ChildProcess } from 'node:child_process';`,
    `export { type ChildProcess } from 'node:child_process';`,
    `export type * from 'node:os';`,
    // A member destructured off an os binding that reads no folder.
    `import os from 'node:os'; const { cpus, EOL } = os;`,
    // A destructure of something else.
    `const { homedir } = settings;`,
  ],
});
