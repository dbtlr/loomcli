import { escapeControlCharacters } from './controls.js';
import { registerRule } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { commandSentence, DeclarationError, quoted } from './errors.js';
import type { InputProblem } from './errors.js';
import { absentBoolean, isSupplied, reportedOf, spellingsOf } from './options.js';
import type { OptionValues, SpellingTable } from './options.js';
import type { InputDeclaration } from './validation.js';

/** A relationship over supplied local options, in declaration order. */
interface OptionGroup {
  readonly kind: 'exclusive' | 'oneRequired' | 'requiredTogether';
  readonly options: readonly string[];
}

const groupDeclaration = registerRule('@loomcli/core/option-group', {
  explanation:
    'An option group relates already-declared local options. Its members must be distinct and its rules must permit those options to be used.',
  headline: 'Invalid option group',
});

type Fault = (sentence: string, correction: string) => never;

interface Declaration {
  readonly name: string | null;
  readonly inputs: readonly InputDeclaration[];
  readonly groups: readonly OptionGroup[];
  readonly kind: OptionGroup['kind'];
  readonly names: readonly string[];
}

function checkMembers({ inputs, kind, names, name }: Declaration, fail: Fault): void {
  const subject = commandSentence(name);
  if (names.length < 2) {
    fail(
      `${subject} declares ${kind} with fewer than two options.`,
      'Name at least two local options.',
    );
  }
  const seen = new Set<string>();
  for (const member of names) {
    if (seen.has(member)) {
      fail(`${subject} ${kind} repeats option ${quoted(member)}.`, 'Name each option once.');
    }
    seen.add(member);
    if (!inputs.some((input) => input.kind === 'option' && input.name === member)) {
      fail(
        `${subject} ${kind} names undeclared local option ${quoted(member)}.`,
        'Declare the local option before naming it in a group.',
      );
    }
  }
}

/** Named calls cannot substitute stdin for a required content path. */
function requiresPresence(input: InputDeclaration): boolean {
  if (input.config.type === 'content') {
    return input.config.required === true || (input.config.min ?? 0) > 0;
  }
  return input.config.type === 'string' && Boolean(input.config.required);
}

/** Only pairs involving the new rule need checking; earlier declarations were already checked. */
function checkConflicts(declaration: Declaration, group: OptionGroup, fail: Fault): void {
  const exclusive =
    group.kind === 'exclusive'
      ? [group]
      : declaration.groups.filter((each) => each.kind === 'exclusive');
  const together =
    group.kind === 'requiredTogether'
      ? [group]
      : declaration.groups.filter((each) => each.kind === 'requiredTogether');
  const subject = commandSentence(declaration.name);
  for (const rule of exclusive) {
    const required = declaration.inputs.find(
      (input) =>
        input.kind === 'option' && rule.options.includes(input.name) && requiresPresence(input),
    );
    if (required) {
      fail(
        `${subject} exclusive group contains required option ${quoted(required.name)}.`,
        'Remove the presence requirement or remove the exclusive group.',
      );
    }
    if (
      together.some(
        (other) => rule.options.filter((name) => other.options.includes(name)).length >= 2,
      )
    ) {
      fail(
        `${subject} exclusive and requiredTogether groups share at least two options.`,
        'Remove one of the conflicting group rules.',
      );
    }
  }
}

/** Contradictions are direct pairs, never a transitive constraint solver. */
function declareGroup(declaration: Declaration): OptionGroup {
  const { name, kind, names } = declaration;
  const finding: Finding = { arguments: names, call: kind, path: name === null ? [] : [name] };
  const fail: Fault = (sentence, correction) => {
    throw new DeclarationError(groupDeclaration, { correction, findings: [finding], sentence });
  };
  checkMembers(declaration, fail);
  const group: OptionGroup = Object.freeze({ kind, options: Object.freeze([...names]) });
  checkConflicts(declaration, group, fail);
  return group;
}

/** The input tier that supplied an option's value. `tierRanks` orders them, argv highest. */
type Tier = 'argv' | 'configuration' | 'environment';

const tierRanks: Readonly<Record<Tier, number>> = {
  argv: 3,
  configuration: 1,
  environment: 2,
};

/** Each Boolean option's absent value, by name, the value its polarity gives an unsupplied option. */
function absentBooleans(inputs: readonly InputDeclaration[]): ReadonlyMap<string, boolean> {
  return new Map(
    inputs.flatMap((input): [string, boolean][] =>
      input.kind === 'option' && input.config.type === 'boolean'
        ? [[input.name, absentBoolean(input.config)]]
        : [],
    ),
  );
}

/**
 * Whether one member claims its exclusive group: a tier supplied it, and it is not a Boolean at its
 * absent value. Such a Boolean neither wins the group nor conflicts, and stays supplied.
 */
function claims(values: OptionValues, name: string, absent: ReadonlyMap<string, boolean>): boolean {
  const value = values.booleans.get(name);
  return isSupplied(values, name) && (value === undefined || value !== absent.get(name));
}

/** What decides which members of an exclusive group lose: the tier of each, and the rejected variables. */
interface TierContext {
  /** The names of the options whose bound variable is outside its grammar and filled nothing. */
  readonly rejected: ReadonlySet<string>;
  /** The tier that supplied one option a claim, or `undefined` when none did. */
  readonly tierOf: (name: string) => Tier | undefined;
}

