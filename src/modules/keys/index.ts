import { cloudKeyFor, checkCloudKey, setCloudConsent } from '@ai/router';
import { CLOUD_KEY_INFO } from '@ai/providers';
import type { CloudProvider } from '@ai/providers';
import { confirm, password, select } from '@utils/prompt';
import { readSavedUserEnv, removeUserEnv, userEnvLocation, writeUserEnv } from '@utils/userEnv';
import { readUserConfig } from '@utils/userConfig';

const PROVIDERS: CloudProvider[] = ['gemini', 'groq'];
const LABELS: Record<CloudProvider, string> = { gemini: 'Gemini Flash (Google)', groq: 'Groq' };

function parseProvider(value: string | undefined): CloudProvider | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (PROVIDERS.includes(normalized as CloudProvider)) return normalized as CloudProvider;
  throw new Error(`Provedor desconhecido "${value}". Use: ${PROVIDERS.join(' ou ')}.`);
}

async function chooseProvider(value: string | undefined, message: string): Promise<CloudProvider> {
  return (
    parseProvider(value) ??
    select<CloudProvider>(
      message,
      PROVIDERS.map((provider) => ({ name: LABELS[provider], value: provider }))
    )
  );
}

// Status only: never prints the key, not even a part of it.
export async function runKeys(): Promise<void> {
  console.log('🔑 Chaves de IA na nuvem (opcionais: sem elas tudo roda no Ollama local)\n');
  for (const provider of PROVIDERS) {
    const { variable } = CLOUD_KEY_INFO[provider];
    const status = cloudKeyFor(provider) ? '✅ configurada' : '— não configurada';
    console.log(`  ${LABELS[provider]} (${variable}): ${status}`);
  }

  const consent = (await readUserConfig()).ai?.cloud;
  const consentLabel = consent === true ? 'permitido' : consent === false ? 'desligado' : 'ainda não autorizado';
  console.log(`\n  Envio para a nuvem: ${consentLabel} (kvasir models --cloud on | off)`);
  console.log('  Salvar uma chave: kvasir keys set [gemini|groq] · remover: kvasir keys remove [gemini|groq]');
}

export async function runKeysSet(providerArg?: string): Promise<void> {
  const provider = await chooseProvider(providerArg, 'Qual chave você quer salvar?');
  const info = CLOUD_KEY_INFO[provider];

  console.log(`\nCrie uma chave grátis em: ${info.url}`);
  console.log(`Ela fica salva só na sua máquina (${userEnvLocation()}), nunca no git nem no ~/.kvasir.\n`);

  const key = (await password(`Cole a chave do ${LABELS[provider]} (fica oculta):`)).trim();
  if (!key) {
    console.log('Nenhuma chave informada. Nada foi salvo.');
    return;
  }

  if (!key.startsWith(info.prefix)) {
    console.log(`⚠️  Chaves do ${LABELS[provider]} costumam começar com "${info.prefix}". Confira se colou a chave certa.`);
    if (!(await confirm('Continuar mesmo assim?'))) return;
  }

  console.log('🔎 Testando a chave na API (sem gerar nada)...');
  const problem = await checkCloudKey(provider, key);
  if (problem) {
    console.log(`⚠️  A API respondeu: ${problem}`);
    if (!(await confirm('Salvar mesmo assim?'))) return;
  } else {
    console.log('✅ Chave aceita.');
  }

  const replacing = readSavedUserEnv(info.variable) !== null;
  const action = replacing ? 'Substituir' : 'Salvar';
  if (!(await confirm(`${action} ${info.variable} nas ${userEnvLocation()}?`))) {
    console.log('Nada foi salvo.');
    return;
  }

  writeUserEnv(info.variable, key);
  console.log(`💾 ${info.variable} salva. O Kvasir já usa a partir de agora; outros programas veem depois de reabrir o terminal/VS Code.`);

  const consent = (await readUserConfig()).ai?.cloud;
  if (consent !== true) {
    const allowed = await confirm(
      'Permitir que o Kvasir envie prompts (que podem conter código do projeto) para a nuvem? Sem isso a chave fica salva, mas sem uso.'
    );
    await setCloudConsent(allowed);
    console.log(allowed ? '☁️  Nuvem permitida (desligue com "kvasir models --cloud off").' : '🔒 Ok, só Ollama local (ligue com "kvasir models --cloud on").');
  }
}

export async function runKeysRemove(providerArg?: string): Promise<void> {
  const provider = await chooseProvider(providerArg, 'Qual chave você quer remover?');
  const { variable } = CLOUD_KEY_INFO[provider];

  if (readSavedUserEnv(variable) === null) {
    console.log(`${variable} não está salva pelo Kvasir.`);
    if (process.env[variable]) console.log('Ela vem de outro lugar (variável definida no terminal ou no sistema): remova por lá.');
    return;
  }

  if (!(await confirm(`Remover ${variable} das ${userEnvLocation()}?`))) return;
  removeUserEnv(variable);
  console.log(`🗑️  ${variable} removida. Terminais já abertos ainda podem ter a variável até serem fechados.`);
}
