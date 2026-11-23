export type FeedbackCategory = 'commits' | 'branches' | 'fixes' | 'patterns' | 'guard' | 'deploys';

export type FeedbackDecision = 'approved' | 'rejected';

export interface FeedbackEntry {
  category: FeedbackCategory;
  decision: FeedbackDecision;
  summary: string;
  timestamp: string;
}
