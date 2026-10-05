import { Application, readExtension } from '@loomcli/core';
import { helpArgument, helpCommand, helpInput } from '@loomcli/plugins/help/extension';

const app = new Application('sections', {
  extensions: [
    helpCommand({
      commandSections: [['Work'], ['Work', 'Read']],
      optionSections: [],
      section: ['Root'],
    }),
  ],
})
  .option('quiet', { extensions: [helpInput({ section: ['Output', 'Logging'] })], type: 'boolean' })
  .action(() => {});

const facts = readExtension(app.inspect().root, helpCommand);
const section: readonly string[] | undefined = facts?.section;
const commands: readonly (readonly string[])[] | undefined = facts?.commandSections;
const options: readonly (readonly string[])[] | undefined = facts?.optionSections;
void section;
void commands;
void options;

// @ts-expect-error TS2322: A membership path cannot be empty.
helpCommand({ section: [] });
// @ts-expect-error TS2322: A membership path cannot have three headings.
helpCommand({ section: ['Work', 'Read', 'More'] });
// @ts-expect-error TS2322: An option section heading must be a string.
helpInput({ section: [1] });
// @ts-expect-error TS2322: An option membership path cannot be empty.
helpInput({ section: [] });
// @ts-expect-error TS2322: An option membership path cannot have three headings.
helpInput({ section: ['Output', 'Files', 'More'] });
// @ts-expect-error TS2322: A Command heading must be a string.
helpCommand({ section: [1] });
// @ts-expect-error TS2322: A Command order path cannot be empty.
helpCommand({ commandSections: [[]] });
// @ts-expect-error TS2322: A Command order path cannot have three headings.
helpCommand({ commandSections: [['Work', 'Read', 'More']] });
// @ts-expect-error TS2322: A Command order heading must be a string.
helpCommand({ commandSections: [[1]] });
// @ts-expect-error TS2322: An option order path cannot be empty.
helpCommand({ optionSections: [[]] });
// @ts-expect-error TS2322: An option order path cannot have three headings.
helpCommand({ optionSections: [['Output', 'Files', 'More']] });
// @ts-expect-error TS2322: An option order heading must be a string.
helpCommand({ optionSections: [[1]] });
// @ts-expect-error TS2353: Arguments have no section field.
helpArgument({ section: ['Arguments'] });

if (facts?.section !== undefined) {
  // @ts-expect-error TS2542: Stored paths are readonly.
  facts.section[0] = 'Changed';
}
