import { style } from '@loomcli/core';
import type { ActionHandler, OptionsOf, RegisteredEnvironment, View } from '@loomcli/core';

import type { get } from './commands.js';

// Plugin option names stand in for the contribution types a future rendering context will expose.
// This proves the registration boundary, not an unimplemented styles API.
type Vocabulary = keyof OptionsOf<RegisteredEnvironment['plugins'][number]>;
const render: View<Vocabulary> = { render: (name) => name };
const action: ActionHandler<typeof get> = ({ options }) => {
  const name: Vocabulary = 'identifier';
  // @ts-expect-error TS2820: Registered plugin literal names reach an independently authored action.
  const wrong: Vocabulary = 'identifer';
  return {
    file: options.file,
    rendered: render.render(name, {
      background: undefined,
      columns: undefined,
      expandTabs: (text) => text,
      plain: (text) => text,
      style,
      width: () => 0,
      wrap: (text) => text,
    }),
    wrong,
  };
};
// @ts-expect-error TS2345: A view using the same registered vocabulary rejects unknown names.
render.render('identifer', {
  columns: undefined,
  expandTabs: (text) => text,
  plain: (text) => text,
  style,
  width: () => 0,
  wrap: (text) => text,
});

export { action, render };
