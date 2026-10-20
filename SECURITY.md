# Política de segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública** para falhas de segurança.

Use o reporte privado do GitHub: aba **Security** do repositório → **Report a vulnerability**. Só os mantenedores veem o relato.

Inclua, se possível:
- o que acontece e o impacto (ex.: chave de API exposta, comando executado sem aprovação, arquivo escrito fora do projeto);
- como reproduzir (versão do Kvasir, sistema operacional, passos);
- uma sugestão de correção, se tiver.

Resposta inicial em até 7 dias. Depois da correção, o relato pode ser publicado com o crédito a quem reportou, se a pessoa quiser.

## O que é sensível neste projeto

O Kvasir lida com:
- **chaves de API** (Gemini, Groq): devem existir só em variáveis de ambiente do usuário e nunca aparecer em logs, métricas, arquivos do projeto ou prompts;
- **código do usuário**: só vai para a nuvem com consentimento explícito, e algumas tarefas (`guard`, `architect`, `ask`) nunca saem da máquina;
- **execução de comandos e escrita de arquivos**: tudo deve pedir aprovação (exceto o que está documentado em `Doc/kvasir-decisions.md`, como o `kvasir fix` e o `kvasir watch`, que fazem backup e podem ser desfeitos).

Qualquer forma de burlar uma dessas garantias é uma vulnerabilidade.

## Versões suportadas

Só a versão mais recente da branch `main` recebe correções de segurança.
