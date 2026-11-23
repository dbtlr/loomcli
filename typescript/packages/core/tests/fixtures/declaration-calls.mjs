import { Application, Command, DeclarationError, extension } from '@loomcli/core';
import { z } from 'zod';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { stdout: writeStdout } = fixture;
  try {
    const leaf = (name) => new Command(name).action(act);

    /** Two distinct descriptors under one identity, which one Application may hold only one of. */
    const note = z.object({ text: z.string() });
    const first = extension('@fixture/calls/note', { schema: note, target: 'command' });
    const second = extension('@fixture/calls/note', { schema: note, target: 'command' });

    /** Every property name a value reaches through its own keys and its prototype chain. */

    /** The outcome of one call: `ok`, or the declaration fault it threw. */

    /** A root child whose subtree fails to join after its first nodes were walked. */
    function failing(shared, extensions) {
      return new Command('grp', { extensions })
        .command(shared)
        .command(new Command('bad').option('g', { type: 'string' }).action(act));
    }

    const scenarios = {
      // A join that throws registers no descriptor, so a later subtree may bring its own under the identity.
      'descriptors-after-fault': () => {
        const base = new Application('app').globalOption('g', { type: 'string' });
        return [
          attempt(() => base.command(failing(leaf('shared'), [first({ text: 'one' })]))),
          attempt(() =>
            base
              .command(new Command('other', { extensions: [second({ text: 'two' })] }).action(act))
              .action(act)
              .inspect(),
          ),
        ];
      },
      // A named parent receives a child that has children, outside any Application.
      // A join that throws claims no node, so the value it walked attaches at another point after it.
      'owners-after-fault': () => {
        const base = new Application('app').globalOption('g', { type: 'string' });
        const shared = leaf('shared');
        return [
          attempt(() => base.command(failing(shared, []))),
          attempt(() => base.command(new Command('grp2').command(shared)).action(act).inspect()),
        ];
      },
      surface: () => {
        const command = new Command('get').action(act);
        return { declared: 'declared' in command, members: members(command) };
      },
    };

    writeStdout(`${JSON.stringify(scenarios[words[0]]())}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const act = ({ out }) => out.print('ran');
function members(value) {
  const names = new Set();
  for (let target = value; target && target !== Object.prototype;) {
    for (const key of Reflect.ownKeys(target)) {
      names.add(String(key));
    }
    target = Object.getPrototypeOf(target);
  }
  return [...names].toSorted((left, right) => left.localeCompare(right));
}
function attempt(call) {
  try {
    call();
    return 'ok';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return `thrown: ${ruleText(error)}`;
  }
}

export { runFixture as run };
