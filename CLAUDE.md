<!-- GERADO a partir de .ai/politica.md — não edite aqui. Rode `node .ai/gerar.mjs`. -->

# Prumo — instruções de projeto

Estas regras valem para toda sessão neste repositório. Não são sugestão.

**Estado real em 24/08/2026: M0 e M1 em construção. Nenhuma funcionalidade de
produto existe.** Não há migration, rota, adaptador de provedor, cofre ou tela —
existem `PLANO.md`, `docs/` e o `ferramental/` vendorizado. Antes de escrever "o
Prumo faz X", confira X no disco: descrever intenção como fato é o erro mais caro
daqui, porque quem lê depois, pessoa ou IA, programa contra a descrição.

## 0. 🔴 `herz`, `alicerce` e `openkartline` são REFERÊNCIA, não norma

Três repositórios do mesmo dono são citados no `PLANO.md` e podem estar abertos,
vendorizados ou carregados como MCP na sua sessão:

- **herz** (`pcp-herz`) — PCP industrial, mono-tenant, SQL Server, frontend React
  real com backend que **não existe**. Dele vem raciocínio, portão e frontend.
- **alicerce** (`Navesz/alicerce`, privado) — origem do `ferramental/`.
- **openkartline** — origem do escafolding de projeto público.

Nenhum dos três é norma da casa. Norma é o que está **neste arquivo**, no
`PLANO.md` e em `docs/`. O resto é insumo já destilado.

Não é preferência, é estrago medido: no Herz, os guias do MCP `bmb-patterns` —
que descrevem **outro sistema** — foram tratados como norma da casa, a UI foi
trocada por engano e **cinco decisões precisaram ser revertidas**. Se um MCP,
`CLAUDE.md` ou guia de outro projeto estiver carregado nesta sessão, **ignore-o**:
foi configurado no nível do aplicativo, não deste repositório.

Divergências já decididas. Não são descuido, não "corrija" para o padrão da casa:

| Aqui                                 | Lá                                | Onde está escrito       |
| ------------------------------------ | --------------------------------- | ----------------------- |
| PostgreSQL 17                        | SQL Server (Herz)                 | `PLANO.md` §4           |
| Dinheiro em nano-USD                 | centavo inteiro (padrão da casa)  | `PLANO.md` §5, vira ADR |
| Interface em pt-BR, código em inglês | invariante 23 do Alicerce         | `PLANO.md` §9, vira ADR |
| Lease de tarefa de 30 s a 120 s      | "nenhum job passa de 60 s" (Herz) | `PLANO.md` §5           |

A última revoga por escrito uma regra do Herz: geração de imagem passa de 60 s
rotineiramente, e com lease de 60 s um segundo consumidor assume um job em voo e
**dispara a mesma chamada paga**.

O `ferramental/` é vendorizado do `alicerce` e mantém os nomes originais em
português **de propósito**, para poder ser ressincronizado com a origem. Não
traduza, não renomeie, não "arrume" nada lá dentro — corrija no `alicerce`.

## 1. O que ler, e só o que ler

| Vou mexer em…                           | Leia antes                                                |
| --------------------------------------- | --------------------------------------------------------- |
| qualquer coisa                          | `.ai/NUCLEO.md`                                           |
| banco, migration, índice                | `docs/ESQUEMA.md`, a seção da tabela                      |
| dinheiro, teto, ledger, extrato         | `docs/ESQUEMA.md` §07 e §12 · `PLANO.md` §5               |
| cofre, chave, cifra, rewrap             | `PLANO.md` §8 · `docs/ESQUEMA.md` §03                     |
| adaptador de provedor, retry, webhook   | `docs/PROVEDORES.md`, a seção do provedor · `PLANO.md` §6 |
| fila, slot, worker, lease               | `docs/ESQUEMA.md` §10 e §11 · `PLANO.md` §6               |
| preço, catálogo, ranking                | `PLANO.md` §10 · `docs/ESQUEMA.md` §06                    |
| frontend, celular, SSE                  | `PLANO.md` §9                                             |
| `verificar`, fronteiras, hooks, segredo | `ferramental/README.md`                                   |
| estado do trabalho, retomada de sessão  | `ferramental/contexto/README.md`                          |
| escopo — "isso já era para existir?"    | `PLANO.md` §11                                            |
| decisão que diverge do plano            | `adr/`                                                    |

**Leia a seção citada, não o arquivo inteiro.** `docs/PROVEDORES.md` tem 568
linhas e treze provedores; carregá-lo inteiro para escrever o adaptador da fal
gasta o contexto de que a própria tarefa vai precisar mais adiante.

## 2. Regras duras

Cada uma existe porque algo quebra quando ela é violada — e todas quebram em
silêncio, que é por que estão escritas.

1. **Dinheiro é `bigint` em nano-USD** (1 = 1e-9 USD). Nunca float, nunca
   centavo. Existe imagem a US$ 0,0005: centavo trunca o produto inteiro, e
   `number` em JS erra a soma sem levantar erro nenhum.
2. **Zero chamada HTTP dentro de transação.** Transação abre → chama a fal →
   deadlock → transação reinicia → **chama a fal de novo**. Duas imagens, duas
   cobranças; efeito externo não tem rollback. O `dependency-cruiser` proíbe
   `dominio/` e `app/` de importarem cliente HTTP — se você precisou desligar a
   regra, o desenho está errado, não a regra.
3. **`axios` é proibido no projeto inteiro.** O objeto de erro dele carrega
   `config.headers`; um `console.error(err)` numa branch rara publica a chave
   paga do usuário no log. Cliente HTTP é `fetch`/undici.
