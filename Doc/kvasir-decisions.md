# Kvasir: decisões técnicas

> Por que cada decisão foi tomada. Serve para não repetir discussões.
> Quando uma decisão mudar, atualize aqui (não apague; marque como **substituída**).

---

## Linguagem: Node.js + TypeScript

**Decisão:** O Kvasir é construído em Node.js + TypeScript strict.

**Por quê:** É a mesma stack dos projetos que ele atende (Next.js, RN/Expo). Zero fricção para contribuir.

---

## Comunicação com o Claude: ponte via clipboard (`clipboardy`)

**Decisão:** Em vez de chamar a API da Anthropic, o Kvasir copia o prompt para o clipboard e espera o usuário colar a resposta (`src/ai/client.ts` → `promptAI()`).

**Por quê:** A conta da empresa não tem API key programática (é OAuth no VS Code). Usar o SDK exigiria uma chave paga separada; o clipboard usa o Claude que a empresa já paga.

**Impacto:** Quando houver uma API (Gemini/Groq gratuitos ou uma chave pessoal), basta trocar `src/ai/`. Os módulos não mudam.

---

## Executor local: Ollama

**Decisão:** O Ollama roda localmente como executor das tarefas.

**Por quê:** É gratuito, privado (nada sai do PC), funciona offline e é rápido para tarefas simples.

**Modelos:**
- `codellama`: commit, branch
- `qwen2.5-coder`: fix, review
- `deepseek-r1`: erros complexos e arquitetura
- `llama3.2`: texto e documentação em português

---

## AI Router: orquestrador + executor + validador

**Decisão:** Todo módulo chama `askFor(task, prompt)` (`src/ai/router.ts`). O Claude escolhe o modelo entre os do `MODEL_MAP[task]`, o Ollama executa (com fallback e timeout de 30s) e o Claude valida o resultado.

**Por quê:** Um modelo grande decide e confere, e modelos locais pequenos fazem o trabalho. Assim a qualidade melhora sem custo por token.

**Custo conhecido:** São duas idas ao clipboard por chamada. Fica a reavaliar na Fase 2 do roadmap: escolha determinística por padrão e validação opcional.

---

## Comandos git: `spawnSync` em vez de `execSync`

**Decisão:** Todo comando git usa `spawnSync('git', [args])` e confere o `status` (`assertGitSuccess`): um commit recusado por hook ou um push rejeitado vira erro, não "✅".

**Por quê:** O `execSync` com string não trata flags como `--cached` do mesmo jeito no Windows. `spawnSync` com array funciona em todas as plataformas.

---

## Formato neutro: `kvasir.context.md`

**Decisão:** Um markdown neutro é a fonte da verdade, e cada IA tem um adapter.

**Por quê:** Evita lock-in. Suportar uma IA nova é só criar um adapter.

**Adapters:** `claude.ts` → `CLAUDE.md` · `copilot.ts` → `.github/copilot-instructions.md` · `cursor.ts` → `.cursor/rules`

---

## `CLAUDE.md`: cabeçalho gerado + corpo preservado

**Decisão:** O `kvasir init` escreve um cabeçalho entre `<!-- kvasir:header:start -->` e `<!-- kvasir:header:end -->`. Nas próximas execuções, só esse bloco é atualizado.

**Por quê:** O dev pode editar o corpo do `CLAUDE.md` à vontade sem o `init` apagar as mudanças.

---

## Detecção de projeto: deps para a stack, nome para a persona

**Decisão:**
- **Stack** pelas dependências: `expo` → mobile, `next` → web, `express`/`fastify` → API
- **Persona ACME** se o `name` do `package.json` **contém** `acme` em qualquer posição

**Por quê:** O nome dos projetos varia (`app_acmeexample`, `acme-web-app`...). As dependências são confiáveis para a stack.

---

## Templates de `CLAUDE.md` por stack

**Decisão:** Dois templates separados, `acme-mobile.md` e `acme-web.md`, em `src/personas/templates/`, copiados para `dist/` no build.

