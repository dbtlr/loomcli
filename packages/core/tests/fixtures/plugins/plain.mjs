import { Application, extension, readExtension } from '@loomcli/core';

const dispatch = ({ out }) => out.print('dispatched');

/** A schema whose validate call is the scenario's own, so the stored output is what it produced. */
const schemaOf = (validate) => ({ '~standard': { validate, vendor: 'fixture', version: 1 } });

/** An output the scenario fixed before build, for the shapes the walk accepts. */
function output(value) {
  return () => ({ value });
}

/**
 * One application whose root carries one extension value, inspected, so a scenario reads the stored
 * output back through the graph and through `readExtension`.
 */
function inspected(validate, options = {}) {
  const identity = options.identity ?? '@fixture/plain';
  const descriptor = extension(identity, { schema: schemaOf(validate), target: 'command' });
  const graph = new Application('app', { extensions: [descriptor(options.input ?? {})] })
    .action(dispatch)
    .inspect();
  return { descriptor, graph, stored: readExtension(graph.root, descriptor) };
}

/** A chain of nested objects, built without recursion so the fixture itself never overflows. */
function nested(depth) {
  let value = { leaf: true };
  for (let level = 0; level < depth; level += 1) {
    value = { next: value };
  }
  return value;
}

/** The same chain read back without recursion, so the report never overflows either. */
function depthOf(value) {
  let depth = 0;
  let node = value;
  while (node?.next) {
    node = node.next;
    depth += 1;
  }
  return depth;
}

const scenarios = {
  deep: () => {
    const { graph, stored } = inspected(output(nested(10_000)));
    return { depth: depthOf(stored), keys: Object.keys(graph.root.extensions) };
  },
  frozen: () => {
    const { graph } = inspected(output({ note: 'read' }));
    let rejected = false;
    try {
      graph.root.extensions['@fixture/forged'] = { note: 'written' };
    } catch (error) {
      rejected = error instanceof TypeError;
    }
    return { frozen: Object.isFrozen(graph.root.extensions), rejected };
  },
  mutated: () => {
    const input = { list: ['one'], note: 'read' };
    const { stored } = inspected((value) => ({ value }), { input });
    input.list.push('two');
    input.note = 'written';
    return { input, stored };
  },
  'proto-identity': () => {
    const { graph, stored } = inspected(output({ note: 'read' }), { identity: '__proto__' });
    const record = graph.root.extensions;
    return {
      keys: Object.keys(record),
      prototype: Object.getPrototypeOf(record) === Object.prototype,
      stored,
    };
  },
  'proto-key': () => {
    const { graph, stored } = inspected(
      output(JSON.parse('{"__proto__":{"polluted":true},"a":1}')),
    );
    const carried = Object.getOwnPropertyDescriptor(stored, '__proto__');
    return {
      keys: Object.keys(graph.root.extensions),
      names: Object.getOwnPropertyNames(stored),
      // Nothing reached `Object.prototype`, so no other object gained the key.
      polluted: Object.prototype.polluted ?? null,
      prototype: Object.getPrototypeOf(stored) === Object.prototype,
      value: carried === undefined ? null : carried.value,
    };
  },
};

process.stdout.write(`${JSON.stringify(scenarios[process.argv[2]]())}\n`);
