import { Application, nowrap, override, style, view } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { heading } from '@loomcli/plugins/heading';
import { list } from '@loomcli/plugins/list';
import { prose } from '@loomcli/plugins/prose';
import { rule } from '@loomcli/plugins/rule';
import { table } from '@loomcli/plugins/table';
import { loomTheme } from '@loomcli/plugins/theme';

/**
 * One list, heading, rule, prose, or box render per entry of `widths`, on a host whose stdout
 * width is read live: a number is a terminal that wide, and null is a pipe. The input is JSON in
 * argv[2]: { view, config?, data, widths, build?, declared?, invoke?, rendering? }. A list `format` or
 * `children` and a box `content` are names of the functions and views below, because JSON carries
 * no functions. With `declared`, the view is the default of a declared result, `rows` over array
 * data and `result` over a string, and renders once through `out.results`. With `invoke`,
 * the render runs as an invocation by name and prints its output. Data of `@@red-empty@@` or
 * `@@nowrap-empty@@` is a red style frame or a `nowrap` frame around nothing, which JSON cannot
 * carry. `build` names the release build, distributed by default, and `theme` installs the Loom theme with `primary` in cyan, so it shows.
 */
const input = JSON.parse(process.argv[2]);

const formats = {
  index: (item, index) => `${String(index)}:${item.name}`,
  name: (item) => item.name,
  raw: (item) => String(item),
};

/** Marked text around nothing, by the name the input gives it. */
const marked = { '@@nowrap-empty@@': nowrap(''), '@@red-empty@@': style.red('') };

/** The data, with each `@@undefined@@` item of an array read as undefined, which JSON cannot carry. */
const data = Array.isArray(input.data)
  ? input.data.map((item) => (item === '@@undefined@@' ? undefined : item))
  : (marked[input.data] ?? input.data);

const release = { build: input.build ?? 'distributed' };

/** A declared table the Application overrides, so a render outside a box shows the override. */
const declaredTable = view('@fixture/pack-views/table', table());

/** A content view that ignores `columns` and writes one line 50 columns wide. */
const wide = { render: () => `${'w'.repeat(50)}\n` };

/** The content one box config names. */
function content(name) {
  if (name === undefined) {
    return undefined;
  }
  if (name === 'declared') {
    return declaredTable;
  }
  if (name === 'wide') {
    return wide;
  }
  if (name === 'prose') {
    return prose();
  }
  return table(name.table);
}

/** The view the input names, with each named function swapped for its value. */
function configured() {
  const config = input.config ?? {};
  switch (input.view) {
    case 'list': {
      return list({
        ...(config.ordered === undefined ? {} : { ordered: config.ordered }),
        ...(config.format === undefined ? {} : { format: formats[config.format] }),
        ...(config.children ? { children: (item) => item.parts } : {}),
      });
    }
    case 'heading': {
      return heading(config);
    }
    case 'rule': {
      return rule();
    }
    case 'prose': {
      return prose();
    }
    default: {
      const framed = content(config.content);
      return box({
        ...(config.title === undefined ? {} : { title: config.title }),
        ...(framed === undefined ? {} : { content: framed }),
      });
    }
  }
}

const selected = configured();

let current = input.widths[0];
const output = {
  get columns() {
    return typeof current === 'number' ? current : undefined;
  },
  isTTY: input.widths[0] !== null,
  rows: 24,
};

const base = new Application('pack-views', {
  description: 'Render a pack view at a live width.',
  plugins: input.theme ? [loomTheme({ primary: style.cyan })] : [],
  views: [override(declaredTable, { render: () => 'override\n' })],
});

/** The application: a declared result over the data, or an action that renders it per width. */
function application() {
  if (input.declared) {
    const declared = Array.isArray(data)
      ? base.rows({ views: { view: selected } })
      : base.result({ views: { view: selected } });
    return declared.action(({ out }) => out.results(data));
  }
  return base.action(async ({ out }) => {
    if (input.view === 'box' && input.config?.content === 'declared') {
      await out.render(data, declaredTable);
    }
    for (const [index, width] of input.widths.entries()) {
      current = width;
      if (index > 0) {
        await out.print('--');
      }
      await out.render(data, selected);
    }
  });
}

const app = application();

if (input.invoke) {
  const host = { env: {}, platform: 'linux', release };
  const outcome = await app.invoke([], {}, { host });
  process.stdout.write(outcome.output);
} else {
  await app.run({
    host: {
      argv: [],
      env: {},
      platform: 'linux',
      release,
      terminal: { stderr: { isTTY: false }, stdin: { isTTY: false }, stdout: output },
    },
    rendering: input.rendering ?? { color: 'never', modifiers: 'never' },
  });
}
