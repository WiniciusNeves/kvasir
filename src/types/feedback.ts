export type FeedbackCategory = 'commits' | 'fixes' | 'patterns';

export type FeedbackDecision = 'approved' | 'rejected';

export interface FeedbackEntry {
  category: FeedbackCategory;
  decision: FeedbackDecision;
  summary: string;
  timestamp: string;
}
