import {
  Application,
  lanes,
  override,
  plugin,
  UnknownOptionError,
  UsageError,
} from '@loomcli/core';
import type {
  CommandGraph,
  CommandNode,
  ContextualStyle,
  FailureHook,
  FailureHookContext,
  FailureView,
  FailureViewContext,
  PluginDefinition,
  View,
  ViewContext,
} from '@loomcli/core';

// A failure view reads where the run was and the hints the plugins added.
const located: FailureView<UsageError> = {
  render: (failure, { application, hints, path, style }) =>
    [`${[application, ...path].join(' ')}: ${style.escape(failure.message)}`, ...hints]
      .map((line) => `${line}\n`)
      .join(''),
};

// A view written against the plain view context stays a valid failure override.
const plain: View<UsageError> = { render: (failure) => `${failure.message}\n` };

// The failure view context is a view context, so a helper that reads one reads the other.
const measured = (context: ViewContext): number => context.width('x');
const readsLess = (context: FailureViewContext): number => measured(context);

const app = new Application('store', {
  views: [override(UsageError, located), override(UsageError, plain)],
});

// A hook reads the failure, where the run was, the stderr style, the graph, and the node at the path.
const suggest: FailureHook = (failure, context: FailureHookContext) => {
  const graph: CommandGraph = context.graph;
  const command: CommandNode = context.command;
  const style: ContextualStyle = context.style;
  const path: readonly string[] = context.path;
  void [graph.globals, command.options, path, context.application];
  if (!(failure instanceof UnknownOptionError)) {
    return undefined;
  }
  return [`${style.escape(failure.spelling)}: did you mean --file?`];
};

const definition: PluginDefinition = { onFailure: suggest };
const suggesting = plugin('@acme/suggest', { onFailure: () => 'one hint' });

// @ts-expect-error TS2322: A hook returns hints, not a number.
const counted: PluginDefinition = { onFailure: () => 7 };

// @ts-expect-error TS2322: A hook is synchronous, so it returns no promise.
const late: PluginDefinition = { onFailure: async () => 'late' };

const rewords: FailureHook = (failure) => {
  // @ts-expect-error TS2540: A hook reads the failure and cannot change it.
  failure.message = 'reworded';
  return undefined;
};

// @ts-expect-error TS2339: A failure view's context carries no command.
const noCommand: FailureView<UsageError> = { render: (failure, { command }) => String(command) };

// @ts-expect-error TS2769: A lane view reads the plain view context, which carries no application.
override(lanes.warn, {
  render: (message: string, { application }: FailureViewContext) => message + application,
});

// @ts-expect-error TS2339: The hints are read, never written.
const pushes: FailureView<UsageError> = { render: (failure, { hints }) => String(hints.push('x')) };

void [app, definition, suggesting, counted, late, rewords, noCommand, pushes, readsLess];
