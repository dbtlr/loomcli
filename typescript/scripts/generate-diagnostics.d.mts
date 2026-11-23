import type { DeclaredRule } from './rule-source.mjs';

export function escapeMarkdown(text: string): string;
export function renderDiagnostics(rules: readonly DeclaredRule[]): string;
