import axios from 'axios';
import type { Task, TaskFetchResult } from '@ktypes/task';

const PLANNER_API_URL = process.env.KVASIR_PLANNER_API_URL ?? '';
const PLANNER_API_TOKEN = process.env.KVASIR_PLANNER_API_TOKEN ?? '';

export async function fetchMyTasks(): Promise<TaskFetchResult> {
  if (!PLANNER_API_URL) {
    return { tasks: [], source: 'none' };
  }

  const response = await axios.get<Task[]>(PLANNER_API_URL, {
    headers: { Authorization: `Bearer ${PLANNER_API_TOKEN}` },
  });

  return { tasks: response.data, source: 'planner' };
}
