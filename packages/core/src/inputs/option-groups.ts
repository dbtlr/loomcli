import { registerRule } from '../diagnostics/diagnostic-text.js';
import type { Finding } from '../diagnostics/diagnostic-text.js';
import { DeclarationError } from '../failures/errors.js';
import type { InputProblem } from '../failures/errors.js';
import { commandSentence, quoted } from '../failures/messages.js';
import type { InputDeclaration } from './declarations.js';
import { groupSentence, requirementSentence } from './messages.js';
import type { GroupMember } from './messages.js';
import { absentBoolean, isSupplied, reportedOf, spellingsOf } from './options.js';
import type { OptionValues, SpellingTable } from './options.js';

/**
 * A relationship over supplied local options, in declaration order: a group that states one rule
 * over all its members, or a requirement of one option on others.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
 * @public
 * @sealed
 */
type OptionGroup =
  | {
      /**
       * Which rule the group states: at most one member, at least one member, or all members or
       * none.
       */
      readonly kind: 'exclusive' | 'oneRequired' | 'requiredTogether';
      /** The names of the local options the group relates, in declaration order. */
      readonly options: readonly string[];
    }
  | {
      /** A one-way requirement: supplying `option` requires each option `requires` names. */
      readonly kind: 'requires';
      /** The name of the local option that has the requirement. */
      readonly option: string;
      /** The names of the local options it needs, in declaration order. */
      readonly requires: readonly string[];
    };

/** A group that states one rule over all its members. */
type MemberGroup = Exclude<OptionGroup, { readonly kind: 'requires' }>;

/** A one-way requirement of one option on others. */
type Requirement = Extract<OptionGroup, { readonly kind: 'requires' }>;

/** Every option a group names, in the order its call names them: a requirement's option first. */
function membersOf(group: OptionGroup): readonly string[] {
  return group.kind === 'requires' ? [group.option, ...group.requires] : group.options;
}

/**
 * The frozen group one call declares over `names`. A requirement's first name is its option and
 * the rest are the options it needs. A Command's call judges that it names at least two, and a
 * set's types require two, so the first name is always there.
 */
function groupOf(kind: OptionGroup['kind'], names: readonly string[]): OptionGroup {
  if (kind !== 'requires') {
    return Object.freeze({ kind, options: Object.freeze([...names]) });
  }
  const [option = '', ...requires] = names;
  return Object.freeze({ kind, option, requires: Object.freeze(requires) });
}

const groupDeclaration = registerRule('@loomcli/core/option-group', {
  explanation:
    'An option group relates already-declared local options. Its members must be distinct and its rules must permit those options to be used.',
  headline: 'Invalid option group',
});

type Fault = (sentence: string, correction: string) => never;

/** One group call: the options its receiver holds, the groups before it, and the call's own names. */
interface GroupCall {
  readonly inputs: readonly InputDeclaration[];
  readonly groups: readonly OptionGroup[];
  readonly kind: OptionGroup['kind'];
  readonly names: readonly string[];
}

interface Declaration extends GroupCall {
  readonly name: string | null;
}

