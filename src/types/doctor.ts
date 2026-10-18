export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  // how to fix it, shown for warn/fail
  fix?: string;
}

export interface CheckSection {
  title: string;
  results: CheckResult[];
}