**Por quê:** As regras de RN/Expo e de Next.js são muito diferentes; um template único seria genérico demais.

---

## Interface em português, código em inglês

**Decisão:** As mensagens, perguntas e confirmações do Kvasir são em português. Commits, nomes de branch e código são em inglês.

**Por quê:** A interface em português reduz a fricção para o dev. Commits em inglês são o padrão da ACME e do mercado.

---

## `DOC/libs/` separado de `DOC/code/`

**Decisão:** Duas pastas dentro de `DOC/`.

**Por quê:** As origens são diferentes: a doc externa (npm/GitHub) e a doc gerada a partir do próprio código.

---

## Aprendizado assíncrono e não intrusivo

**Decisão:** As aprovações e rejeições são gravadas em `~/.kvasir/feedback/` sem interromper o fluxo, e o `kvasir learn` consolida tudo no `profile.md`.

**Por quê:** Perguntar "por que rejeitou?" a cada ação seria irritante.

---

## Módulos separados por responsabilidade

**Decisão:** Uma pasta por módulo em `src/modules/`. Os arquivos de `src/cli/` são finos: só registram o comando e chamam o runner.

**Por quê:** Um bug no `commit` não afeta o `branch`, e um módulo novo é uma pasta nova sem tocar no resto.

---

## Correções determinísticas antes da IA (`kvasir fix`)

**Decisão:** Erros com correção conhecida são corrigidos por regra, sem chamar a IA. A regra usa a própria mensagem do tsc (ex.: TS6137 "Consider importing 'X' instead of '@types/X'" → troca o caminho do import). Uma regra que não muda a linha conta como "não se aplica".

**Por quê:** É mais rápido, não falha e não depende de o modelo acertar. (A primeira versão da regra do TS6137 removia `type` do import, o que não resolve o erro.)

---

## `kvasir fix` aplica sem perguntar (exceção à regra de aprovação)

**Decisão:** (2026-10-17, pedido do usuário) O `fix` corrige o arquivo do erro colado **sem confirmação**. Depois informa quantos erros iguais existem no projeto e só então pergunta se deve corrigir os outros.

**Por quê:** O erro colado é um pedido explícito de correção; a confirmação extra virava atrito. A segurança fica no backup: cada arquivo é copiado para `~/.kvasir/backups/fix/` antes da 1ª mudança, o diff abre no VS Code e `kvasir fix --undo` restaura tudo.

---

## Nenhum `shell: true`

**Decisão:** (2026-10-17) Nenhum `spawn`/`spawnSync` usa `shell: true`, `exec` ou `execSync`. No Windows, `.cmd` (`npm`, `npx`, `code`) passa por `runCommand` (`utils/process.ts`), que chama `cmd.exe /d /s /c` com os argumentos escapados. O typecheck roda o `tsc` do projeto direto pelo `node`.

**Por quê:** Desde o Node 18.20/20.12, spawnar `.cmd` sem shell lança `EINVAL`; com `shell: true` o Node concatena os argumentos sem escapar (caminhos com espaço, `&` ou aspas quebram). Escapar em um lugar só resolve as duas coisas. Também não usamos `npx tsc`: sem TypeScript instalado ele baixa um pacote não relacionado chamado `tsc`.

---

## Melhorar a IA, não contornar (princípio do backlog v2)

**Decisão:** (2026-10-17) Quando um modelo erra, melhoramos prompt, contexto e dados; não escrevemos regra fixa para compensar. Exceção: correções 100% determinísticas e comprovadas (ex.: TS6137, cuja correção vem da própria mensagem do tsc).

**Por quê:** A IA tem que aprender com o feedback. Regra fixa esconde o problema e não melhora. Exemplo: na Fase 3 o `review` ganhou regex (`<= .length`, `any`, `console.log`) porque o qwen2.5-coder dizia "nenhum problema"; na onda A as regex saíram e o prompt passou a pedir um veredito por linha, com exemplo: o mesmo modelo passou a achar o off-by-one, a chave no código e o `console.log`. As regras de segredo voltam no `guard`, onde são determinísticas por especificação.

