# Kvasir

CLI modular de produtividade para desenvolvedores, em Node.js + TypeScript, com IA local (Ollama).

## Módulos

| Comando          | O que faz                                                        |
|------------------|------------------------------------------------------------------|
| `kvasir init`    | Detecta o tipo de projeto e gera o `CLAUDE.md` a partir de templates |
| `kvasir commit`  | Gera mensagens no padrão Conventional Commits                    |
| `kvasir branch`  | Gera nomes de branch no padrão Git Flow                          |
| `kvasir doc`     | Documenta libs (npm/GitHub) e o código do projeto (`--code`)     |
| `kvasir models`  | Lista os modelos do Ollama e o modelo ativo por tarefa           |
| `kvasir fix`     | Em desenvolvimento                                               |

## Requisitos

- Node.js >= 18
- [Ollama](https://ollama.com) rodando localmente

## Instalação

```bash
npm install
npm run build
npm link   # deixa o comando `kvasir` disponível globalmente
```

Desenvolvimento: `npm run dev -- <comando>`

## Documentação

- `Doc/kvasir-roadmap.md`: roadmap
- `Doc/kvasir-decisions.md`: decisões de arquitetura
- `Doc/ideas/`: ideias futuras (ex: [OmniContext](Doc/ideas/omnicontext.md))
