import { getGitConfigIn, getOwnCommitsWithFiles } from '@utils/git';
import { recordExamples } from '@ai/examples';

// The developer's commits that already exist are the best examples of their style, from day one:
// each subject goes to the commit examples with the files it touched (the same shape a new commit
// is searched by). Incremental: what is already stored is skipped.

const HISTORY_LIMIT = 200;
const MAX_FILES = 30;
// the style summary describes the current habit, not the whole past
const STYLE_RECENT = 50;
const CONVENTIONAL = /^(\w+)(\([^)]+\))?!?: \S/;
const PORTUGUESE = /\b(adiciona|corrige|remove|atualiza|cria|ajusta|melhora|para|com|não|na|no|da|do|de)\b|ção\b|ções\b/i;
const ENGLISH = /\b(add|adds|fix|fixes|remove|update|create|improve|the|to|for|with|and|of|in)\b/i;

export interface CommitStyle {
  total: number;
  conventionalPercent: number;
  scopePercent: number;
  averageLength: number;
  language: 'inglês' | 'português' | 'misto';
}

// What a commit is about, for recording and for searching similar ones.
export function describeCommitFiles(files: string[]): string {
  const shown = files.slice(0, MAX_FILES).join(', ');
  return `arquivos: ${shown}${files.length > MAX_FILES ? ` (+${files.length - MAX_FILES} outros)` : ''}`;
}

function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

// Counted by code from the subjects, never guessed by a model.
export function describeCommitStyle(subjects: string[]): CommitStyle | null {
  if (subjects.length === 0) return null;
  const conventional = subjects.map((subject) => subject.match(CONVENTIONAL)).filter((match) => match !== null);
  const portuguese = subjects.filter((subject) => PORTUGUESE.test(subject)).length;
  const english = subjects.filter((subject) => ENGLISH.test(subject)).length;
  const language = portuguese > english * 2 ? 'português' : english > portuguese * 2 ? 'inglês' : 'misto';
  return {
    total: subjects.length,
    conventionalPercent: percent(conventional.length, subjects.length),
    scopePercent: percent(conventional.filter((match) => match?.[2]).length, conventional.length),
    averageLength: Math.round(subjects.reduce((sum, subject) => sum + subject.length, 0) / subjects.length),
    language,
  };
}

export interface HistoryLearning {
  learned: number;
  style: CommitStyle | null;
}

// Never breaks the command that calls it: without git, author or Ollama it just learns nothing.
export async function learnFromCommitHistory(): Promise<HistoryLearning> {
  try {
    const author = getGitConfigIn(process.cwd(), 'user.email');
    if (!author) return { learned: 0, style: null };
    const commits = getOwnCommitsWithFiles(author, HISTORY_LIMIT).filter((commit) => commit.title && commit.files.length > 0);
    const learned = await recordExamples(
      'commit',
      commits.map((commit) => ({ input: describeCommitFiles(commit.files), output: commit.title, decision: 'approved', source: 'git', timestamp: commit.date }))
    );
    return { learned, style: describeCommitStyle(commits.slice(0, STYLE_RECENT).map((commit) => commit.title)) };
  } catch {
    return { learned: 0, style: null };
  }
}

export function formatCommitStyle(style: CommitStyle): string {
  return `seus últimos ${style.total} commit(s): ${style.conventionalPercent}% no padrão Conventional Commits${
    style.conventionalPercent > 0 ? ` (${style.scopePercent}% com escopo)` : ''
  }, em ${style.language}, ${style.averageLength} caracteres em média`;
}
