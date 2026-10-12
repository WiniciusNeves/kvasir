import os from 'os';
import path from 'path';
import axios from 'axios';
import { askFor } from '@ai/router';
import { confirm } from '@utils/prompt';
import { writeFile, readFile } from '@utils/fs';
import { loadContext } from '@modules/init/contextWriter';

interface NpmRepository {
  type?: string;
  url?: string;
}

interface NpmRegistryResponse {
  readme?: string;
  repository?: string | NpmRepository;
}

const GITHUB_README_BRANCHES = ['main', 'master'];

const DOC_MAX_TOKENS = 2048;

function buildSummaryPrompt(libraryName: string, readme: string): string {
  return `Responda APENAS em português brasileiro.
Não gere código. Gere um resumo textual estruturado.

Com base na documentação abaixo da biblioteca "${libraryName}",
escreva um resumo com exatamente estas seções:

## O que é
2 frases explicando o propósito da biblioteca.

## Instalação
Somente o comando npm install.

## Principais funcionalidades
Lista de 5 funcionalidades em texto, sem código.

## Quando usar
2 frases sobre quando esta biblioteca é recomendada.

## Links úteis
Link para a documentação oficial.

Documentação:
${readme.slice(0, 3000)}`;
}

function getKnowledgeLibPath(libraryName: string): string {
  return path.join(os.homedir(), '.kvasir', 'knowledge', 'libs', `${libraryName}.md`);
}

async function fetchNpmData(libraryName: string): Promise<NpmRegistryResponse> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(libraryName)}`;
  const response = await axios.get<NpmRegistryResponse>(url);
  return response.data;
}

function extractGitHubRepo(repository: string | NpmRepository | undefined): { owner: string; repo: string } | null {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return null;

  const shorthandMatch = /^github:([^/]+)\/(.+)$/i.exec(raw);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2].replace(/\.git$/, '') };
  }

  const urlMatch = /github\.com[/:]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(raw);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  return null;
}

async function fetchGithubReadme(owner: string, repo: string): Promise<string> {
  for (const branch of GITHUB_README_BRANCHES) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
    try {
      const response = await axios.get<string>(url);
      if (typeof response.data === 'string' && response.data.trim()) {
        return response.data;
      }
    } catch {
      // try the next branch
    }
  }

  return '';
}

async function resolveReadme(npmData: NpmRegistryResponse): Promise<string> {
  const npmReadme = npmData.readme ?? '';
  if (npmReadme.trim()) return npmReadme;

  const githubRepo = extractGitHubRepo(npmData.repository);
  if (!githubRepo) return '';

  console.log(`Nenhum README no npm. Tentando GitHub (${githubRepo.owner}/${githubRepo.repo})...`);
  return fetchGithubReadme(githubRepo.owner, githubRepo.repo);
}

function buildUsageLink(projectName: string): string {
  return `[[${projectName}]]`;
}

function mergeUsageLinks(existingContent: string, projectName: string): string {
  const link = buildUsageLink(projectName);
  const usageLineRegex = /^Usado em: (.*)$/m;
  const match = usageLineRegex.exec(existingContent);

  if (!match) {
    return `Usado em: ${link}\n\n${existingContent}`;
  }

  const existingLinks = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (existingLinks.includes(link)) return existingContent;

  const updatedLine = `Usado em: ${[...existingLinks, link].join(', ')}`;
  return existingContent.replace(usageLineRegex, updatedLine);
}

export async function runDoc(libraryName: string): Promise<void> {
  const context = await loadContext();

  console.log(`\nBuscando documentação de "${libraryName}" no npm...`);
  const npmData = await fetchNpmData(libraryName);
  const readme = await resolveReadme(npmData);

  if (!readme.trim()) {
    console.log(`Não foi possível encontrar um README para "${libraryName}" no npm ou GitHub.`);
    return;
  }

  const summary = await askFor('doc', buildSummaryPrompt(libraryName, readme), {
    maxTokens: DOC_MAX_TOKENS,
  });

  const projectDocPath = `DOC/libs/${libraryName}.md`;
  const knowledgePath = getKnowledgeLibPath(libraryName);

  console.log(`\nIsso vai salvar a documentação em:`);
  console.log(`  - ${projectDocPath}`);
  console.log(`  - ${knowledgePath}`);
  console.log('\nResumo:');
  console.log(summary);

  const approved = await confirm(`Salvar documentação de "${libraryName}"?`);
  if (!approved) {
    console.log('Documentação descartada.');
    return;
  }

  await writeFile(projectDocPath, summary);

  const existingKnowledge = await readFile(knowledgePath);
  const knowledgeBody = existingKnowledge
    ? mergeUsageLinks(existingKnowledge, context.project.name)
    : `# ${libraryName}\n\nUsado em: ${buildUsageLink(context.project.name)}\n\n## Resumo\n${summary}\n`;

  await writeFile(knowledgePath, knowledgeBody);

  console.log(`\nSalvo: ${projectDocPath}`);
  console.log(`Salvo: ${knowledgePath}`);
}
