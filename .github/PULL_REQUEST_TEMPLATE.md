## O que muda

<!-- Um assunto por PR. O que muda e por quê. -->

## Como testei

<!-- Comandos rodados, cenários, o que foi testado com modelo de verdade. -->

## O que não testei

## Checklist

- [ ] `npm run typecheck` e `npm run build` passam
- [ ] Nada roda sem aprovação (ou a exceção está documentada em `Doc/kvasir-decisions.md`)
- [ ] Sem `shell: true`, `exec` ou `execSync`; chamadas de IA passam por `src/ai/`
- [ ] Sem chave de API, dado pessoal ou nome real de empresa
- [ ] Texto para o usuário em português; código e commits em inglês
- [ ] Comando novo está no `src/modules/menu/catalog.ts`
- [ ] `README.md` e `Doc/kvasir-current.md` atualizados (e `Doc/kvasir-architecture.md`, se o fluxo mudou)
