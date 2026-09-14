import { Application, plugin, style } from '@loomcli/core';

const scenario = process.argv[2];
const env = { FORCE_COLOR: scenario === 'fresh' ? '1' : '', TERM: 'linux' };
const app = new Application('styles', {
  plugins:
    scenario === 'theme'
      ? [plugin('palette', { theme: { identifier: style.cyan, info: style.green.bold } })]
      : [],
  rendering: ['destinations', 'fresh'].includes(scenario)
    ? {}
    : { color: 'always', modifiers: 'always' },
}).action(({ out, style: contextual }) => {
  if (scenario === 'fresh') {
    env.FORCE_COLOR = '';
    return out.render(style.red('X'), {
      render: (value, context) => {
        if (!Object.isFrozen(context)) {
          throw new Error(`Scenario "${scenario}": renderer context is not frozen.`);
        }
        if (context.style !== contextual) {
          throw new Error(`Scenario "${scenario}": renderer context does not use the run's style.`);
        }
        return value;
      },
    });
  }
  if (scenario === 'theme') {
    out.info('ready');
    return out.print(contextual.identifier('custom'));
  }
  if (scenario === 'nesting') {
    return out.print(style.red(`A${style.blue('B')}C`));
  }
  if (scenario === 'destinations') {
    out.print(style.red('plain'));
    return out.info(`${style.red('ready')}\nnext`);
  }
  throw new Error(`Unknown scenario: ${scenario}`);
});
const options = {
  host: {
    argv: [],
    env,
    platform: 'linux',
    terminal: {
      stderr: { isTTY: true },
      stdin: { isTTY: false },
      stdout: { isTTY: false },
    },
  },
};
await app.run(options);
if (scenario === 'fresh') {
  await app.run(options);
}
