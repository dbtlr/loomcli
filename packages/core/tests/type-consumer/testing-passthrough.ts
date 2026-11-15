import { Command, plugin } from '@loomcli/core';
import type { ActionHandler, Middleware } from '@loomcli/core';
import { actionContext, middlewareContext } from '@loomcli/testing';

const plain = new Command('plain');
const forward = new Command('forward').passthrough();
const plainHandler: ActionHandler<typeof plain> = () => undefined;
const forwardHandler: ActionHandler<typeof forward> = () => undefined;
const values = { args: {}, options: {}, provided: {} };
const plainContext = actionContext(plainHandler, values);
// @ts-expect-error TS2339: A mode-off handler has no passthrough member to read.
plainContext.passthrough;
// @ts-expect-error TS2353: A mode-off handler has no passthrough member to state.
actionContext(plainHandler, { ...values, passthrough: [] });
const forwardContext = actionContext(forwardHandler, { ...values, passthrough: ['tail'] });
const tail: string[] = forwardContext.passthrough;
forwardContext.passthrough = tail;

const extension = plugin('test/tail', {});
const middleware: Middleware<typeof extension> = () => undefined;
const context = middlewareContext(middleware, {
  options: null,
  ownOptions: {},
  request: null,
  spellings: {},
  view: null,
});
// @ts-expect-error TS2339: Middleware has no direct passthrough member.
context.passthrough;
if (context.request) {
  const words: readonly string[] = context.request.passthrough;
  void words;
}
