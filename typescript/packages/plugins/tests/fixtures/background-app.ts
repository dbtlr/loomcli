import { Application } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { loomTheme } from '@loomcli/plugins/theme';

/**
 * An application that installs the Loom theme and the background plugin, beside help and the
 * manifest. Its action prints the highlight token and the settled background.
 */
function backgroundApplication() {
  const plugins = [help(), manifest(), loomTheme(), background()];
  return new Application('notes', { description: 'Keep notes.', plugins, version: '1.0.0' })
    .globalOption('tag', { description: 'Tag the note.', type: 'string' })
    .action(({ host, out, style }) =>
      out.print(`${style.highlight('Saved')} ${host.terminal.background ?? 'undefined'}`),
    );
}

export { backgroundApplication };
