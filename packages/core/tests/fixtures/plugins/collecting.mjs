import { Application, Command, extension, plugin, readExtension } from '@loomcli/core';

const scenario = process.argv[2];
const mode = process.argv[3];

/** Writes one fact, so a test reads the sequence the build or the run produced. */
function note(fact) {
  process.stdout.write(`${JSON.stringify(fact)}\n`);
}

/** How many times each schema below has validated a value, so a test counts the calls. */
const calls = { note: 0 };

/** A Standard Schema that accepts `{ note: string }`, counts each call, and rejects anything else. */
const noteSchema = {
  '~standard': {
    validate(value) {
      calls.note += 1;
      return typeof value?.note === 'string'
        ? { value: { note: value.note } }
        : { issues: [{ message: 'Supply a note' }] };
    },
    vendor: 'fixture',
    version: 1,
  },
};

/** A collecting extension: every value an author or a hook supplies is kept, in order. */
const notes = extension('@fixture/notes/command', {
  collect: true,
  schema: noteSchema,
  target: 'command',
});

/** An ordinary extension: a later value replaces the earlier one. */
const single = extension('@fixture/single/command', { schema: noteSchema, target: 'command' });

/** A second descriptor object under the collecting extension's identity, as a duplicated package copy. */
const twin = extension('@fixture/notes/command', {
  collect: true,
  schema: noteSchema,
  target: 'command',
});

/** A collecting extension on options, which have one layer and no hook call. */
const optionNotes = extension('@fixture/notes/option', {
  collect: true,
  schema: noteSchema,
  target: 'option',
});

/** A plugin whose hook supplies one value of `notes` to the `get` Command alone. */
function supplier(identity, text) {
  return plugin(identity, {
    onCommandAttach: (command) =>
      command.name === 'get' ? command.extend(notes({ note: text })) : command,
  });
}

/** The Command every scenario builds on: two author layers of each extension. */
function get() {
  return new Command('get', {
    extensions: [notes({ note: 'constructor' }), single({ note: 'constructor' })],
  })
    .option('raw', { extensions: [optionNotes({ note: 'option' })], type: 'boolean' })
    .action(({ out }) => out.print('get'))
    .extend(notes({ note: 'layer' }), single({ note: 'layer' }));
}

/** A Command that carries no value of either extension. */
const bare = () => new Command('bare').action(({ out }) => out.print('bare'));

/** A hook that records what it reads off `get` through the typed read and the published record. */
function reading(identity) {
  return plugin(identity, {
    onCommandAttach: (command) => {
      if (command.name === 'get') {
        note({
          notes: readExtension(command, notes),
          reader: identity,
          single: readExtension(command, single),
        });
        note({
          reader: identity,
          record: command.extensions,
          same: command.extensions === command.extensions,
        });
      }
      return command;
    },
  });
}

/** A hook that supplies a value its schema rejects, and optionally catches the throw. */
function rejecting(catching) {
  return plugin('@fixture/rejecting', {
    onCommandAttach: (command) => {
      if (command.name !== 'get') {
        return command;
      }
      if (!catching) {
        return command.extend(notes({ wrong: true }));
      }
      try {
        return command.extend(notes({ wrong: true }));
      } catch (error) {
        note({ caught: error.constructor.name, message: error.message });
        return command.extend(single({ note: 'after the catch' }));
      }
    },
  });
}

/** A hook that throws on `get`, so a test sees which fault that Command's build reports first. */
const throwing = plugin('@fixture/throwing', {
  onCommandAttach: (command) => {
    if (command.name === 'get') {
      throw new Error('the hook failed');
    }
    return command;
  },
});

/** A plugin that lists a hand-built descriptor whose `collect` is the given value or absent. */
function handBuilt(collect) {
  const descriptor = Object.assign(() => undefined, {
    identity: '@fixture/hand/command',
    schema: noteSchema,
    target: 'command',
  });
  if (collect !== 'absent') {
    descriptor.collect = collect;
  }
  return plugin('@fixture/hand', { extensions: [descriptor] });
}

/** An application with nothing but the plugins it installs and a root action. */
function bareApplication(plugins) {
  return new Application('app', { plugins }).action(() => {});
}

/** A plugin that lists a factory-built descriptor whose `collect` is the given non-Boolean value. */
function factoryBuilt(collect) {
  const descriptor = extension('@fixture/factory/command', {
    collect,
    schema: noteSchema,
    target: 'command',
  });
  return plugin('@fixture/factory', { extensions: [descriptor] });
}

/** A Command whose ordinary extension comes first, so a replacement that moved its key would show. */
const ordered = () =>
  new Command('ordered', {
    extensions: [single({ note: 'constructor' }), notes({ note: 'constructor' })],
  }).action(() => {});

