// JavaScript intentionally supplies section paths that the public tuple types reject.
import { Application, DeclarationError, plugin } from '@loomcli/core';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

function rejectedSections() {
  const values = [[], ['One', 'Two', 'Three'], [1], [' '], ['One\nTwo'], 'One'];
  const rejected = [];
  for (const path of values) {
    for (const slot of ['command', 'local', 'global', 'plugin', 'commands', 'options']) {
      try {
        const value = helpInput({ section: path });
        let app = new Application('invalid');
        switch (slot) {
          case 'command': {
            app = app.extend(helpCommand({ section: path }));
            break;
          }
          case 'local': {
            app = app.option('quiet', { extensions: [value], type: 'boolean' });
            break;
          }
          case 'global': {
            app = app.globalOption('quiet', { extensions: [value], type: 'boolean' });
            break;
          }
          case 'plugin': {
            app = new Application('invalid', {
              plugins: [
                plugin('@fixture/invalid', {
                  options: { quiet: { extensions: [value], type: 'boolean' } },
                }),
              ],
            });
            break;
          }
          case 'commands': {
            app = app.extend(helpCommand({ commandSections: [path] }));
            break;
          }
          case 'options': {
            app = app.extend(helpCommand({ optionSections: [path] }));
            break;
          }
        }
        app.action(() => {}).inspect();
        rejected.push('accepted');
      } catch (error) {
        rejected.push(error instanceof DeclarationError ? error.rule.identity : 'wrong error');
      }
    }
  }
  return rejected;
}

export { rejectedSections };
