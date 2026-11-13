#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CompilerState,
  Extractor,
  ExtractorConfig,
  ExtractorMessageCategory,
  ExtractorMessageId,
} from '@microsoft/api-extractor';

import { surfacePackages } from './api-surface.mjs';

// Use the parser and TSDoc loader bundled with API Extractor, never TypeScript 7's compiler API.
const extractorRequire = createRequire(import.meta.resolve('@microsoft/api-extractor'));
const ts = extractorRequire('typescript');
const { TSDocConfigFile } = extractorRequire('@microsoft/tsdoc-config');
const tsdoc = extractorRequire('@microsoft/tsdoc');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const tsdocConfigFile = TSDocConfigFile.loadFile(join(repositoryRoot, 'tsdoc.json'));

/** Recursively finds the declaration output, including files no entry point reaches. */
function declarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return declarations(path);
    }
    return path.endsWith('.d.ts') ? [path] : [];
  });
}

/** Collects types conditions, including nested import/require conditions. */
function typesPaths(value) {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'types' && typeof child === 'string' ? [child] : typesPaths(child),
  );
}

/** Reads a package's manifest and its exports map, with a bare conditions object as `.`. */
function packageExports(directory) {
  const packageJsonFullPath = join(directory, 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonFullPath, 'utf8'));
  const exportsMap = Object.keys(manifest.exports).some((key) => key.startsWith('.'))
    ? manifest.exports
    : { '.': manifest.exports };
  return { exportsMap, manifest, packageJsonFullPath };
}

/** Builds one Extractor configuration per exported declaration entry point. */
function entryConfigs(root, policy) {
  const directory = resolve(root, policy.directory);
  const { exportsMap, manifest, packageJsonFullPath } = packageExports(directory);
  // A package being tagged one group of subpaths at a time names the entries it covers so far.
  const covered = policy.coveredEntries;
  const checked = Object.entries(exportsMap).filter(
    ([entry]) => covered === undefined || covered.includes(entry),
  );
  return checked.flatMap(([entry, conditions]) =>
    [...new Set(typesPaths(conditions))].map((path) => {
      const reportFileName =
        entry === '.' ? 'index.api.md' : `${entry.slice(2).replaceAll('/', '.')}.api.md`;
      const configObject = {
        apiReport: {
          enabled: true,
          reportFileName,
          reportFolder: join(directory, 'api'),
          reportTempFolder: join(
            root,
            '.scratch/check-api',
            policy.directory,
            entry.slice(2) || 'index',
          ),
        },
        compiler: {
          overrideTsconfig: {
            compilerOptions: {
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              skipLibCheck: true,
              target: 'ESNext',
            },
            files: [resolve(directory, path)],
          },
        },
        docModel: { enabled: false },
        dtsRollup: { enabled: false },
        mainEntryPointFilePath: resolve(directory, path),
        messages: {
          compilerMessageReporting: { default: { logLevel: 'error' } },
          extractorMessageReporting: {
            ...Object.fromEntries(
              Object.values(ExtractorMessageId).map((id) => [
                id,
                { addToApiReportFile: false, logLevel: 'error' },
              ]),
            ),
            'ae-internal-missing-underscore': { logLevel: 'none' },
            default: { addToApiReportFile: false, logLevel: 'error' },
          },
          tsdocMessageReporting: { default: { logLevel: 'error' } },
        },
        // The repository stores text with LF endings, so the committed report must match it.
        newlineKind: 'lf',
        projectFolder: directory,
        tsdocMetadata: { enabled: false },
      };
      return {
        config: ExtractorConfig.prepare({
          configObject,
          configObjectFullPath: join(directory, 'api-extractor.json'),
          packageJsonFullPath,
          tsdocConfigFile,
        }),
        entry,
        listedFile: join(directory, 'api', reportFileName.replace(/\.api\.md$/u, '.listed.md')),
        packageName: manifest.name,
        packagePolicy: policy,
        policy: policy.entries[entry] ?? {},
      };
    }),
  );
}

