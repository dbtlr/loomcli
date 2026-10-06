import { defectEvidence } from './defect.js';
import type { SourceAccess } from './defect.js';
import { diagnosticSections, messageWidth } from './diagnostic-text.js';
import type { Anatomy } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import type { InternalError } from './errors.js';
import { sourceRoots } from './host.js';
import type { ReportHost } from './host.js';
import type { ContextualStyle } from './style.js';

/**
 * Where a development build's diagnostics print: the application name a finding's path opens with,
 * the stderr width, and the working directory and reader a defect's source comes through.
 */
interface DeveloperScene {
  readonly application: string;
  readonly host: Pick<ReportHost, 'cwd' | 'readSource' | 'terminal'>;
}

/**
 * What a defect's source is read through: the host's working directory, its roots, and reader. A
 * working directory that could not be read gives no root and no reader, so no source is read.
 */
function sourceAccess({ cwd, readSource }: DeveloperScene['host']): SourceAccess {
  if (cwd === undefined) {
    return { read: undefined, roots: [] };
  }
  return {
    read: readSource && ((path) => readSource(path, cwd)),
    roots: sourceRoots(cwd),
  };
}

/** The parts one fault renders, with a defect's source and causes read here, in development alone. */
function anatomyOf(fault: DeclarationError | InternalError, host: DeveloperScene['host']): Anatomy {
  if (fault instanceof DeclarationError) {
    return {
      correction: fault.correction,
      evidence: [],
      fallback: 'INVALID DECLARATION',
      findings: fault.findings,
      rule: fault.rule,
      sentence: fault.sentence,
    };
  }
  return {
    correction: fault.correction,
    evidence: defectEvidence(fault.cause, sourceAccess(host)),
    fallback: 'DEFECT',
    findings: [],
    rule: fault.rule,
    sentence: fault.sentence,
  };
}

/** The banner and body of one fault's diagnostic, laid out for this run's stderr. */
function sections(
  fault: DeclarationError | InternalError,
  scene: DeveloperScene,
): { banner: string; body: string } {
  return diagnosticSections(anatomyOf(fault, scene.host), {
    application: scene.application,
    width: scene.host.terminal.stderr.columns ?? messageWidth,
  });
}

/**
 * One fault's Developer Diagnostic as marked text for stderr, the banner in the error style, and
 * the hints printed under it after one blank line. It is not a view, so no override replaces it.
 */
function developerText(
  fault: DeclarationError | InternalError,
  scene: DeveloperScene & { readonly hints: readonly string[]; readonly style: ContextualStyle },
): string {
  const { banner, body } = sections(fault, scene);
  const { hints, style } = scene;
  const hinted = hints.length === 0 ? '' : `\n${hints.map((hint) => `${hint}\n`).join('')}`;
  return `${style.error(style.escape(banner))}\n\n${style.escape(body)}\n${hinted}`;
}

/** One fault's Developer Diagnostic as plain text, for the plain fallback path. */
function developerPlainText(
  fault: DeclarationError | InternalError,
  scene: DeveloperScene,
): string {
  const { banner, body } = sections(fault, scene);
  return `${banner}\n\n${body}\n`;
}

export type { DeveloperScene };
export { developerPlainText, developerText };
