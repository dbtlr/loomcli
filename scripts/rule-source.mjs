import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads the Developer Diagnostic rules Loom's packages declare, from their source text. A rule is
 * kept in a WeakSet at run time and the rule constants are not exported, so neither a program nor a
 * test can list them; the source is the one place that does. `scripts/test-rules.ts` reads one
 * registry for the tests, and `scripts/generate-diagnostics.mjs` reads every package for the
 * diagnostics reference, both through this module, so one reader decides what a declaration is.
 *
 * The declaring calls are `registerRule(identity, { headline, explanation })` in core,
 * `diagnosticRule(identity, ...)` in the other packages, and a package's own `catalogRule(name, ...)`
 * wrapper, which prefixes the package's name. An identity is a string literal, or a template whose
 * only substitution is `${packageName}`, which the package's `package.json` name replaces.
 *
 * Reading is strict: a declaring call that does not give an identity, a headline, and an
 * explanation as plain string literals is a problem, reported with its file and line, so a new
 * declaration shape cannot silently drop a rule.
 */

/** The functions whose calls declare a rule. */
const declaringCall = /\b(?:registerRule|diagnosticRule|catalogRule)\(/gu;

/** The start of a declaring call's arguments: an identity literal and the opening of the definition. */
const identityAndDefinition =
  /^\s*(?<quote>['"`])(?<id>(?:\\.|(?!\k<quote>)[^\\])*)\k<quote>\s*,\s*\{/su;

/** A call that only passes its definition along, which declares nothing itself. */
const forwarding = /^[^,()]*,\s*definition\s*,?\s*\)/u;

/** One string literal in any of the three quotes, its escapes kept as written. */
const literal = /(?<quote>['"`])(?<text>(?:\\.|(?!\k<quote>)[^\\])*)\k<quote>/su;

/** The directories a package's source tree never reads rules from. */
const skippedDirectories = new Set(['dist', 'node_modules']);

/** The one substitution an identity template may hold. */
const packageSubstitution = /\$\{packageName\}/gu;

/** Any template substitution. */
const substitution = /\$\{/u;

/** The literal `key:` holds in one rule's definition, its escapes undone, and where it ends. */
function readLiteral(definition, key) {
  const start = definition.search(new RegExp(`\\b${key}:\\s*['"\`]`, 'u'));
  if (start === -1) {
    return undefined;
  }
  const rest = definition.slice(start);
  const found = literal.exec(rest);
  if (found?.groups === undefined) {
    return undefined;
  }
  return {
    end: start + found.index + found[0].length,
    text: found.groups.text.replaceAll(/\\(?<escaped>.)/gu, '$<escaped>'),
  };
}

/** The text of the literal `key:` holds in one rule's definition, its escapes undone. */
function definitionText(definition, key) {
  return readLiteral(definition, key)?.text;
}

/** The index of the `}` that closes the `{` at `open`, skipping string literals, or -1. */
function closingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === '`') {
      const end = literal.exec(source.slice(index));
      index += end === null || end.index !== 0 ? 0 : end[0].length - 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Every rule one registry source declares, read from its text. `call` matches the opening of each
 * declaring call, through the `{` that opens the definition, and captures the rule's `name`; the
 * headline and the explanation are the string literals the definition holds.
 */
function registeredRules(file, call) {
  const source = readFileSync(file, 'utf8');
  return Array.from(source.matchAll(call), (match) => {
    const start = match.index + match[0].length;
    const end = closingBrace(source, start - 1);
    const definition = source.slice(start, end === -1 ? source.length : end);
    return {
      explanation: definitionText(definition, 'explanation'),
      headline: definitionText(definition, 'headline'),
      name: match.groups?.name ?? '',
    };
  });
}

/** The 1-based line an index of a source stands on. */
function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** Whether the call at `index` is a function definition or stands in a comment line. */
function declaresNothing(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const before = source.slice(lineStart, index);
  return /^\s*(?:\*|\/\/|\/\*)/u.test(before) || /\bfunction\s+$/u.test(before);
}

/** The identity a declaring call gives, or a reason it cannot be read. */
function identityOf(callee, id, quote, packageName) {
  if (callee === 'catalogRule') {
    return /^[a-z0-9-]+$/u.test(id)
      ? { identity: `${packageName}/${id}` }
      : { reason: 'a catalogRule name is a kebab-case string literal' };
  }
  const resolved = quote === '`' ? id.replaceAll(packageSubstitution, packageName) : id;
  return substitution.test(resolved)
    ? {
        reason: 'an identity is a string literal, or a template that substitutes only packageName',
      }
    : { identity: resolved };
}

/** The prose a definition holds under `key`, or a reason it cannot be read. */
function proseOf(definition, key) {
  const found = readLiteral(definition, key);
  if (found === undefined || found.text.trim() === '') {
    return { reason: `${key} is a nonempty string literal` };
  }
  const after = definition.slice(found.end).trimStart();
  if (after !== '' && !after.startsWith(',')) {
    return { reason: `${key} is one string literal, not an expression` };
  }
  return substitution.test(found.text)
    ? { reason: `${key} has no template substitution` }
    : { text: found.text };
}

/** One declaring call: its rule, or the problem that stopped the reader. */
function readCall(source, match, file, packageName) {
  const callee = match[0].slice(0, -1);
  const at = `${file}:${lineOf(source, match.index)}`;
  const rest = source.slice(match.index + match[0].length);
  const args = identityAndDefinition.exec(rest)?.groups;
  if (args === undefined) {
    return forwarding.test(rest)
      ? undefined
      : { problem: `${at}: ${callee}() is not a literal identity followed by a definition object` };
  }
  const named = identityOf(callee, args.id, args.quote, packageName);
  if (named.reason !== undefined) {
    return { problem: `${at}: ${callee}() is not readable: ${named.reason}` };
  }
  const open = match.index + match[0].length + rest.indexOf('{', args.id.length);
  const close = closingBrace(source, open);
  if (close === -1) {
    return { problem: `${at}: ${callee}() has an unclosed definition` };
  }
  const definition = source.slice(open + 1, close);
  const headline = proseOf(definition, 'headline');
  const explanation = proseOf(definition, 'explanation');
  const reason = headline.reason ?? explanation.reason;
  if (reason !== undefined) {
    return { problem: `${at}: ${named.identity} is not readable: ${reason}` };
  }
  return {
    rule: {
      explanation: explanation.text,
      file,
      headline: headline.text,
      identity: named.identity,
      line: lineOf(source, match.index),
    },
  };
}

/**
 * The rules one source declares and the problems that stopped the reader from reading a declaring
 * call, each as `file:line: reason`. `packageName` is the name of the package the file belongs to.
 */
function rulesInSource(source, file, packageName) {
  const rules = [];
  const problems = [];
  for (const match of source.matchAll(declaringCall)) {
    if (!declaresNothing(source, match.index)) {
      const read = readCall(source, match, file, packageName);
      if (read?.rule !== undefined) {
        rules.push(read.rule);
      } else if (read?.problem !== undefined) {
        problems.push(read.problem);
      }
    }
  }
  return { problems, rules };
}

/** Whether a path is a source file the reader covers: TypeScript, and not a test or a declaration file. */
function isSource(path) {
  return /\.tsx?$/u.test(path) && !/\.(?:test|d)\.tsx?$/u.test(path);
}

/** The source files under one `src` directory, as paths from the repository root. */
function sourceFiles(root, directory) {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => !skippedDirectories.has(entry.name))
    .toSorted((left, right) => (left.name < right.name ? -1 : 1))
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return sourceFiles(root, path);
      }
      return isSource(path) ? [path] : [];
    });
}

/** The package directories under `packages/` that hold a `package.json` and a `src` directory. */
function packagesOf(root) {
  return readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .flatMap((name) => {
      try {
        const manifest = JSON.parse(
          readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'),
        );
        readdirSync(join(root, 'packages', name, 'src'));
        return [{ directory: `packages/${name}`, name: manifest.name }];
      } catch {
        return [];
      }
    });
}

/**
 * Every rule the packages under `root` declare in their `src` directories, as
 * `{ identity, headline, explanation, file, line }`. It throws one error, naming each file and line,
 * when a declaring call cannot be read or an identity is declared twice.
 */
function readDeclaredRules(root) {
  const rules = [];
  const problems = [];
  for (const { directory, name } of packagesOf(root)) {
    for (const file of sourceFiles(root, `${directory}/src`)) {
      const read = rulesInSource(readFileSync(join(root, file), 'utf8'), file, name);
      rules.push(...read.rules);
      problems.push(...read.problems);
    }
  }
  const first = new Map();
  for (const rule of rules) {
    const earlier = first.get(rule.identity);
    if (earlier === undefined) {
      first.set(rule.identity, rule);
    } else {
      problems.push(
        `${rule.file}:${rule.line}: ${rule.identity} is already declared at ${earlier.file}:${earlier.line}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Cannot read every rule declaration:\n${problems.join('\n')}`);
  }
  return rules;
}

export { definitionText, readDeclaredRules, registeredRules, rulesInSource };