function checkMembers(declaration: Declaration, fail: Fault): void {
  const { inputs, kind, names, name } = declaration;
  const subject = commandSentence(name);
  if (names.length < 2) {
    fail(
      `${subject} declares ${kind} with fewer than two options.`,
      'Name at least two local options.',
    );
  }
  const judgeRepeat = repeatJudgment({ ...declaration, subject }, fail);
  for (const [index, member] of names.entries()) {
    judgeRepeat(member, index);
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

/**
 * Only pairs involving the new rule need checking; earlier declarations were already checked.
 * `subject` opens each sentence, the Command's or the option set's.
 */
function checkConflicts(
  declaration: GroupCall & { readonly subject: string },
  group: OptionGroup,
  fail: Fault,
): void {
  const { subject } = declaration;
  const exclusive = group.kind === 'exclusive' ? [group] : exclusiveGroups(declaration.groups);
  const together = asksTogether(group) ? [group] : declaration.groups.filter(asksTogether);
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
    const conflicting = together.find(
      (other) => membersOf(other).filter((name) => rule.options.includes(name)).length >= 2,
    );
    if (conflicting) {
      fail(
        `${subject} exclusive and ${conflicting.kind} groups share at least two options.`,
        'Remove one of the conflicting group rules.',
      );
    }
  }
}

/** The exclusive groups among `groups`, in declaration order. */
function exclusiveGroups(groups: readonly OptionGroup[]): MemberGroup[] {
  return groups.flatMap((group) => (group.kind === 'exclusive' ? [group] : []));
}

/**
 * Whether a group asks for two of its members in one run, which an exclusive group over both
 * refuses: a required-together group or a requirement.
 */
function asksTogether(group: OptionGroup): boolean {
  return group.kind === 'requiredTogether' || group.kind === 'requires';
}

/** Contradictions are direct pairs, never a transitive constraint solver. */
function declareGroup(declaration: Declaration): OptionGroup {
  const { name, kind, names } = declaration;
  const finding: Finding = { arguments: names, call: kind, path: name === null ? [] : [name] };
  const fail: Fault = (sentence, correction) => {
    throw new DeclarationError(groupDeclaration, { correction, findings: [finding], sentence });
  };
  checkMembers(declaration, fail);
  const group = groupOf(kind, names);
  checkConflicts({ ...declaration, subject: commandSentence(name) }, group, fail);
  return group;
}

/**
 * One group call on an option set, over the set's own members. The types name only members and at
 * least two of them, so the call judges what no type expresses: a repeated member and the
 * conflicts with the set's earlier groups. `options(set)` declares the group on a Command, where
 * every rule `declareGroup` states applies to it.
 */
function declareSetGroup(declaration: GroupCall, finding: Finding): OptionGroup {
  const { kind, names } = declaration;
  const judged = { ...declaration, subject: 'An option set' };
  const fail: Fault = (sentence, correction) => {
    throw new DeclarationError(groupDeclaration, { correction, findings: [finding], sentence });
  };
  const judgeRepeat = repeatJudgment(judged, fail);
  for (const [index, member] of names.entries()) {
    judgeRepeat(member, index);
  }
  const group = groupOf(kind, names);
  checkConflicts(judged, group, fail);
  return group;
}

/**
 * A group names each member once, so a repeated name is a fault. A requirement that names its
 * option again among the options it needs requires itself, the repeat's more specific sentence.
 * The judgment takes one member at a time, with its index among the call's names, so a caller that
 * judges more of each member, as a Command does, keeps its order.
 */
function repeatJudgment(
  { kind, names, subject }: Pick<GroupCall, 'kind' | 'names'> & { readonly subject: string },
  fail: Fault,
): (member: string, index: number) => void {
  const seen = new Set<string>();
  return (member, index) => {
    if (kind === 'requires' && index > 0 && member === names[0]) {
      fail(
        `${subject} requires names option ${quoted(member)} as its own requirement.`,
        'Name only other local options after the first.',
      );
    }
    if (seen.has(member)) {
      fail(`${subject} ${kind} repeats option ${quoted(member)}.`, 'Name each option once.');
    }
    seen.add(member);
  };
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
  return new Set(exclusiveGroups(groups).flatMap((group) => losersOf(group, context)));
}

/** The losing members of one exclusive group. */
function losersOf(group: MemberGroup, context: TierContext): string[] {
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
   * each in every other group: `oneRequired` counts it, and neither a `requiredTogether` group nor
   * a requirement that holds it is checked.
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
 * supplied or withdrawn member; for `requiredTogether` and a requirement, a supplied one.
 */
function countsFor(group: OptionGroup, name: string, context: GroupContext): boolean {
  switch (group.kind) {
    case 'exclusive': {
      return claims(context.values, name, context.absent);
    }
    case 'oneRequired': {
      return isSupplied(context.values, name) || context.withdrawn.has(name);
    }
    case 'requiredTogether':
    case 'requires': {
      return isSupplied(context.values, name);
    }
    default: {
      const exhaustive: never = group;
      return exhaustive;
    }
  }
}

/**
 * The needed options a requirement still lacks. There are none unless its option claims it, as a
 * member claims an exclusive group, and none when it holds a member an exclusive group withdrew,
 * which the sibling that won replaced. A needed option whose configuration request went unanswered
 * may be supplied, so it is not lacking.
 */
function lackingOf(group: Requirement, context: GroupContext): readonly string[] {
  if (
    !claims(context.values, group.option, context.absent) ||
    membersOf(group).some((name) => context.withdrawn.has(name))
  ) {
    return [];
  }
  return group.requires.filter(
    (name) => !isSupplied(context.values, name) && !context.unanswered.has(name),
  );
}

/** An unknown configuration answer suppresses only failures whose proof depends on that answer. */
function brokenGroup(group: OptionGroup, context: GroupContext): boolean {
  if (group.kind === 'requires') {
    return lackingOf(group, context).length > 0;
  }
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
      const exhaustive: never = group;
      return exhaustive;
    }
  }
}

function reportGroup(
  group: OptionGroup,
  context: GroupContext,
): { lines: readonly string[]; problem: InputProblem } {
  const members = membersOf(group);
  const spelling = (name: string): string =>
    context.named ? name : reportedOf(spellingsOf(context.table, name), name);
  const member = (name: string): GroupMember => ({
    label: context.labels.get(name),
    spelling: spelling(name),
  });
  return {
    lines: [
      group.kind === 'requires'
        ? requirementSentence(member(group.option), lackingOf(group, context).map(spelling))
        : groupSentence(group.kind, group.options.map(member)),
    ],
    problem: {
      inputs: members.map((name) => ({ global: false, kind: 'option', name })),
      reason: group.kind,
      spellings: members.map(spelling),
      supplied: members.flatMap((name) =>
        countsFor(group, name, context) ? [spelling(name)] : [],
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
export {
  absentBooleans,
  claims,
  declareGroup,
  declareSetGroup,
  groupReports,
  losingMembers,
  membersOf,
};
