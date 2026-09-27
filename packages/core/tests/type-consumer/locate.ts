import { Application, Command, locate } from '@loomcli/core';
import type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  OptionNode,
  WordPosition,
} from '@loomcli/core';

// An action reads the frozen graph and its routed node beside its own inputs.
const keys = new Command('keys').action(({ command, graph }) => {
  const node: CommandNode = command;
  const inspected: CommandGraph = graph;
  // @ts-expect-error The graph is read-only on the action context.
  graph.name = 'other';
  void node;
  void inspected;
});

const graph = new Application('kit').command(keys).inspect();
const position: WordPosition = locate(graph, ['keys', '--']);

// Each kind carries its own members, so a reader narrows before reading one.
function describe(found: WordPosition): string {
  switch (found.kind) {
    case 'none': {
      return 'none';
    }
    case 'value': {
      const option: OptionNode = found.option;
      return `${option.name}${found.lead}${found.prefix}`;
    }
    case 'argument': {
      const argument: ArgumentNode = found.argument;
      return argument.name;
    }
    case 'option': {
      const supplied: readonly string[] = found.supplied;
      return supplied.join(',');
    }
    case 'command':
    case 'passthrough': {
      return found.prefix;
    }
  }
}

// @ts-expect-error Only a value position names an option.
void position.option;

void describe;
