import { Application, Command, DeclarationError, extension } from '@loomcli/core';
import { z } from 'zod';

const act = ({ out }) => out.print('ran');

const leaf = (name) => new Command(name).action(act);

/** Two distinct descriptors under one identity, which one Application may hold only one of. */
const note = z.object({ text: z.string() });
const first = extension('@fixture/calls/note', { schema: note, target: 'command' });
const second = extension('@fixture/calls/note', { schema: note, target: 'command' });

/** Every property name a value reaches through its own keys and its prototype chain. */
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

/** The outcome of one call: `ok`, or the declaration fault it threw. */
function attempt(call) {
  try {
    call();
    return 'ok';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return `thrown: ${error.message}`;
  }
}

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
  'named-parent': () => {
    const cache = new Command('cache').command(leaf('clear'));
    return [attempt(() => new Command('store').command(cache))];
  },
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

process.stdout.write(`${JSON.stringify(scenarios[process.argv[2]]())}\n`);
