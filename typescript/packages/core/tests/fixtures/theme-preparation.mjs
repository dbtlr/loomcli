import { Application, DeclarationError, override, plugin, style } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    const scenario = words[0];
    const invalid = override(DeclarationError, {
      render: (_failure, context) => `${context.style.issue('invalid')}\n`,
    });

    /** A hook that rejects the Command with a declaration fault, which only the graph build meets. */
    const failing = plugin('failing', {
      onCommandAttach: () => {
        throw new DeclarationError('The hook rejects the Command.');
      },
    });

    const app = new Application('theme-preparation', {
      plugins: [
        plugin('palette', { theme: { issue: style.cyan } }),
        ...(scenario === 'hook' ? [failing] : []),
      ],
      rendering: { color: 'always' },
      views: [invalid],
    });
    // A root with neither children nor an action is final only at build, so both scenarios build and fail.
    const configured = scenario === 'hook' ? app.action(() => undefined) : app;
    await configured.run({
      process: createProcess({ argv: [], env: {}, release: { build: 'distributed' } }),
    });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
