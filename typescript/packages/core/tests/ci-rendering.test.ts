/*
 * Acceptance plan for rendering under CI (docs/core/styles.md#rendering-policies).
 *
 * - Color. On a terminal under CI, automatic color and modifiers follow supports-color's CI block:
 *   `GITHUB_ACTIONS`, `GITEA_ACTIONS`, and `CIRCLECI` resolve a hex style in truecolor; `TRAVIS`,
 *   `APPVEYOR`, `GITLAB_CI`, `BUILDKITE`, `DRONE`, and `CI_NAME=codeship` resolve it in 16 colors
 *   whatever `TERM` reports; any other CI writes the text with no color and no modifier. A nonempty
 *   `FORCE_COLOR` still turns color on at `TERM`'s depth under an unlisted CI, keeps the viewer's
 *   depth under a listed one, and `CI=false` leaves detection as it is.
 * - Hyperlinks. On a terminal under CI, an embedded hyperlink is stripped to its visible text, as
 *   it is off a terminal, and outside CI it is kept.
 */

import { Application } from '@loomcli/core';
import type { ActionContext } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** What stdout receives when an action prints `text` on a terminal under `env`. */
async function printed(env: Record<string, string>, text: (style: Style) => string) {
  const app = new Application('render').action(async ({ out, style }) => {
    await out.print(text(style));
  });
  const mock = mockProcess({ env, terminal: { columns: 80, rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return mock.stdout.text;
}

/** The style an action reads. */
type Style = ActionContext<unknown>['style'];

/** A bold hex color with both fallbacks, so its bytes name the depth it resolved at. */
const sienna = (style: Style) => style.hex('#C97B36', { ansi16: 'yellow', ansi256: 172 }).bold('x');

const truecolor = '\u001B[38;2;201;123;54;1mx\u001B[39;22m\n';
const basic = '\u001B[33;1mx\u001B[39;22m\n';
const indexed = '\u001B[38;5;172;1mx\u001B[39;22m\n';

test.each([
  { env: { CI: 'true', GITHUB_ACTIONS: 'true' }, written: truecolor },
  { env: { CI: 'true', GITEA_ACTIONS: 'true' }, written: truecolor },
  { env: { CI: 'true', CIRCLECI: 'true' }, written: truecolor },
  { env: { CI: 'true', TRAVIS: 'true' }, written: basic },
  { env: { APPVEYOR: 'True', CI: 'True' }, written: basic },
  { env: { CI: 'true', GITLAB_CI: 'true' }, written: basic },
  { env: { BUILDKITE: 'true', CI: 'true' }, written: basic },
  { env: { CI: 'true', DRONE: 'true' }, written: basic },
  { env: { CI: 'true', CI_NAME: 'codeship' }, written: basic },
  { env: { CI: 'true' }, written: 'x\n' },
  { env: { CI: 'true', FORCE_COLOR: '1' }, written: indexed },
  { env: { CI: 'true', FORCE_COLOR: '1', GITHUB_ACTIONS: 'true' }, written: truecolor },
  { env: { CI: 'false' }, written: indexed },
])(
  'on a terminal with TERM=xterm-256color and $env, a hex style writes $written',
  async ({ env, written }) => {
    await expect(
      printed({ TERM: 'xterm-256color', ...env }, (style) => sienna(style)),
    ).resolves.toBe(written);
  },
);

test.each([
  { env: { CI: 'true', GITHUB_ACTIONS: 'true' }, written: 'docs\n' },
  { env: {}, written: '\u001B]8;;https://example.com\u0007docs\u001B]8;;\u0007\n' },
])('on a terminal with $env, an embedded hyperlink writes $written', async ({ env, written }) => {
  const link = '\u001B]8;;https://example.com\u0007docs\u001B]8;;\u0007';
  await expect(printed({ TERM: 'xterm', ...env }, () => link)).resolves.toBe(written);
});
