import { registerRule } from '../diagnostics/diagnostic-text.js';

/*
 * Core's rules for the declaration faults of Commands: their names, arguments, children, and
 * actions. Each is declared once here and shared by every site that raises it, as a plugin's
 * rules are.
 */

/** An application name, a Command name, or an alias outside the portable name rule. */
const portableName = registerRule('@loomcli/core/portable-name', {
  explanation:
    'An operator types the application name, each Command name, and each alias as a command at a shell prompt. A character outside the POSIX portable filename set needs quoting there, a leading "-" reads as an option, and a leading "." names a file a shell hides.',
  headline: 'Name not portable',
});

/** An argument name outside the declared-name rule. */
const declaredName = registerRule('@loomcli/core/declared-name', {
  explanation:
    'An action reads each argument and option under its name, and help and diagnostics print it. A leading "-" reads as an option, and whitespace or "=" splits the name where the parser reads it.',
  headline: 'Invalid declared name',
});

/** Two arguments with one name on one Command. */
const argumentDeclaredTwice = registerRule('@loomcli/core/argument-declared-twice', {
  explanation:
    'An action reads each argument under its name, so two arguments with one name leave one of them unreadable.',
  headline: 'Argument declared twice',
});

/** An argument after a variadic that cannot reserve exactly one word from the end. */
const argumentAfterVariadic = registerRule('@loomcli/core/argument-after-variadic', {
  explanation:
    "A variadic argument takes the plain words between the arguments before it and the arguments after it, so each argument after it fills from the end of the line with exactly one word. Only a required scalar argument always takes exactly one word: an optional argument, a second variadic, an argument required only when input is not interactive, or a content argument after a variadic would leave the parser unable to tell where the variadic's words end.",
  headline: 'Argument after variadic not a required scalar',
});

/** A required argument that an optional argument precedes. */
const optionalArgumentLast = registerRule('@loomcli/core/optional-argument-last', {
  explanation:
    "Bare words fill the arguments in order, and an operator leaves out optional arguments from the end of the line. A required argument after an optional one would leave the parser unable to tell which of the two a lone bare word fills, and one after an argument required only when input is not interactive would keep that argument's question from ever being asked at a terminal. A content argument whose min is positive counts as required here, because it must receive a source.",
  headline: 'Required argument after optional',
});

/** A child whose name or alias repeats a sibling's name or alias. */
const siblingNameTaken = registerRule('@loomcli/core/sibling-name-taken', {
  explanation:
    'Every canonical name and alias under one parent routes one token to one child, so a name that two siblings share cannot route.',
  headline: 'Name taken by a sibling',
});

/** One Command value attached at two places. */
const commandAttachedTwice = registerRule('@loomcli/core/command-attached-twice', {
  explanation:
    'A Command value sits at one place in the tree, where its path, its help page, and its parent read it, so one value attached at two places would have two paths.',
  headline: 'Command attached twice',
});

/** A Command with neither an action nor children. */
const commandWithoutAction = registerRule('@loomcli/core/command-without-action', {
  explanation:
    "Routing ends at a Command that runs its action, or passes on to one of a group's children. A Command with neither leaves an invocation that reaches it nothing to run. A group that declares an argument, stdin, the passthrough mode, or that it needs a terminal has the same fault, because those declarations reach no action.",
  headline: 'Nothing to run',
});

export {
  argumentDeclaredTwice,
  commandAttachedTwice,
  commandWithoutAction,
  declaredName,
  optionalArgumentLast,
  portableName,
  siblingNameTaken,
  argumentAfterVariadic,
};
