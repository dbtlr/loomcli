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

// A declaration that carries a result satisfies a neutral annotation.
// The result's neutral type is unknown, so a consumer attaches it like any other Command.
const summarize: Command = new Command('summarize')
  .result<{ total: number }>({ views: { total: { render: ({ total }) => `${String(total)}\n` } } })
  .action(({ out }) => out.results({ total: 0 }));

export { direct, factory, build, colliding, summarize };
