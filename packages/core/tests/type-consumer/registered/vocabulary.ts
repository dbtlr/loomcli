import type { ActionHandler, OptionsOf, RegisteredEnvironment, Renderer } from '@loomcli/core';

import type { get } from './commands.js';

// Plugin option names stand in for the contribution types a future rendering context will expose.
// This proves the registration boundary, not an unimplemented styles API.
type Vocabulary = keyof OptionsOf<RegisteredEnvironment['plugins'][number]>;
const render: Renderer<Vocabulary> = { render: (name) => name };
const action: ActionHandler<typeof get> = ({ options }) => {
  const name: Vocabulary = 'identifier';
  // @ts-expect-error TS2322: Registered plugin literal names reach an independently authored action.
  const wrong: Vocabulary = 'identifer';
  return { file: options.file, rendered: render.render(name), wrong };
};
// @ts-expect-error TS2345: A renderer using the same registered vocabulary rejects unknown names.
render.render('identifer');

export { action, render };
