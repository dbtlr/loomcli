import { completionArgument, completionInput } from '@loomcli/plugins/completion/extension';

// An input holds one hint: files, files by extension, directories, or nothing.
// An argument may hold Commands instead.
const files = completionInput({ files: true });
const extensions = completionInput({ extensions: ['json', 'tar.gz'] });
const directories = completionArgument({ directories: true });
const none = completionArgument({ none: true });
const commands = completionArgument({ commands: true });

// @ts-expect-error TS2322: An input completes one way, so a value never holds two hints.
const two = completionInput({ directories: true, files: true });

// @ts-expect-error TS2322: A hint that is on is `true`.
const off = completionInput({ none: false });

// @ts-expect-error TS2322: Extensions are a list of names.
const bare = completionInput({ extensions: 'json' });

// @ts-expect-error TS2322: Only an argument completes Commands, so an option never holds the hint.
const optionCommands = completionInput({ commands: true });

export { bare, commands, directories, extensions, files, none, off, optionCommands, two };
