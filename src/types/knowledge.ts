export type KnowledgeCategory = 'libs' | 'patterns' | 'decisions' | 'tasks' | 'commits';

export interface KnowledgeNote {
  title: string;
  category: KnowledgeCategory;
  content: string;
  links: string[];
  updatedAt: string;
}
