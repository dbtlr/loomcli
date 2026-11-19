import { basename } from 'node:path';

import {
  conflictingFormulaChecksums,
  formulaMetadataRequired,
  formulaRepositoryRequired,
  invalidFormulaPath,
  missingFormulaChecksum,
  unsupportedFormulaLicense,
} from '../commands/release/messages.js';
import {
  applicationName,
  githubRepository,
  releaseAssetName,
  releaseVersion,
} from './build-facts.js';
import { parseManifest } from './manifest.js';

interface FormulaRequest {
  readonly checksums: { readonly path: string; readonly text: string };
  readonly manifest: { readonly path: string; readonly text: string };
  readonly name: string | undefined;
  readonly output: string;
}

/** Homebrew resolves the Ruby constant from the formula's file name. */
function formulaClass(path: string): string {
  const name = basename(path, '.rb');
  const constant = name
    .toLowerCase()
    .replace(/^[a-z]/u, (letter) => letter.toUpperCase())
    .replaceAll(/[-_.][a-z\d]/gu, (pair) => pair.slice(1).toUpperCase())
    .replaceAll('+', 'x')
    .replace(/(?<=.)@(?=\d)/u, 'AT');
  if (!path.endsWith('.rb') || !/^[A-Z][A-Za-z\d_]*$/u.test(constant)) {
    throw new Error(invalidFormulaPath(path));
  }
  return constant;
}

function metadata(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(formulaMetadataRequired(field));
  }
  return value;
}

/** Ruby and JSON share these string escapes, and Ruby also interpolates unescaped `#` forms. */
function rubyString(value: string): string {
  return JSON.stringify(value).replaceAll(/#(?=[{@$])/gu, String.raw`\#`);
}

/** An SPDX license identifier, a `LicenseRef-` one included, with no operator or parenthesis. */
const licenseIdentifier = /^[A-Za-z\d.-]+\+?$/u;

/** The SPDX operators, which are never a license identifier themselves. */
const licenseOperators: ReadonlySet<string> = new Set(['AND', 'OR', 'WITH']);

/** Whether a word is one license identifier rather than an operator or a compound. */
function isLicenseIdentifier(word: string): boolean {
  return licenseIdentifier.test(word) && !licenseOperators.has(word);
}

/** The Homebrew form of each SPDX operator a formula's `license` states as a list. */
const licenseLists: ReadonlyMap<string, string> = new Map([
  ['AND', 'all_of'],
  ['OR', 'any_of'],
]);

/**
 * The value of the formula's `license` line. One identifier is a string. Identifiers joined only by
 * `OR`, or only by `AND`, are Homebrew's `any_of:` or `all_of:` list, and any other expression, one
 * with parentheses, `WITH`, or both operators, fails, because Homebrew states it another way.
 */
function formulaLicense(license: string): string {
  const words = license.trim().split(/\s+/u);
  const [single] = words;
  if (words.length === 1 && single !== undefined) {
    if (!isLicenseIdentifier(single)) {
      throw new Error(unsupportedFormulaLicense(license));
    }
    return rubyString(single);
  }
  const identifiers = words.filter((_word, index) => index % 2 === 0);
  const operators = new Set(words.filter((_word, index) => index % 2 === 1));
  const [operator] = operators;
  const list = operator === undefined ? undefined : licenseLists.get(operator);
  if (
    words.length % 2 === 0 ||
    operators.size !== 1 ||
    list === undefined ||
    !identifiers.every(isLicenseIdentifier)
  ) {
    throw new Error(unsupportedFormulaLicense(license));
  }
  return `${list}: [${identifiers.map(rubyString).join(', ')}]`;
}

function listedDigest(checksums: FormulaRequest['checksums'], asset: string): string {
  let digest: string | undefined = undefined;
  for (const line of checksums.text.split(/\r?\n/u)) {
    const entry = /^(?<digest>[\da-f]{64}) [ *](?<file>.+)$/u.exec(line)?.groups;
    if (entry?.file === asset && entry.digest !== undefined) {
      if (digest !== undefined && digest !== entry.digest) {
        throw new Error(conflictingFormulaChecksums(checksums.path, asset));
      }
      digest = entry.digest;
    }
  }
  if (digest === undefined) {
    throw new Error(missingFormulaChecksum(checksums.path, asset));
  }
  return digest;
}

export function renderReleaseFormula(request: FormulaRequest): string {
  const { checksums, manifest, output } = request;
  const fields = parseManifest(manifest.text, manifest.path);
  const facts = {
    bin: fields.bin,
    name: fields.name,
    repository: fields.repository,
    version: fields.version,
  };
  const name = applicationName(facts, request.name);
  const version = releaseVersion(facts);
  const repository = githubRepository(facts);
  if (repository === undefined) {
    throw new Error(formulaRepositoryRequired);
  }
  const base = `https://github.com/${repository}`;
  const desc = metadata('description', fields.description);
  const homepage = metadata('homepage', fields.homepage ?? base);
  const license = metadata('license', fields.license);
  const className = formulaClass(output);

  function archBlock(block: 'arm' | 'intel', platform: string) {
    const asset = releaseAssetName(name, platform);
    const url = `${base}/releases/download/v${version}/${asset}`;
    return `    on_${block} do
      url ${rubyString(url)}
      sha256 ${rubyString(listedDigest(checksums, asset))}
    end`;
  }

  return `class ${className} < Formula
  desc ${rubyString(desc)}
  homepage ${rubyString(homepage)}
  license ${formulaLicense(license)}

  on_macos do
${archBlock('arm', 'darwin-arm64')}
${archBlock('intel', 'darwin-x64')}
  end

  on_linux do
${archBlock('arm', 'linux-arm64')}
${archBlock('intel', 'linux-x64')}
  end

  # Keep the release version if Homebrew infers a different one from the asset URL.
  version ${rubyString(version)} if version.to_s != ${rubyString(version)}

  def install
    asset = File.basename(stable.url)
    chmod 0755, asset
    bin.install asset => ${rubyString(name)}
  end

  test do
    system bin/${rubyString(name)}, "--version"
  end
end
`;
}
