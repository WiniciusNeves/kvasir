import type { Persona } from '@ktypes/persona';

// The only persona shipped with Kvasir: neutral Git Flow + Conventional Commits. Company personas
// (and their CLAUDE.md templates) are personal and live in ~/.kvasir, never in this repository.
export const defaultPersona: Persona = {
  name: 'default',
  stack: ['TypeScript'],
  repoNaming: {
    pattern: '<name>-<type>',
    suffixes: ['-web', '-api', '-mobile'],
  },
  branchRules: [
    { prefix: 'feature/', description: 'New features' },
    { prefix: 'fix/', description: 'Bug fixes in development' },
    { prefix: 'hotfix/', description: 'Critical fixes from production' },
    { prefix: 'release/', description: 'Release preparation' },
    { prefix: 'chore/', description: 'Build, tooling, dependency updates' },
  ],
  commitRules: {
    convention: 'Conventional Commits',
    language: 'English',
    format: '<type>(<scope>): <description>',
    types: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'ci', 'chore', 'revert'],
  },
  language: 'English',
};
