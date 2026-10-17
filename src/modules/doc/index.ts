import axios from 'axios';
import { askFor } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { getNotePath, readNote, saveNote } from '@modules/knowledge/notes';
import { cleanAnswer, truncateForPrompt } from '@ai/parse';
import { confirm } from '@utils/prompt';
import { writeFile } from '@utils/fs';
import { loadContext } from '@modules/init/contextWriter';

interface NpmRepository {
  type?: string;
  url?: string;
}

interface NpmRegistryResponse {
  readme?: string;
  repository?: string | NpmRepository;
  homepage?: string;
}

const GITHUB_README_BRANCHES = ['main', 'master'];

const DOC_MAX_TOKENS = 2048;

const README_MAX_CHARS = 6000;

// Install command and links are known facts: pass them in instead of letting the model invent URLs.
function buildSummaryPrompt(libraryName: string, readme: string, links: string[]): string {
  return `Documentação (README) da biblioteca "${libraryName}":
${truncateForPrompt(readme, README_MAX_CHARS)}

Com base APENAS no README acima, escreva em português do Brasil um resumo com exatamente estas seções:

## O que é
2 frases explicando o propósito da biblioteca.

## Instalação
\`npm install ${libraryName}\`

## Principais funcionalidades
Lista de até 5 funcionalidades, em texto, sem blocos de código.

## Quando usar
2 frases sobre quando esta biblioteca é recomendada.

## Links úteis
${links.map((link) => `- ${link}`).join('\n')}

Regras: responda só em português; não invente funcionalidades que não estão no README; copie as seções "Instalação" e "Links úteis" exatamente como estão acima. Comece direto em "## O que é".`;
}

// Scoped packages ("@tanstack/react-query") must not become a sub-folder: "tanstack__react-query".
function toLibFileName(libraryName: string): string {
  return `${libraryName.replace(/^@/, '').replace(/\//g, '__')}.md`;
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

  const links = [`https://www.npmjs.com/package/${libraryName}`, ...(npmData.homepage ? [npmData.homepage] : [])];
  const summary = cleanAnswer(
    await askFor('doc', buildSummaryPrompt(libraryName, readme, links), {
      maxTokens: DOC_MAX_TOKENS,
      temperature: 0.2,
    })
  );

  const projectDocPath = `DOC/libs/${toLibFileName(libraryName)}`;
  const knowledgePath = getNotePath('libs', libraryName);

  console.log(`\nIsso vai salvar a documentação em:`);
  console.log(`  - ${projectDocPath}`);
  console.log(`  - ${knowledgePath}`);
  console.log('\nResumo:');
  console.log(summary);

  const approved = await confirm(`Salvar documentação de "${libraryName}"?`);
  await recordOutcome('doc', approved ? 'approved' : 'rejected');
  if (!approved) {
    console.log('Documentação descartada.');
    return;
  }

  await writeFile(projectDocPath, summary);

  // Already documented by another project: keep the summary, just add this project to "Usado em".
  const existingKnowledge = await readNote('libs', libraryName);
  const knowledgeBody = existingKnowledge
    ? mergeUsageLinks(existingKnowledge.body, context.project.name)
    : `Usado em: ${buildUsageLink(context.project.name)}\n\n## Resumo\n${summary}`;

  const saved = await saveNote(
    { category: 'libs', title: libraryName, body: knowledgeBody, origin: 'kvasir doc', tags: ['lib'], project: context.project.name },
    'replace'
  );

  console.log(`\nSalvo: ${projectDocPath}`);
  console.log(`📚 Nota salva no knowledge: ${saved}`);
}
