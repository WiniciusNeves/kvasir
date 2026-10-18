import os from 'os';
import path from 'path';
import { readJson, writeFile } from '@utils/fs';

// ~/.kvasir/config.json: user settings shared by the modules. Never put API keys here (they come from
// environment variables): this file is plain text and easy to sync or share by accident.

export interface AiSettings {
  // consent to send prompts to cloud providers (undefined = not asked yet)
  cloud?: boolean;
  geminiModel?: string;
  groqModel?: string;
}

// Swaps an agent's models without touching modules (kvasir agents). Names match ai/agents.ts.
export interface AgentSettings {
  // local Ollama chain, in order (replaces the default chain of all the agent's tasks)
  models?: string[];
  // false = this agent never uses the cloud
  cloud?: boolean;
}

export interface UserConfig {
  daily?: { repos?: string[] };
  ai?: AiSettings;
  agents?: Record<string, AgentSettings>;
  [key: string]: unknown;
}

export function getUserConfigPath(): string {
  return path.join(os.homedir(), '.kvasir', 'config.json');
}

export async function readUserConfig(): Promise<UserConfig> {
  return (await readJson<UserConfig>(getUserConfigPath())) ?? {};
}

export async function updateUserConfig(mutate: (config: UserConfig) => void): Promise<void> {
  const config = await readUserConfig();
  mutate(config);
  await writeFile(getUserConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}
