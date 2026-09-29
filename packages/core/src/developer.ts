import { defectEvidence } from './defect.js';
import type { SourceAccess } from './defect.js';
import { diagnosticSections, messageWidth } from './diagnostic-text.js';
import type { Anatomy } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import type { InternalError } from './errors.js';
import type { ContextualStyle } from './style.js';
import type { Host } from './types.js';

/**
 * Where a development build's diagnostics print: the application name a finding's path opens with,
 * the stderr width, and the working directory and reader a defect's source comes through.
 */
interface DeveloperScene {
  readonly application: string;
  readonly host: Pick<Host, 'cwd' | 'readSource' | 'terminal'>;
}

/** The parts one fault renders, with a defect's source and causes read here, in development alone. */
function anatomyOf(fault: DeclarationError | InternalError, access: SourceAccess): Anatomy {
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
    evidence: defectEvidence(fault.cause, access),
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
  const { cwd, readSource, terminal } = scene.host;
  return diagnosticSections(anatomyOf(fault, { cwd, readSource }), {
    application: scene.application,
    width: terminal.stderr.columns ?? messageWidth,
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
