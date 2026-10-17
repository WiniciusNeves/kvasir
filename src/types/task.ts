export interface Task {
  id: string;
  title: string;
  status: string;
}

export type TaskSource = 'none' | 'planner';

export interface TaskFetchResult {
  tasks: Task[];
  source: TaskSource;
}