/**
 * The members that lose their exclusive group: those a lower tier claimed beside a sibling a
 * higher tier claimed, and those whose variable is outside its grammar beside a sibling argv
 * claimed. Every group reads the tiers as the input-source stage left them, so a member of two
 * groups loses when either holds a higher tier, and declaration order decides nothing. A group of
 * another kind has no loser.
 */
function losingMembers(groups: readonly OptionGroup[], context: TierContext): ReadonlySet<string> {
  return new Set(
    groups
      .filter((group) => group.kind === 'exclusive')
      .flatMap((group) => losersOf(group, context)),
  );
}

/** The losing members of one exclusive group. */
function losersOf(group: OptionGroup, context: TierContext): string[] {
  const ranked = group.options.map((name) => {
    const tier = context.tierOf(name);
    return { name, rank: tier === undefined ? 0 : tierRanks[tier] };
  });
  const top = Math.max(...ranked.map(({ rank }) => rank));
  return ranked
    .filter(({ name, rank }) =>
      rank > 0 ? rank < top : context.rejected.has(name) && top === tierRanks.argv,
    )
    .map(({ name }) => name);
}

interface GroupContext {
  /** Each Boolean option's absent value, by name, at which a member claims no exclusive group. */
  readonly absent: ReadonlyMap<string, boolean>;
  readonly groups: readonly OptionGroup[];
  /**
   * The members core withdrew as the losers of an exclusive group. The sibling that won replaced
   * each in every other group: `oneRequired` counts it, and `requiredTogether` is not checked.
   */
  readonly withdrawn: ReadonlySet<string>;
  readonly values: OptionValues;
  readonly table: SpellingTable;
  readonly named: boolean;
  readonly labels: ReadonlyMap<string, string>;
  readonly unanswered: ReadonlySet<string>;
}

/**
 * Whether one member counts toward its group: for an exclusive group, a claim; for `oneRequired`, a
 * supplied or withdrawn member; for `requiredTogether`, a supplied one.
 */
function countsFor(group: OptionGroup, name: string, context: GroupContext): boolean {
  switch (group.kind) {
    case 'exclusive': {
      return claims(context.values, name, context.absent);
    }
    case 'oneRequired': {
      return isSupplied(context.values, name) || context.withdrawn.has(name);
    }
    case 'requiredTogether': {
      return isSupplied(context.values, name);
    }
    default: {
      const exhaustive: never = group.kind;
      return exhaustive;
    }
  }
}

/** An unknown configuration answer suppresses only failures whose proof depends on that answer. */
function brokenGroup(group: OptionGroup, context: GroupContext): boolean {
  const counted = group.options.filter((name) => countsFor(group, name, context));
  switch (group.kind) {
    case 'exclusive': {
      return counted.length > 1;
    }
    case 'oneRequired': {
      return counted.length === 0 && !group.options.some((name) => context.unanswered.has(name));
    }
    case 'requiredTogether': {
      return (
        counted.length > 0 &&
        !group.options.some((name) => context.withdrawn.has(name)) &&
        group.options.some((name) => !counted.includes(name) && !context.unanswered.has(name))
      );
    }
    default: {
      const exhaustive: never = group.kind;
      return exhaustive;
    }
  }
}

/** A group has no singular subject, so each sentence states the complete relationship. */
function groupMessage(kind: OptionGroup['kind'], names: readonly string[]): string {
  const members =
    names.length === 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')}, and ${names.at(-1) ?? ''}`;
  switch (kind) {
    case 'exclusive': {
      return `Options ${members} cannot be used together. Supply only one of them.`;
    }
    case 'oneRequired': {
      return `One of options ${members} is required. Supply at least one of them.`;
    }
    case 'requiredTogether': {
      return `Options ${members} must be supplied together. Supply all of them, or none.`;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function reportGroup(
  group: OptionGroup,
  context: GroupContext,
): { lines: readonly string[]; problem: InputProblem } {
  const spellings = group.options.map((name) =>
    context.named ? name : reportedOf(spellingsOf(context.table, name), name),
  );
  const described = group.options.map((name, index) => {
    const label = context.labels.get(name);
    return `${quoted(spellings[index])}${label === undefined ? '' : ` (from ${escapeControlCharacters(label)})`}`;
  });
  return {
    lines: [groupMessage(group.kind, described)],
    problem: {
      inputs: group.options.map((name) => ({ global: false, kind: 'option', name })),
      reason: group.kind,
      spellings,
      supplied: group.options.flatMap((name, index) =>
        countsFor(group, name, context) ? [spellings[index] ?? name] : [],
      ),
    },
  };
}

/** Runs once after the complete individual-input pass, without placing group reports in its ledger. */
function groupReports(
  context: GroupContext,
): { lines: readonly string[]; problem: InputProblem }[] {
  return context.groups
    .filter((group) => brokenGroup(group, context))
    .map((group) => reportGroup(group, context));
}

export type { OptionGroup, Tier };
export { absentBooleans, claims, declareGroup, groupReports, losingMembers };
