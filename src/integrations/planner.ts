import axios from 'axios';
import { z } from 'zod';
import type { Task, TaskFetchResult } from '@ktypes/task';

const REQUEST_TIMEOUT_MS = 10_000;

// The Planner API is external: validate the shape instead of trusting it (ids may come as numbers).
const taskSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  status: z.string().optional().default('?'),
});
const tasksSchema = z.array(taskSchema);

function describeRequestError(error: unknown, url: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) return 'O Planner recusou o acesso. Confira o token em KVASIR_PLANNER_API_TOKEN.';
    if (status) return `O Planner respondeu com erro ${status} (${url}).`;
    return `Não foi possível conectar ao Planner em ${url}. Confira KVASIR_PLANNER_API_URL e sua conexão.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function fetchMyTasks(): Promise<TaskFetchResult> {
  // Read at call time, not at import time, so the env can change between runs/tests.
  const url = process.env.KVASIR_PLANNER_API_URL ?? '';
  const token = process.env.KVASIR_PLANNER_API_TOKEN ?? '';

  if (!url) return { tasks: [], source: 'none' };

  let data: unknown;
  try {
    const response = await axios.get<unknown>(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: REQUEST_TIMEOUT_MS,
    });
    data = response.data;
  } catch (error) {
    throw new Error(describeRequestError(error, url));
  }

  const parsed = tasksSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('O Planner respondeu num formato inesperado (esperado: lista de { id, title, status }).');
  }

  const tasks: Task[] = parsed.data;
  return { tasks, source: 'planner' };
}

export const PLANNER_SETUP_HINT =
  'Configure KVASIR_PLANNER_API_URL (e KVASIR_PLANNER_API_TOKEN, se a API exigir) para buscar suas tasks.';
