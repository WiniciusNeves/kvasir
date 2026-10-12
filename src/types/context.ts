export interface ProjectInfo {
  name: string;
  type: string;
  stack: string[];
  persona: string;
}

export interface DeveloperInfo {
  profile: string;
}

export interface BranchRulesInfo {
  pattern: string;
  prefix: string;
  language: string;
}

export interface CommitRulesInfo {
  convention: string;
  language: string;
  format: string;
}

export interface ActiveTaskInfo {
  id: string;
  title: string;
  linkedBranch: string;
}

export interface KvasirContext {
  project: ProjectInfo;
  developer: DeveloperInfo;
  branchRules: BranchRulesInfo;
  commitRules: CommitRulesInfo;
  activeModules: string[];
  activeTask: ActiveTaskInfo | null;
  summary: string;
}
