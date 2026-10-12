# Kvasir — Decisões Técnicas

> Por que cada decisão foi tomada. Importante para não repetir discussões.

---

## Linguagem: Node.js + TypeScript

**Decisão:** Kvasir é construído em Node.js + TypeScript.

**Por quê:** Mesma stack dos projetos que o Kvasir vai servir (Next.js, RN/Expo). Zero fricção — o dev já conhece a linguagem, não precisa aprender nada novo para contribuir.

---

## Comunicação com IA: clipboard bridge (clipboardy)

**Decisão:** Em vez de chamar a API da Anthropic diretamente, o Kvasir gera o prompt, copia para o clipboard e aguarda o usuário colar a resposta.

**Por quê:** A conta da empresa não expõe API key programática — é autenticada via OAuth no VS Code. Usar `@anthropic-ai/sdk` exigiria uma API key paga separada. O clipboard bridge permite usar o Claude do VS Code (já pago pela empresa) sem custo adicional.

**Impacto futuro:** Quando houver API key disponível (pessoal ou via Groq/Gemini gratuito), o `src/ai/client.ts` é substituído sem mudar nada nos módulos.

---

## Executor local: Ollama

**Decisão:** Ollama rodando localmente como executor de tarefas mecânicas.

**Por quê:**
- Gratuito — sem custo por token
- Privado — nada sai do PC
- Offline — funciona sem internet
- Rápido para tarefas simples

**Modelos escolhidos:**
- `codellama` → código, commits, review, fix
- `llama3.2` → texto, documentação, português

---

## Comandos git: spawnSync em vez de execSync

**Decisão:** Todos os comandos git usam `spawnSync` com array de argumentos.

**Por quê:** O `execSync` no Windows não aceita flags como `--cached` e `--staged` da mesma forma. O `spawnSync(['git', 'diff', '--cached'])` funciona em todas as plataformas sem adaptação.

---

## Formato neutro: kvasir.context.md

**Decisão:** Um arquivo markdown neutro como fonte da verdade. Cada IA lê via adaptador próprio.

**Por quê:** Evita lock-in em uma única IA. Adicionar suporte ao Cursor, Copilot ou qualquer outra IA é só criar um novo adapter que lê o `kvasir.context.md` e gera o arquivo específico.

**Adaptadores:**
- `claude.ts` → `CLAUDE.md`
- `copilot.ts` → `.github/copilot-instructions.md`
- `cursor.ts` → `.cursor/rules`

---

## Detecção de projeto: deps do package.json

**Decisão:** O tipo de projeto é detectado pelas dependências, não pelo nome.

**Por quê:** O nome pode variar (`app_acmeexample`, `acme-web-app`, etc). As dependências são mais confiáveis — se tem `expo`, é mobile; se tem `next`, é web.

**Regra adicional:** Se o nome contém `acme` em qualquer posição → persona ACME aplicada.

---

## Templates de CLAUDE.md: por stack

**Decisão:** Dois templates separados — `acme-mobile.md` e `acme-web.md`.

**Por quê:** As regras de código são completamente diferentes entre RN/Expo e Next.js. Um template único ficaria genérico demais para ser útil. O Kvasir detecta a stack e usa o template certo.

---

## Interface: português, código: inglês

**Decisão:** Toda interface do Kvasir (perguntas, confirmações, mensagens) em português. Commits, branch names e código sempre em inglês.

**Por quê:** O dev é brasileiro — a interface em português reduz fricção. Commits em inglês é padrão da ACME e da indústria — facilita code review internacional e histórico legível.

---

## Documentação de libs: DOC/libs/ separado de DOC/code/

**Decisão:** Duas pastas separadas dentro de `DOC/`.

**Por quê:** Conteúdo de origem diferente:
- `DOC/libs/` → buscado externamente (npm, GitHub)
- `DOC/code/` → gerado a partir do código do próprio projeto

Misturar os dois tornaria difícil saber o que é doc interna e o que é doc externa.

---

## Aprendizado: assíncrono e não intrusivo

**Decisão:** O Kvasir registra aprovações/rejeições em background sem interromper o fluxo.

**Por quê:** Perguntar "por que você rejeitou?" após cada ação seria irritante. O sistema registra o comportamento silenciosamente e consolida periodicamente com `kvasir learn`.

---

## CLI: módulos separados por responsabilidade

**Decisão:** Cada módulo em sua própria pasta em `src/modules/`. Arquivos CLI em `src/cli/` são thin — só registram o comando e chamam o runner.

**Por quê:** Facilita testar, manter e expandir. Um bug no `commit` não afeta o `branch`. Adicionar um novo módulo é criar uma pasta nova sem tocar no resto.

---

## Ollama: não empacotado com o Kvasir

**Decisão:** Ollama é uma dependência externa, instalada separadamente na máquina.

**Por quê:** Mesmo modelo do Node.js — você não empacota o runtime junto com o projeto. O `README.md` lista como requisito e o `setup.sh` verifica se está instalado antes de continuar.
