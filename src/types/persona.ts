export interface PersonaRepoNaming {
  pattern: string;
  suffixes: string[];
}

export interface PersonaBranchRule {
  prefix: string;
  description: string;
}

export interface PersonaCommitRules {
  convention: string;
  language: string;
  format: string;
  types: string[];
}

export interface Persona {
  name: string;
  stack: string[];
  repoNaming: PersonaRepoNaming;
  branchRules: PersonaBranchRule[];
  commitRules: PersonaCommitRules;
  language: string;
}

export interface PersonaStore {
  [personaName: string]: Persona;
}
