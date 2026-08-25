# Prumo

## O que é

Plataforma open source de geração de imagem por IA onde o usuário cria conta,
cola **as próprias chaves de API** (13 provedores) e dispara o mesmo prompt em
vários modelos ao mesmo tempo, com o custo de cada imagem na tela antes de gastar
e teto de gasto imposto pelo banco. O dinheiro vai direto ao provedor, com a
chave do usuário: não há margem no meio.

## Estado — 24/08/2026

M0 (fundação e portão) e M1 (esqueleto vertical) em construção. **Nenhuma
funcionalidade de produto existe**: sem migration, rota, adaptador de provedor,
cofre ou tela. Antes de afirmar que o Prumo faz X, confira X no disco.

Legenda: ✅ provado · 🧪 decidido mas não medido · 🔴 bloqueia código. Quase tudo
é 🧪 hoje — tratar 🧪 como ✅ é o erro que a marcação existe para evitar.

## Stack

Node 24 LTS · TypeScript ~6 strict · Fastify 5 · ts-rest + Zod · Kysely + pg ·
PostgreSQL 17 · sharp em pool `piscina` · React 19 · Vite 8 · TanStack
Router/Query · Tailwind 4 · shadcn sobre `@base-ui/react` · Vitest · Playwright ·
oxlint · dependency-cruiser. Docker Compose com 2 serviços (`prumo` + postgres).
Sem Redis: a fila é tabela.

## Arquitetura

**Um binário Node** servindo HTTP + worker + SSE, papel escolhido por
`PRUMO_PAPEL=api|worker|tudo`. Código separável por fronteira, deploy único.

```
web/ (SPA servida pelo próprio Fastify)
 └ contrato/ (ts-rest + Zod, validação de resposta ligada)
    └ http/ → app/ → dominio/
              ↘ db/ (Kysely; UnitOfWork abre a única transação do caso de uso)
              ↘ provedores/ · armazenamento/ · cofre/
```

Import só desce. `dominio/` e `app/` **não** importam cliente HTTP, S3 nem `fs` —
é a fronteira que impõe "nenhum I/O externo dentro da transação". `provedores/`
não importa `db/` nem `dominio/`.

Fila: tabela `tarefa` (outbox escrita na mesma transação do fato, ordenada por
prazo — EDF, não FIFO, porque a URL da BFL expira em 10 min) e `slot_provedor`
(limite de concorrência como linha disputada), ambas por `FOR UPDATE SKIP
LOCKED`. LISTEN/NOTIFY → uma conexão SSE por aba.

## Invariantes que mais pegam

- **Dinheiro é `bigint` em nano-USD** (1 = 1e-9 USD). Nunca float, nunca centavo:
  existe imagem a US$ 0,0005.
- **Zero chamada HTTP dentro de transação.** Deadlock reinicia a transação e
  repete a chamada paga: duas imagens, duas cobranças.
- **`axios` é proibido no projeto inteiro.** O erro dele carrega
  `config.headers`; um `console.error(err)` publica a chave do usuário no log.
- **Nenhuma rota revela chave**, nem mascarada. A UI mostra `ultimos4`.
- **Teto é UPDATE condicional** (`... AND gasto + reservado + custo <= teto`),
  nunca checagem prévia. Zero linhas afetadas = estourou.
- **Toda mutação carrega `commandId`** do cliente, com INSERT em
  `comando_processado` na primeira linha da transação.
- **Todo preço carrega `fonte`, `coletado_em` e `metodo`**; acima de 30 dias sai
  do ranking. Número sem fonte é "não verificado", nunca fato.
- **O destino de toda chamada de saída é lista fechada em código.** Não existe
  coluna `base_url`: endpoint vindo de dado editável exfiltra credencial.
- **Toda regra nova nasce com uma violação plantada** que prova que ela reprova.

O cofre cifra as chaves (AES-256-GCM, DEK por credencial, KEK em `PRUMO_KEK`),
mas **quem hospeda consegue lê-las**. É cofre de confiança no operador, não de
sigilo, e isso vai escrito na tela de cadastro de chave.

## Verificação

```bash
node .ai/gerar.mjs --verificar
node ferramental/verificar/verificar.mjs
```

"Terminei" significa que isso passou. Não é opinião.

## Onde está a verdade

| Assunto                      | Fonte                                               |
| ---------------------------- | --------------------------------------------------- |
| plano, marcos, escopo        | `PLANO.md` (§11 é o único lugar do estado de marco) |
| banco, as 21 tabelas         | `docs/ESQUEMA.md`                                   |
| provedores e armadilhas      | `docs/PROVEDORES.md`                                |
| regras para agentes          | `.ai/politica.md` (gera CLAUDE.md e AGENTS.md)      |
| decisão que diverge do plano | `adr/`                                              |
| tarefa em andamento          | `.ai/estado/tarefa-ativa.md`                        |

Idioma: código, API, commits e issues em inglês; `PLANO.md`, `docs/`, `.ai/` e o
`ferramental/` vendorizado em português. A conversa **não** é fonte de verdade.
