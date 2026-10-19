export type KnowledgeCategory = 'libs' | 'patterns' | 'decisions' | 'tasks' | 'commits' | 'errors' | 'agents' | 'answers';

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['libs', 'patterns', 'decisions', 'tasks', 'commits', 'errors', 'agents', 'answers'];

export interface NoteMeta {
  title: string;
  tags: string[];
  projects: string[];
  origin: string;
  created: string;
  updated: string;
}