const scenarios = {
  'author-first': () =>
    new Application('app', { plugins: [throwing] }).command(
      new Command('get', { extensions: [notes({ wrong: true })] }).action(() => {}),
    ),
  caught: () => new Application('app', { plugins: [rejecting(true)] }).command(get()),
  'discarded-twin': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/discarding', {
          onCommandAttach: (command) => {
            if (command.name === null) {
              command.extend(twin({ note: 'discarded' }));
            }
            return command;
          },
        }),
      ],
    }).command(get()),
  'factory-null': () => bareApplication([factoryBuilt(null)]),
  'factory-yes': () => bareApplication([factoryBuilt('yes')]),
  'hand-absent': () => bareApplication([handBuilt('absent')]),
  'hand-false': () => bareApplication([handBuilt(false)]),
  'hand-yes': () => bareApplication([handBuilt('yes')]),
  hooks: () =>
    new Application('app', {
      plugins: [
        supplier('@fixture/first', 'first hook'),
        plugin('@fixture/replacing', {
          onCommandAttach: (command) =>
            command.name === 'get' ? command.extend(single({ note: 'hook' })) : command,
        }),
        supplier('@fixture/second', 'second hook'),
      ],
    })
      .command(get())
      .command(bare()),
  keys: () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/replacing', {
          onCommandAttach: (command) =>
            command.name === 'ordered' ? command.extend(single({ note: 'hook' })) : command,
        }),
      ],
    }).command(ordered()),
  layers: () => new Application('app').command(get()).command(bare()),
  'option-then-extend': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/both', {
          onCommandAttach: (command) =>
            command.name === 'get'
              ? command.option('extra', { type: 'boolean' }).extend(notes({ note: 'hook' }))
              : command,
        }),
      ],
    }).command(get()),
  reads: () =>
    new Application('app', {
      plugins: [
        reading('@fixture/before'),
        supplier('@fixture/first', 'first hook'),
        reading('@fixture/after'),
      ],
    }).command(get()),
  rejected: () => new Application('app', { plugins: [rejecting(false)] }).command(get()),
  'rejected-twin': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/rejected-twin', {
          onCommandAttach: (command) => {
            if (command.name !== null) {
              return command;
            }
            try {
              return command.extend(twin({ wrong: true }));
            } catch {
              return command;
            }
          },
        }),
      ],
    }).command(get()),
  'returned-twin': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/returning', {
          onCommandAttach: (command) =>
            command.name === null ? command.extend(twin({ note: 'root' })) : command,
        }),
      ],
    }).command(get()),
  'twice-in-call': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/twice', {
          onCommandAttach: (command) => command.extend(notes({ note: 'a' }), notes({ note: 'b' })),
        }),
      ],
    }).command(get()),
  'twice-in-layer': () =>
    new Application('app').command(
      new Command('get', { extensions: [notes({ note: 'a' }), notes({ note: 'b' })] }).action(
        () => {},
      ),
    ),
  'twin-at-call': () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/twin', {
          onCommandAttach: (command) =>
            command.name === 'get' ? command.extend(twin({ note: 'twin' })) : command,
        }),
      ],
    }).command(get()),
  'twin-hooks': () =>
    new Application('app', {
      plugins: [
        supplier('@fixture/first', 'first hook'),
        plugin('@fixture/twin', {
          onCommandAttach: (command) =>
            command.name === 'get' ? command.extend(twin({ note: 'twin' })) : command,
        }),
      ],
    }).command(new Command('get').action(() => {})),
};

const application = scenarios[scenario];

if (mode === 'inspect') {
  const graph = application().inspect();
  const [first, second] = graph.root.children;
  note({ bare: second?.extensions, get: first?.extensions, raw: first?.options[0]?.extensions });
} else if (mode === 'calls') {
  calls.note = 0;
  application().inspect();
  note({ calls: calls.note });
} else if (mode === 'fault') {
  try {
    application().inspect();
    note({ fault: null });
  } catch (error) {
    note({ fault: error.constructor.name, message: error.message });
  }
} else if (mode === 'read') {
  const graph = application().inspect();
  const [first, second] = graph.root.children;
  note({
    bare: readExtension(second, notes),
    emptyFrozen: Object.isFrozen(readExtension(second, notes)),
    frozen: Object.isFrozen(readExtension(first, notes)),
    get: readExtension(first, notes),
  });
  try {
    readExtension(first, twin);
    note({ foreign: null });
  } catch (error) {
    note({ foreign: error.constructor.name, message: error.message });
  }
} else if (mode === 'keys') {
  note(Object.keys(application().inspect().root.children[0].extensions));
} else if (mode === 'options') {
  const [first] = application().inspect().root.children;
  note({
    notes: first.extensions['@fixture/notes/command'],
    options: first.options.map(({ name }) => name),
  });
} else if (mode === 'descriptors') {
  const undefinedCollect = extension('@fixture/undefined/command', {
    collect: undefined,
    schema: noteSchema,
    target: 'command',
  });
  const nullCollect = extension('@fixture/null/command', {
    collect: null,
    schema: noteSchema,
    target: 'command',
  });
  note({
    notes: notes.collect,
    null: nullCollect.collect,
    single: single.collect,
    undefined: undefinedCollect.collect,
  });
}
