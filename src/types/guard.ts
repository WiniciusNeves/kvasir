export type GuardSeverity = 'block' | 'warn';

export interface GuardFinding {
  ruleId: string;
  severity: GuardSeverity;
  filePath: string;
  // null = the whole file (forbidden file in the stage)
  lineNumber: number | null;
  description: string;
  // the matched text, already masked for display
  excerpt: string;
  // the raw matched text, used by the .kvasirignore "match:" allowlist
  match: string;
}

export interface GuardAllowlist {
  paths: RegExp[];
  rules: Set<string>;
  matches: Set<string>;
}