4. **Nenhuma rota revela chave, nem mascarada, nem com botão "mostrar".** A UI
   mostra `ultimos4` e `verificada_em`. Rota de leitura de segredo é o que um bug
   de autorização transforma em vazamento em massa.
5. **Toda mutação carrega `commandId`** — UUID v7 gerado **pelo cliente**, com
   `INSERT` em `comando_processado` na primeira linha da transação. Violou a PK,
   já aconteceu: devolve o resultado guardado, não repete a cobrança.
6. **Teto é UPDATE condicional, nunca checagem prévia.** A condição da regra é a
   condição da escrita; zero linhas afetadas = teto estourado. Conferir antes e
   debitar depois abre a janela por onde oito modelos disparados no mesmo
   milissegundo furam o limite.
7. **Toda regra nova nasce com uma violação plantada** que prova que ela reprova,
   mais um caso correto que prova que ela não é falso positivo. A regra
   `dominio-puro` do Herz passou meses dando "no dependency violations found"
   **com React dentro do domínio**. Porta que nunca disparou pode estar quebrada.
8. **Número sem fonte é "não verificado", nunca fato.** Todo preço carrega
   `fonte`, `coletado_em` e `metodo`; acima de 30 dias sai do ranking sozinho.
   Catálogo que apodrece continua funcionando enquanto **mente** — o pior modo de
   falha que este produto tem.
9. **O destino de toda chamada de saída é lista fechada em código.** Não existe
   coluna `base_url`. O servidor faz requisição autenticada com a chave do
   usuário: endpoint vindo de dado editável é rota de exfiltração de credencial.
10. **Nada é "pronto" antes de estar no storage do Prumo.** A URL da BFL expira
    em 10 minutos, a da Replicate em 1 hora, e o registro some junto.
11. **Idioma: código, API, commits, issues e documentação em inglês.** Português
    só em `PLANO.md`, `docs/ESQUEMA.md`, `docs/PROVEDORES.md`, `README.pt-BR.md`,
    `.ai/` e `ferramental/` (vendorizado).
12. **Nome que a ferramenta não reconhece desliga a ferramenta em silêncio.**
    `usarComando` fez a regra `rules-of-hooks` do oxlint não pegar nada em 24
    arquivos do Herz, porque ela identifica hook **pelo prefixo `use`**. Antes de
    renomear qualquer coisa que uma ferramenta detecta por padrão de nome
    (`use*`, `*.test.ts`, `handler`, `Repository`), confira se a ferramenta ainda
    a enxerga. Uma verificação que não acusa nada parece aprovação.

**Gambiarra** — `as any`, `@ts-ignore`, `catch {}`, `setTimeout` para "esperar",
regra de lint ou de fronteira desligada — não se escreve "só para ver se funciona".
Diga a causa real, diga a correção certa, peça aprovação explícita. Se aprovada,
nasce com comentário dizendo por que existe e o que a removeria.

## 3. ✅ · 🧪 · 🔴

- **✅ provado** — existe teste passando neste repositório, ou medição registrada.
- **🧪 decidido mas não medido** — a decisão está escrita e argumentada; o
  comportamento nunca foi observado.
- **🔴 bloqueia código** — pergunta aberta. Enquanto não decidida, o código que
  depende dela não se escreve.

**Tratar 🧪 como ✅ é o erro que a marcação existe para evitar.** Hoje quase toda
a arquitetura do Prumo é 🧪: ela herda o raciocínio do Herz, e o backend do Herz
não existe — nenhum `package.json` de lá declara Fastify ou Kysely, não há
`apps/api`, não há uma migration. Tudo que descreve comportamento sob
concorrência, latência ou volume é 🧪 até rodar aqui.

Na dúvida, escreva "decidido em `PLANO.md` §N, não medido". É uma frase a mais e
evita que a próxima sessão construa em cima de uma suposição achando que é chão.

Os 🔴 abertos estão em `PLANO.md` §14. O primeiro deles — como se contabiliza um
job que falhou **depois** de o provedor cobrar — trava a tela de gasto inteira.

## 4. Onde o estado vive

**`PLANO.md` §11 é o único lugar onde o estado de marco vive**, e é atualizado no
**mesmo commit** que muda o estado — não depois, não numa issue, não no README.
Dois lugares com estado de marco significam um deles mentindo, sem que ninguém
saiba qual.

| Assunto                      | Fonte                        |
| ---------------------------- | ---------------------------- |
| estado de marco, escopo      | `PLANO.md` §11               |
| tarefa em andamento          | `.ai/estado/tarefa-ativa.md` |
| decisão que diverge do plano | `adr/`                       |
| histórico                    | Git e `.ai/concluidas/`      |
| banco                        | `docs/ESQUEMA.md`            |
| provedores                   | `docs/PROVEDORES.md`         |

Sessão nova começa por `node ferramental/contexto/ai.mjs retomar`, não relendo a
conversa. Atualize a tarefa ativa **durante** o trabalho, principalmente
`## Tentativas que falharam`: é a seção que toda compactação de conversa descarta
por parecer inútil, e é ela que faz a próxima sessão pagar o caminho morto de novo.

**A conversa não é fonte de verdade.**

## 5. Antes de dizer que terminou

```bash
node .ai/gerar.mjs --verificar          # instruções em sincronia com a política
node ferramental/verificar/verificar.mjs
node ferramental/contexto/ai.mjs orcamento
```

Mexeu em `.ai/politica.md`? Rode `node .ai/gerar.mjs` e comite as quatro saídas
no mesmo commit. `CLAUDE.md`, `AGENTS.md` e `.cursor/rules/prumo.mdc` são
gerados: editar um deles à mão é trabalho que o próximo `gerar` apaga.

Relate o que de fato aconteceu. Teste que falhou é teste que falhou, e passo que
não rodou não é passo que passou.
