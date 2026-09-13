import { Command } from '@loomcli/core';

const direct: Command = new Command('direct').action(() => {});
function factory(): Command {
  return new Command('factory').action(() => {});
}
const build = new Command('build')
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(({ args, options, out }) => {
    const path: string = args.path;
    const raw: boolean = options.raw;
    // @ts-expect-error TS2339: A library has no consumer registration.
    options.file;
    out.print(`${path}:${String(raw)}`);
  });
const colliding = new Command('collision').option('file', { type: 'boolean' }).action(() => {});

export { direct, factory, build, colliding };
