export type KnowledgeCategory = 'libs' | 'patterns' | 'decisions' | 'tasks' | 'commits' | 'errors' | 'agents';

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['libs', 'patterns', 'decisions', 'tasks', 'commits', 'errors', 'agents'];

export interface NoteMeta {
  title: string;
  tags: string[];
  projects: string[];
  origin: string;
  created: string;
  updated: string;
}
