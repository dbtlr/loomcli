#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

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

/** Builds one Extractor configuration per exported declaration entry point. */
function entryConfigs(root, policy) {
  const directory = resolve(root, policy.directory);
  const packageJsonFullPath = join(directory, 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonFullPath, 'utf8'));
  const exportsMap = Object.keys(manifest.exports).some((key) => key.startsWith('.'))
    ? manifest.exports
    : { '.': manifest.exports };
  return Object.entries(exportsMap).flatMap(([entry, conditions]) =>
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
            // Doc comments on every export are a later check; this one judges tags and shape.
            'ae-undocumented': { logLevel: 'none' },
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
          tsdocConfigFile: TSDocConfigFile.loadFile(join(repositoryRoot, 'tsdoc.json')),
        }),
        entry,
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

/** Finds the declaration owning a TSDoc message, whose metadata has no export name. */
function declarationName(program, message) {
  const source = message.sourceFilePath && program.getSourceFile(message.sourceFilePath);
  if (!source) {
    return undefined;
  }
  const position = source.getPositionOfLineAndCharacter(
    (message.sourceFileLine ?? 1) - 1,
    (message.sourceFileColumn ?? 1) - 1,
  );
  let name = undefined;
  const visit = (node) => {
    if (position < node.getFullStart() || position >= node.end) {
      return;
    }
    if (node.name) {
      name = node.name.getText(source);
    }
    if (ts.isVariableStatement(node)) {
      name = node.declarationList.declarations[0]?.name.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return name;
}

/** Checks emitted API surfaces; update writes reports but never suppresses declaration failures. */
function checkApi(root, packages, { update = false } = {}) {
  const failures = [];
  const fail = (file, line, id, name, text) => {
    failures.push(
      `${relative(root, file)}:${line}: ${id}: ${name}: ${text.replaceAll(/\s+/gu, ' ')}`,
    );
  };
  const entries = packages.flatMap((policy) => entryConfigs(root, policy));
  if (entries.length === 0) {
    return failures;
  }
  const compilerState = CompilerState.create(entries[0].config, {
    additionalEntryPoints: entries.map(({ config }) => config.mainEntryPointFilePath),
  });
  for (const { config, entry, policy } of entries) {
    const seenForgotten = new Set();
    const seenExternal = new Set();
    // Extractor silently preserves external re-exports, so inspect its resolved export symbols.
    const program = compilerState.program;
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(config.mainEntryPointFilePath);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const external = target.declarations?.some((declaration) => {
        const path = declaration.getSourceFile().fileName;
        const fromPackage = relative(config.projectFolder, path);
        return (
          fromPackage.startsWith('..') ||
          isAbsolute(fromPackage) ||
          fromPackage.split(/[\\/]/u).includes('node_modules')
        );
      });
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
          (messageId.startsWith('tsdoc-')
            ? declarationName(compilerState.program, message)
            : undefined) ??
          /"(?<name>[^"\n]+)"/u.exec(text)?.groups?.name ??
          entry;
        if (messageId === 'ae-internal-missing-underscore' || messageId === 'ae-undocumented') {
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