/** Whether a package's declarations may import a module, by its list of names and `node:*`. */
function allowedModule(policy, name) {
  return policy.modules.some(
    (allowed) => allowed === name || (allowed === 'node:*' && name.startsWith('node:')),
  );
}

/**
 * Finds the declaration owning a message whose metadata has no export name, such as a TSDoc
 * message or a member's missing comment, as a dotted path such as `Shape.value`.
 */
function declarationName(program, message) {
  const source = message.sourceFilePath && program.getSourceFile(message.sourceFilePath);
  if (!source) {
    return undefined;
  }
  const position = source.getPositionOfLineAndCharacter(
    (message.sourceFileLine ?? 1) - 1,
    (message.sourceFileColumn ?? 1) - 1,
  );
  const names = [];
  const visit = (node) => {
    if (position < node.getFullStart() || position >= node.end) {
      return;
    }
    // A variable statement names the declaration the position falls in, or its first when the
    // Position sits on the statement's comment, so its declarations add no name of their own.
    if (node.name && !ts.isVariableDeclaration(node)) {
      names.push(node.name.getText(source));
    }
    if (ts.isVariableStatement(node)) {
      const variables = node.declarationList.declarations;
      const owner =
        variables.find(
          (declaration) => position >= declaration.getFullStart() && position < declaration.end,
        ) ?? variables[0];
      names.push(owner?.name.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names.length > 0 ? names.join('.') : undefined;
}

/** Whether a declaration file belongs to another package, a dependency's included. */
function outsidePackage(projectFolder, path) {
  const fromPackage = relative(projectFolder, path);
  return (
    fromPackage.startsWith('..') ||
    isAbsolute(fromPackage) ||
    fromPackage.split(/[\\/]/u).includes('node_modules')
  );
}

/** The statement that declares a symbol at a file's top level, such as a variable's statement. */
function topLevelStatement(declaration) {
  const statement = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  return statement.parent && ts.isSourceFile(statement.parent) ? statement : undefined;
}

/**
 * Finds the declarations of the listed names that the entry's exports reference, then every
 * unexported declaration in the package that those declarations reference in turn, until no new
 * one turns up. API Extractor reports a forgotten export only at an exported declaration, so a type
 * that only a listed declaration uses, such as the type state that decides which of `Command`'s
 * methods remain, is found here by resolving each identifier through the program.
 */
function listedDeclarations(program, entryFile, projectFolder, names) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryFile);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  const aliasTarget = (symbol) =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const exported = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map(aliasTarget);
  const found = new Map();
  const pending = [];
  const visitFrom = (root, accepts, followsClassState) => {
    const visit = (node) => {
      // A public type picks members from an unexported class, as `Command` does from `CommandBuilder`.
      // No public type picks a constructor, and only the constructor takes a builder's internal state.
      // A constructor therefore leads to no further declaration.
      if (!followsClassState && ts.isConstructorDeclaration(node)) {
        return;
      }
      if (ts.isIdentifier(node) && accepts(node.text)) {
        const symbol = checker.getSymbolAtLocation(node);
        const target = symbol && aliasTarget(symbol);
        if (target && accepts(target.name) && !exported.includes(target)) {
          for (const declaration of target.declarations ?? []) {
            const statement = topLevelStatement(declaration);
            if (
              statement &&
              !found.has(statement) &&
              !outsidePackage(projectFolder, statement.getSourceFile().fileName)
            ) {
              found.set(statement, target.name);
              pending.push(statement);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  };
  for (const symbol of exported) {
    for (const declaration of symbol.declarations ?? []) {
      if (!outsidePackage(projectFolder, declaration.getSourceFile().fileName)) {
        visitFrom(declaration, (name) => names.has(name), true);
      }
    }
  }
  while (pending.length > 0) {
    visitFrom(pending.pop(), () => true, false);
  }
  return found;
}

/** A TSDoc parser configured as API Extractor's is, from the repository's `tsdoc.json`. */
function docParser() {
  const configuration = new tsdoc.TSDocConfiguration();
  tsdocConfigFile.configureParser(configuration);
  return new tsdoc.TSDocParser(configuration);
}

/** The parsed doc comment directly above a node, or undefined when it has none. */
function docComment(parser, node) {
  const text = node.getSourceFile().getFullText();
  // The comment nearest the node is the one TSDoc and a hover read.
  const comment = (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).findLast((range) =>
    text.startsWith('/**', range.pos),
  );
  return comment && parser.parseString(text.slice(comment.pos, comment.end)).docComment;
}

/** Whether a comment holds an `@example` block with a fenced code block tagged `ts`. */
function hasTypeScriptExample(comment) {
  return (comment?.customBlocks ?? []).some(
    (block) =>
      block.blockTag.tagNameWithUpperCase === tsdoc.StandardTags.example.tagNameWithUpperCase &&
      block.content.nodes.some(
        (node) => node.kind === tsdoc.DocNodeKind.FencedCode && node.language === 'ts',
      ),
  );
}

/**
 * Whether a comment counts as documentation by API Extractor's own test: its summary holds text.
 * The test is API Extractor's call, so `ae-undocumented` and this walk reach the same verdict.
 */
function documented(comment) {
  return (
    comment !== undefined && tsdoc.PlainTextEmitter.hasAnyTextContent(comment.summarySection, 10)
  );
}

/** A member's name in a failure line, such as `run`, `new` for a construct signature, or `[index]`. */
function memberName(member) {
  if (member.name) {
    return member.name.getText();
  }
  if (ts.isConstructSignatureDeclaration(member)) {
    return 'new';
  }
  return ts.isIndexSignatureDeclaration(member) ? '[index]' : '(call)';
}

/**
 * Finds the members of the listed classes and interfaces without a comment that counts. A public
 * type written over one, as `Command` is over `CommandBuilder`, shows these members' comments in a
 * hover. Like API Extractor, it skips a class's constructor and its private members, and reads a
 * getter and its setter as one property, whose comment `tsc` keeps on the getter.
 */
function undocumentedListedMembers(found, parser) {
  return [...found].flatMap(([statement, name]) => {
    if (!ts.isClassDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) {
      return [];
    }
    const source = statement.getSourceFile();
    // A static and an instance accessor of one name are two properties, so the key holds both.
    const accessorKey = (member) =>
      `${ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static ? 'static ' : ''}${member.name.getText()}`;
    const getters = new Set(statement.members.filter(ts.isGetAccessorDeclaration).map(accessorKey));
    return statement.members
      .filter(
        (member) =>
          !ts.isConstructorDeclaration(member) &&
          !(ts.isSetAccessorDeclaration(member) && getters.has(accessorKey(member))) &&
          !(member.name && ts.isPrivateIdentifier(member.name)) &&
          !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) &&
          !documented(docComment(parser, member)),
      )
      .map((member) => ({
        file: source.fileName,
        line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
        name: `${name}.${memberName(member)}`,
      }));
  });
}

/** The declaration kinds that make an export a value, which an author calls, builds, or reads. */
const valueKinds = new Set([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableDeclaration,
]);

/**
 * Finds the entry's exported values whose first value declaration carries no `@example` with a
 * fenced `ts` block. A type of the same name may come first, as `type Command` does before
 * `const Command`; an overloaded function carries it on its first overload; an external
 * re-export carries its own package's comments, so it is skipped.
 */
function missingExamples(exported, projectFolder, parser) {
  return exported.flatMap(({ name, target }) => {
    const first = target.declarations?.find((declaration) => valueKinds.has(declaration.kind));
    if (!first || outsidePackage(projectFolder, first.getSourceFile().fileName)) {
      return [];
    }
    const statement = ts.isVariableDeclaration(first) ? first.parent.parent : first;
    if (hasTypeScriptExample(docComment(parser, statement))) {
      return [];
    }
    const source = statement.getSourceFile();
    return [
      {
        file: source.fileName,
        line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
        name,
      },
    ];
  });
}

/** Orders two strings by code unit, the same on every machine and locale. */
function codeUnitOrder(left, right) {
  return Number(left > right) - Number(left < right);
}

// The printer drops every comment, so a doc comment's wording never reads as a shape change.
const shapePrinter = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });

/**
 * A class without its constructor, which no public type picks, so a change to how a builder is
 * built inside its package never reads as a change to the published surface.
 */
function withoutConstructor(statement) {
  if (!ts.isClassDeclaration(statement)) {
    return statement;
  }
  return ts.factory.updateClassDeclaration(
    statement,
    statement.modifiers,
    statement.name,
    statement.typeParameters,
    statement.heritageClauses,
    statement.members.filter((member) => !ts.isConstructorDeclaration(member)),
  );
}

/**
 * Writes the companion file's text: each listed declaration's emitted shape, sorted by name.
 * A public type written over a listed declaration, such as `Pick<CommandBuilder, ...>`, shows
 * only its outer text in the API report, so this file records the shape the type reads.
 */
function listedText(packageName, entry, found) {
  const blocks = [...found]
    .map(([statement, name]) => ({
      file: statement.getSourceFile().fileName,
      name,
      position: statement.getStart(),
      text: shapePrinter.printNode(
        ts.EmitHint.Unspecified,
        withoutConstructor(statement),
        statement.getSourceFile(),
      ),
    }))
    .toSorted(
      (left, right) =>
        codeUnitOrder(left.name, right.name) ||
        codeUnitOrder(left.file, right.file) ||
        left.position - right.position,
    )
    .map(({ text }) => text);
  return [
    `# Listed declarations of ${entry === '.' ? packageName : `${packageName}/${entry.slice(2)}`}`,
    '',
    "> Generated by `pnpm check:api --update`. No declaration below is exported from this entry point, but a public type in this entry's API report is written over it, directly or through another declaration here, so its shape is part of the published surface.",
    '',
    '```ts',
    blocks.join('\n\n'),
    '```',
    '',
  ].join('\n');
}

/**
 * The `pendingDocumentation` paths that cover a declaration file, none when no path does. A path,
 * relative to the package directory, covers the file it names and every file under it.
 */
function pendingPaths(policy, directory, file) {
  const path = relative(directory, file).replaceAll('\\', '/');
  return (policy.pendingDocumentation ?? []).filter(
    (pending) =>
      path === pending || path.startsWith(pending.endsWith('/') ? pending : `${pending}/`),
  );
}

/** Checks emitted API surfaces; update writes reports but never suppresses declaration failures. */
function checkApi(root, packages, { update = false } = {}) {
  const failures = [];
  const fail = (file, line, id, name, text) => {
    failures.push(
      `${relative(root, file)}:${line}: ${id}: ${name}: ${text.replaceAll(/\s+/gu, ' ')}`,
    );
  };
  for (const policy of packages) {
    const { exportsMap, packageJsonFullPath } = packageExports(resolve(root, policy.directory));
    for (const entry of policy.coveredEntries ?? []) {
      if (!Object.hasOwn(exportsMap, entry)) {
        fail(
          packageJsonFullPath,
          1,
          'api-unknown-entry',
          entry,
          'The exports map names no such entry.',
        );
      }
    }
    // An entry's lists are read only while the check runs that entry, so others would sit unread.
    for (const entry of Object.keys(policy.entries)) {
      const checked =
        Object.hasOwn(exportsMap, entry) &&
        (policy.coveredEntries === undefined || policy.coveredEntries.includes(entry));
      if (!checked) {
        fail(
          packageJsonFullPath,
          1,
          'api-unchecked-entry',
          entry,
          'The check does not run this entry, so its lists are never read; cover the entry or remove them.',
        );
      }
    }
  }
  const entries = packages.flatMap((policy) => entryConfigs(root, policy));
  if (entries.length === 0) {
    return failures;
  }
  const compilerState = CompilerState.create(entries[0].config, {
    additionalEntryPoints: entries.map(({ config }) => config.mainEntryPointFilePath),
  });
  const parser = docParser();
  // The pendingDocumentation paths that still cover a missing comment or example, per package.
  const pendingUsed = new Map(packages.map((policy) => [policy, new Set()]));
  for (const { config, entry, listedFile, packageName, packagePolicy, policy } of entries) {
    // A missing comment or example under a pendingDocumentation path waits for its pass.
    const failDocumentation = (file, line, id, name, text) => {
      const pending = pendingPaths(packagePolicy, config.projectFolder, file);
      if (pending.length === 0) {
        fail(file, line, id, name, text);
      }
      for (const path of pending) {
        pendingUsed.get(packagePolicy).add(path);
      }
    };
    const seenForgotten = new Set();
    const seenExternal = new Set();
    // Extractor silently preserves external re-exports, so inspect its resolved export symbols.
    const program = compilerState.program;
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(config.mainEntryPointFilePath);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported = (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map(
      (symbol) => ({
        name: symbol.name,
        symbol,
        target: symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      }),
    );
    for (const { file, line, name } of missingExamples(exported, config.projectFolder, parser)) {
      failDocumentation(
        file,
        line,
        'api-missing-example',
        name,
        'Add an @example block that holds a fenced ts code block.',
      );
    }
    for (const { symbol, target } of exported) {
      const external = target.declarations?.some((declaration) =>
        outsidePackage(config.projectFolder, declaration.getSourceFile().fileName),
      );
      if (external) {
        seenExternal.add(symbol.name);
      }
      if (external && !policy.externalExports?.[symbol.name]) {
        const declaration = symbol.declarations?.[0];
        const line = declaration
          ? declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line +
            1
          : 1;
        fail(
          declaration?.getSourceFile().fileName ?? config.mainEntryPointFilePath,
          line,
          'api-external-export',
          symbol.name,
          'List the external re-export with its reason.',
        );
      }
    }
    if (update) {
      mkdirSync(config.reportFolder, { recursive: true });
    }
    const result = Extractor.invoke(config, {
      compilerState,
      localBuild: update,
      messageCallback(message) {
        message.handled = true;
        const { messageId, properties, text } = message;
        const name =
          properties.exportName ??
          (messageId.startsWith('tsdoc-') || messageId === 'ae-undocumented'
            ? declarationName(compilerState.program, message)
            : undefined) ??
          /"(?<name>[^"\n]+)"/u.exec(text)?.groups?.name ??
          entry;
        if (messageId === 'ae-internal-missing-underscore') {
          return;
        }
        if (messageId === 'ae-undocumented') {
          failDocumentation(
            message.sourceFilePath ?? config.mainEntryPointFilePath,
            message.sourceFileLine ?? 1,
            messageId,
            name,
            text,
          );
          return;
        }
        // A dependency's own typings may import a source file, as ESLint's do; Loom cannot change them.
        if (
          messageId === 'ae-wrong-input-file-type' &&
          message.sourceFilePath?.split(/[\\/]/u).includes('node_modules')
        ) {
          return;
        }
        if (messageId === 'ae-forgotten-export') {
          seenForgotten.add(name);
          if (policy.forgottenExports?.[name]) {
            return;
          }
        }
        // Console messages narrate the run; every other message is a failure.
        if (message.category !== ExtractorMessageCategory.Console) {
          fail(
            message.sourceFilePath ?? config.mainEntryPointFilePath,
            message.sourceFileLine ?? 1,
            messageId,
            name,
            text,
          );
        }
      },
    });
    if (result.apiReportChanged && !update) {
      fail(
        join(config.reportFolder, config.reportConfigs[0].fileName),
        1,
        'api-report-changed',
        entry,
        'Run pnpm check:api --update and commit the report.',
      );
    }
    const listed = new Set(
      Object.keys(policy.forgottenExports ?? {}).filter((name) => seenForgotten.has(name)),
    );
    const found = listedDeclarations(
      program,
      config.mainEntryPointFilePath,
      config.projectFolder,
      listed,
    );
    // A name API Extractor reports as forgotten is always reachable from an exported declaration.
    // An unresolved one therefore means this resolution is wrong, so the run stops.
    const unresolved = [...listed].filter((name) => ![...found.values()].includes(name));
    if (unresolved.length > 0) {
      throw new Error(
        `check:api found no declaration for ${unresolved.join(', ')} in entry ${entry} of ${packageName}.`,
      );
    }
    for (const { file, line, name } of undocumentedListedMembers(found, parser)) {
      failDocumentation(
        file,
        line,
        'api-undocumented',
        name,
        'A public type is written over this declaration, so a hover shows this member; add a doc comment.',
      );
    }
    const expected = found.size > 0 ? listedText(packageName, entry, found) : undefined;
    const committed = existsSync(listedFile) ? readFileSync(listedFile, 'utf8') : undefined;
    if (expected !== committed) {
      if (update && expected === undefined) {
        rmSync(listedFile);
      } else if (update) {
        mkdirSync(dirname(listedFile), { recursive: true });
        writeFileSync(listedFile, expected);
      } else {
        fail(
          listedFile,
          1,
          'api-listed-changed',
          entry,
          expected === undefined
            ? 'The entry lists no declaration; run pnpm check:api --update to remove the companion file.'
            : 'Run pnpm check:api --update and commit the companion file.',
        );
      }
    }
    for (const name of Object.keys(policy.externalExports ?? {})) {
      if (!seenExternal.has(name)) {
        fail(
          config.mainEntryPointFilePath,
          1,
          'stale-external-export',
          name,
          'Remove the unused external re-export entry.',
        );
      }
    }
    for (const name of Object.keys(policy.forgottenExports ?? {})) {
      if (!seenForgotten.has(name)) {
        fail(
          config.mainEntryPointFilePath,
          1,
          'stale-forgotten-export',
          name,
          'Remove the unused allowlist entry.',
        );
      }
    }
  }
  for (const policy of packages) {
    for (const path of policy.pendingDocumentation ?? []) {
      if (!pendingUsed.get(policy).has(path)) {
        fail(
          resolve(root, policy.directory, 'package.json'),
          1,
          'stale-pending-documentation',
          path,
          'Nothing under this path lacks a comment or an example; remove the entry.',
        );
      }
    }
    for (const file of declarations(resolve(root, policy.directory, 'dist'))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const checkModule = (name, position) => {
        if (!name.startsWith('.') && !isAbsolute(name) && !allowedModule(policy, name)) {
          fail(
            file,
            source.getLineAndCharacterOfPosition(position).line + 1,
            'api-disallowed-import',
            name,
            'Module is outside the package declaration dependency list.',
          );
        }
      };
      const visit = (node) => {
        let specifier = undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          specifier = node.moduleSpecifier;
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
          specifier = node.argument.literal;
        } else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)
        ) {
          specifier = node.moduleReference.expression;
        }
        if (specifier && ts.isStringLiteral(specifier)) {
          checkModule(specifier.text, specifier.getStart(source));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      // A `/// <reference types>` directive loads a package's declarations as an import does.
      for (const reference of source.typeReferenceDirectives) {
        checkModule(reference.fileName, reference.pos);
      }
    }
  }
  return [...new Set(failures)];
}

const entry = process.argv[1];
if (
  entry &&
  existsSync(entry) &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  const failures = checkApi(repositoryRoot, surfacePackages, {
    update: process.argv.includes('--update'),
  });
  if (failures.length > 0) {
    process.stdout.write(`${failures.join('\n')}\n`);
    process.exitCode = 1;
  }
}

export { checkApi };
