export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'not-started' | 'in-progress' | 'completed';
  assignedTo: string;
  dueDate: string | null;
}

export interface TaskFetchResult {
  tasks: Task[];
  source: string;
}