---

## Métricas locais em JSONL

**Decisão:** (2026-10-17) Cada chamada de IA e cada veredito do usuário vão para `~/.kvasir/metrics/calls.jsonl` (uma linha JSON por evento). Falha ao gravar é ignorada.

**Por quê:** É a base do Agent Board, do `kvasir stats`, do router por desempenho e da auto-melhoria. JSONL não precisa de banco, só cresce no fim do arquivo e qualquer ferramenta lê.

---

## Knowledge: escritor único, frontmatter e índice gerado

**Decisão:** (2026-10-17) Toda escrita no `~/.kvasir/knowledge` passa por `saveNote` (`modules/knowledge/notes.ts`), que põe frontmatter (title, tags, projetos, origem, criado, atualizado) e regenera o `index.md`. Os módulos gravam notas sozinhos (`auto.ts`). Investigações e reviews só viram nota quando o usuário diz que foram úteis.

**Por quê:** O vault tem que abrir no Obsidian sem ajuste e ser a fonte do OmniContext. Um ponto único de escrita mantém o formato. Sugestão rejeitada guardada como conhecimento ensinaria errado.

---

## `guard`: regras determinísticas, IA só no duvidoso, allowlist com hash

**Decisão:** (2026-10-17) O `guard` decide por regras fixas (formato das chaves, Luhn, dígito verificador de CPF/CNPJ, nomes de arquivo). A IA só avalia strings aleatórias que nenhuma regra reconheceu. O `.kvasirignore` gerado guarda `hash:<sha256>` do valor, nunca o valor.

**Por quê:** É uma barreira de segurança: tem que ser previsível e funcionar com o Ollama desligado. Isso não contradiz "não contornar a IA", porque aqui a regra é a especificação, não um remendo para um modelo que errou. O hash existe porque o `.kvasirignore` costuma ser commitado: na primeira versão ele gravava a chave em texto e vazava o próprio segredo.

---

## `daily` usa o modelo local direto (`askLocal`)

**Decisão:** (2026-10-17) O resumo da daily não passa pelo Claude (sem orquestração nem validação via clipboard).

**Por quê:** É um texto curto de baixo risco que o usuário lê antes de copiar; duas idas ao Claude para isso seriam desperdício de token e de tempo ("zero token desperdiçado"). Comandos que mexem em código ou em conteúdo que vai para outras pessoas sem revisão continuam com `askFor`.

---

## Prompt de "reescrever item a item" em vez de "resumir com exemplo"

**Decisão:** (2026-10-17) Quando a IA transforma uma lista conhecida (mudanças de uma versão) em texto para pessoas, ela recebe só os itens relevantes, numerados, e a ordem de devolver exatamente um item por entrada.

**Por quê:** Testando as notas do `release`, "resuma o CHANGELOG" com um exemplo concreto fez o llama3.2 copiar o conteúdo do exemplo ("extrato") e inventar itens. Reescrever item a item não deixa espaço para invenção. Comparando os dois modelos nessa tarefa, o qwen2.5-coder escreveu melhor (sem jargão), então ele vem primeiro no `MODEL_MAP.release`.

---

## Ollama não vem empacotado

**Decisão:** O Ollama é um requisito externo, instalado separadamente.

**Por quê:** Funciona como o Node.js: não se empacota o runtime com o projeto. O README lista como requisito e o `kvasir models` verifica.

---

## OmniContext (RAG) dentro do Kvasir

**Decisão:** O RAG local será um módulo isolado (`src/rag/`) dentro do Kvasir, não um projeto separado. Ele entra depois do AI router.

**Por quê:** Aproveita o Ollama, o router e o `~/.kvasir/knowledge`, e deixa os outros módulos mais inteligentes. Por ser isolado, pode virar outro repositório depois sem reescrever.

---

## Pendente: Electron ou Tauri

O app desktop pode ser feito com **Tauri** (mais leve, ensina Rust) ou **Electron** (tudo em Node/TS). Decidir antes da fase do app desktop.
