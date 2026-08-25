# Prumo — plano de construção (v2)

> Fio de prumo: a ferramenta que prova que a parede está reta.
> Aqui, a que prova que o preço está certo — e que a imagem saiu pelo menor preço.

**Estado:** **M0, M1 e M2 fechados. O índice de preço está no ar, público, sem
conta e sem chave.** Portão provado, Postgres de verdade, cofre com envelope
AES-256-GCM e RLS de papel restrito, três coletores (fal, DeepInfra, OpenRouter)
e 648 modelos no catálogo. **Nenhuma geração ainda** — é o próximo marco.

O índice foi antecipado a pedido, fora da ordem da tabela abaixo (lá ele é M6):
sem ver o preço de tudo, ninguém sabe de qual provedor vale a pena colar a chave.
A tela usa o rótulo **M3** por causa disso; a tabela de marcos guarda a ordem
original, e a diferença é deliberada, não deriva.

**Onde a comparação entre provedores está hoje:** três variantes de modelo têm
preço em mais de um provedor — FLUX.2 [klein] 4B (1,6×), 9B (1,4×) e [pro]
(2,0×). Três é pouco e é o número honesto: dez dos treze provedores não publicam
preço legível por máquina, e a regra de identidade recusa todo casamento que ela
não consegue explicar. Ela chegou a dizer doze, e nove daqueles comparavam
modelos diferentes.
**Legenda:** ✅ provado · 🧪 decidido mas não medido · 🔴 bloqueia código · ⬜ planejado

---

## 1. O que é

Uma plataforma onde **você cria conta, cola as suas chaves de API e gera imagem de
verdade** — disparando o mesmo prompt em vários modelos ao mesmo tempo, com o custo
de cada imagem na tela antes de gastar, teto de gasto que o banco impõe, galeria,
extrato e um índice de preço que escolhe a rota mais barata.

Open source, auto-hospedável em `docker compose up`, sem intermediário cobrando
margem: o dinheiro vai direto para o provedor com a sua chave.

---

## 2. O que mudou da v1 para a v2

A v1 errou em três coisas, e as três foram corrigidas por você.

| v1 dizia                                     | v2 diz                                           | Por quê                                                                                 |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Índice de preço primeiro, estúdio depois     | **Estúdio é M3, índice é M6**                    | Sem estúdio, o índice é planilha bonita que ninguém usa. O motor não vem antes do carro |
| Local-first, sem servidor, sem banco         | **Postgres 17 + Fastify, plataforma de verdade** | Pedido literal seu: "bem forte, bem potente, banco de dados, frontend"                  |
| Chave cifrada no navegador com frase secreta | **Cofre no servidor, cifra de envelope**         | Tecnicamente forçado — ver §8. Não foi preferência                                      |

E um erro meu: eu disse que a stack do Herz encaixava 1:1. **O backend do Herz não
existe.** Conferido no disco: nenhum `package.json` declara Fastify, Kysely ou
tedious; não há `apps/api`; não há uma única migration. O que existe é
`apps/web` (16.912 linhas), `packages/contracts` (1.612) e `packages/dominio`
(2.758). O frontend dele fala com um transporte falso.

**Consequência:** do Herz herdamos **raciocínio, portão e frontend real** — nunca
"a stack que o Leonardo já opera", porque ela ainda não foi operada.

---

## 3. A tese

1. **Preço em README é folclore; preço com fonte e data é dado.** Toda linha de
   preço carrega fonte, data e método, e acima de 30 dias sai do ranking sozinha.

2. **O mesmo modelo custa preços diferentes em provedores diferentes.** Essa
   diferença é o produto, e ela só é utilizável dentro de um estúdio que gera.

3. **O recibo corrige o catálogo.** O custo que o provedor devolve depois de uma
   geração real vale mais que qualquer página de preço.

4. **Chave de terceiro é depósito, não dado.** O Prumo é depositário de uma chave
   que gasta dinheiro do dono dela. Isso muda o esquema, o log, o backup e a tela.

---

## 4. Arquitetura decidida

**Um binário Node servindo HTTP + worker + SSE**, selecionado por
`PRUMO_PAPEL=api|worker|tudo`. Dois contêineres no compose (`prumo` +
`postgres:17-alpine`), Caddy como perfil opcional. Três comandos para subir.

O código nasce **separável** (fronteiras impostas por `dependency-cruiser`), o
deploy nasce **único**. No dia em que a medição exigir dois processos, é uma linha
de compose — não uma refatoração.

```
React 19 · Vite 8 · TanStack Router/Query · Tailwind 4 · shadcn sobre Base UI
    │                                    SPA servida pelo próprio Fastify (origem única)
packages/contract — oRPC + Zod, rota inteira, validação de resposta ligada
    │
Fastify 5 — dominio/ app/ http/ db/ provedores/ armazenamento/ cofre/
    │
UnitOfWork — uma transação por caso de uso, único lugar que abre transação
    │
Kysely + pg — um pool, uma API de transação
    │
PostgreSQL 17 — FOR UPDATE SKIP LOCKED · LISTEN/NOTIFY · RLS · JSONB · índice parcial
```

### Stack por camada

| Camada       | Escolha                                                                           | Origem      |
| ------------ | --------------------------------------------------------------------------------- | ----------- |
| Runtime      | Node 24 LTS · TS ~6.0 strict · `noUncheckedIndexedAccess`                         | Herz        |
| HTTP         | Fastify 5 + `@fastify/static` servindo o build do Vite                            | Herz        |
| Contrato     | **oRPC 1.15 + Zod 4.4**, OpenAPI **gerado a partir** do contrato — ver `adr/0011` | **diverge** |
| Banco        | PostgreSQL 17 · pgcrypto (só `gen_random_uuid`) · citext                          | **diverge** |
| Dados        | Kysely 0.29 + pg 8.23 · UnitOfWork · migração no boot sob advisory lock           | Herz        |
| Fila         | Tabela `tarefa` + `slot_provedor`, `FOR UPDATE SKIP LOCKED`. Sem Redis            | novo        |
| Tempo real   | LISTEN/NOTIFY → SSE, **uma** conexão por aba, fallback polling 3 s                | Herz        |
| Bytes        | Interface `Blobs`; driver `disco` padrão, `s3` opcional (aws4fetch, ~5 KB)        | novo        |
| Imagem       | `sharp` dentro de pool `piscina` (worker_threads), `sharp.cache(false)`           | novo        |
| Cofre        | `node:crypto` puro, AES-256-GCM, envelope DEK/KEK                                 | novo        |
| Sessão       | Opaca em tabela (guarda só o SHA-256), cookie host-only. scrypt N=2¹⁷             | Herz        |
| Multi-tenant | `usuario_id` no WHERE do repositório + RLS como segunda porta                     | novo        |
| Erros        | Problem Details RFC 9457, `type` estável por classe                               | Herz        |
| Frontend     | React 19.2 · Vite 8 · TanStack · Tailwind 4 · shadcn sobre `@base-ui/react`       | Herz        |
| Deploy       | Docker Compose, 2 serviços, 2 volumes                                             | **diverge** |

**Por que Postgres e não SQL Server:** SQL Server é licenciado e amarra o
self-host a Windows. O _raciocínio_ do Herz sobrevive inteiro ("correção sob
concorrência, não escala") e a troca **apaga um risco aberto** do original:
`FOR UPDATE SKIP LOCKED` substitui o trio `UPDLOCK+READPAST+READCOMMITTEDLOCK`,
que é a única query do Herz marcada como hipótese não testada
(`guias/banco.md:184-186`).

**Por que um processo e não dois:** o risco nº 6 do próprio Herz é o
autodiagnóstico exato deste projeto — _"cada item é defensável isolado; somados, é
bastante coisa para sustentar sozinho"_ (`Riscos.md:59-63`). Um processo significa
um log, um deploy, um lugar para depurar às 3 da manhã. E devolve uma correção de
graça: rate limit em memória volta a estar certo (o defeito nº 1 de auth do Herz —
`Map` por processo — só é defeito quando há N processos).

---

## 5. O banco — 21 tabelas, e as seis que decidem tudo

O esquema completo está em `docs/ESQUEMA.md`. As seis que carregam a arquitetura:

### `orcamento` — o teto que o banco impõe

```sql
UPDATE orcamento
   SET reservado_nano = reservado_nano + $custo
 WHERE usuario_id = $u AND janela = $j AND janela_inicio = $i
   AND gasto_nano + reservado_nano + $custo <= teto_nano
RETURNING teto_nano - gasto_nano - reservado_nano AS folga;
```

**Zero linhas afetadas = teto estourado.** A condição da regra é a condição da
escrita: não existe janela entre conferir e debitar, e por isso é
**estruturalmente impossível** oito modelos disparados no mesmo milissegundo
furarem o limite. É o `reservarEstoque` do Herz com outro nome
(`guias/banco.md:78-101`).

**`CHECK (gasto + reservado <= teto)` está proibido.** Na liquidação o custo
apurado pode superar a reserva — e o dinheiro **já foi gasto no provedor**.
Recusar a escrita ali produz um ledger que mente sobre a fatura real. Sobra
`CHECK (>= 0)`; o estouro carimba `estourou_em` e vira faixa de aviso.

> **Regra:** CHECK que impede gravar um fato já ocorrido não protege o invariante,
> destrói a auditoria.

**Ordem fixa de escrita:** sempre `mes` e depois `sessao`. Duas transações tocando
as mesmas duas linhas em ordens diferentes é a receita de deadlock previsível.

**Unidade: nano-USD inteiro** (`bigint`, 1 = 1e-9 USD). Centavo trunca o produto —
existe imagem a US$ 0,0005 — e a própria fal já expõe `cost_estimate_nano_usd`.
Diverge do padrão da casa (centavos inteiros): vira ADR.

### `slot_provedor` — o limite de concorrência como linha disputada

A tabela que salva o fan-out, e que não existia em plano nenhum.

Contar gerações em voo e comparar com o limite **é racy**: dois workers leem
`n=1 < 2` no mesmo instante, ambos capturam, viram 3 simultâneas e tomam 429. Com
linha de slot, `FOR UPDATE SKIP LOCKED` sobre a própria linha **é** a contagem.

Concorrência **adaptativa**: conta nova na fal tem 2 slots e sobe até 40 conforme
o histórico de faturas. Isso não é conhecível a priori — um 429
`concurrent_requests_limit` reduz `max_aprendido` em 1, N sucessos seguidos
tentam +1.

### `tarefa` — outbox com ordenação EDF, não FIFO

Escrita na mesma transação do fato. `estado` não guarda "processando": em voo é
`lease_ate > now()`.

**A ordenação é por prazo de expiração**, não por chegada. Com BFL na rota, a URL
da imagem vive **10 minutos**. Num desenho FIFO um worker atrasado onze minutos
perde uma imagem **já paga** — e ninguém vê erro nenhum, porque nada falhou: o
link só morreu.

**Lease por tipo — 30 s despachar, 30 s sondar, 120 s ingerir.** Isto **revoga por
escrito** a regra do Herz de que "nenhum job passa de 60 s" (`guias/banco.md:189`).
A premissa é verdadeira lá e falsa aqui: geração passa de 60 s rotineiramente. Com
lease de 60 s, um segundo consumidor assume um job em voo e **dispara a mesma
chamada paga**.

### `geracao` — nove estados, e três que não podem virar "erro"

`falhou` (não cobrou) · `moderada` (terminal, nunca retry) ·
**`duvida_de_cobranca`** (o POST deu timeout e ninguém sabe se o provedor cobrou).

`preco_snapshot` é gravado **por valor**, não por referência. Se apontasse só para
`preco_id`, uma atualização do índice reescreveria o passado e o histórico de
gastos passaria a mentir retroativamente — sem erro, sem log, sem nada vermelho.

### `lancamento` — o ledger append-only

Sem UPDATE, sem DELETE, revogado no GRANT. _"O contador diz quanto, nunca de
quem"_ (`guias/banco.md:113-136`). A reconciliação
`orcamento.gasto_nano == SUM(lancamento)` devolve **zero linhas sempre**, e é
**assertiva de teste**, não painel — vira portão, não relatório que alguém pode
não olhar.

`origem` tem três valores porque os provedores divergem de forma incontornável:
`exato` (Runware devolve `cost` na resposta) · `derivado` (WaveSpeed tem preço
pré-voo; OpenAI/Google devolvem tokens) · `estimado` (**a Replicate não tem API de
billing — ali o ledger é estimativa para sempre**).

### `credencial_provedor` — write-only

Não existe rota de revelar chave, nem mascarada com botão "mostrar". A UI mostra
`ultimos4` e `verificada_em`. Uma rota de leitura é exatamente o que um bug de
autorização transforma em vazamento em massa.

A **AAD é recalculada, nunca armazenada** (`v1|id|usuario_id|provedor|tipo`). Se
estivesse gravada, quem tivesse escrita no banco moveria a linha da chave do
usuário A para a conta do B mantendo a AAD antiga, e a tag do GCM continuaria
válida.

---

## 6. O fan-out — do clique ao primeiro byte

**1 · `POST /lotes`** chega com `command_id` (UUID v7 gerado **pelo cliente**).
Uma transação: `INSERT` em `comando_processado` (violou a PK? já aconteceu,
devolve o guardado) → resolve preço por **função pura** → **reserva** em ordem
fixa → insere lote, N gerações, N lançamentos de reserva, N tarefas → COMMIT →
NOTIFY.

> **Zero chamada HTTP dentro da transação.** É a regra mais importante herdada do
> Herz, e aqui ela vale dinheiro: transação abre → chama a fal → deadlock →
> transação reinicia → **chama a fal de novo**. Duas imagens, duas cobranças.
> Efeito externo não tem rollback. O `dependency-cruiser` proíbe `dominio/` e
> `app/` de importarem cliente HTTP — é porta, não parágrafo.

**2 · Captura:** slot primeiro, tarefa depois, ambos com `FOR UPDATE SKIP LOCKED`.
Sem slot, sem trabalho.

**3 · Três tipos de tarefa:** `despachar` abre o cofre e faz o POST; `sondar`
reagenda a si mesma com backoff 2→5→10→20 s (nunca abaixo de 2 s, recomendação
explícita da WaveSpeed); `ingerir` (**prioridade 0**) baixa em stream, calcula o
SHA-256 no caminho, sobe para o storage, gera 3 variantes + thumbhash, **liquida o
ledger**. Provedor síncrono pula a sonda — mesmo caminho de código.

> **Nada é "pronto" antes de estar no storage do Prumo.**

**4 · Retry — a tabela onde errar custa dinheiro:**

| Situação                                                       | Decisão                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 5xx, DNS, connect, TLS, timeout **antes** de a requisição sair | Retry, backoff `min(2^n s, 1 h)`, máx. 8                                          |
| 429                                                            | Reagenda por `Retry-After`, **não conta** contra o máximo, reduz `max_aprendido`  |
| 401 / 403                                                      | **Nunca** retry. Três seguidas marcam a credencial inválida                       |
| 402                                                            | `credencial:sem-credito` — cancela o resto do lote **naquele provedor** e estorna |
| Moderação                                                      | Terminal. Chega como HTTP 200 na BFL, `error.code` na OpenAI, FAILED no Segmind   |
| **Timeout de leitura** com `suporta_idempotencia=false`        | **Retry proibido** → `duvida_de_cobranca`                                         |

A última linha é a advertência literal da WaveSpeed virada código: _"a
disconnected response can still correspond to a prediction that was accepted and
billed"_. Chamar isso de "erro" e deixar o usuário clicar de novo é transformar um
bug em cobrança dupla.

**5 · A UI não finge paralelismo.** Conta nova na fal tem 2 slots; WaveSpeed
Bronze tem 2 simultâneas e 5/min; a Replicate cai para 6 rpm com saldo baixo.
Disparar 8 modelos **enfileira 6**, e a tela mostra a posição real na fila.

---

## 7. Os 13 provedores mapeados

Levantado em 24/08/2026 contra a documentação oficial de cada um.

| Provedor          | Auth                              | Modo        | Custo na resposta       | Armadilha que decide arquitetura                                                                                            |
| ----------------- | --------------------------------- | ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **fal.ai**        | `Authorization: Key` (não Bearer) | fila + sync | parcial                 | Corpo HTTP é **plano** — o `{"input":{…}}` dos snippets é assinatura de SDK. Reentrega webhook até 31×                      |
| **Replicate**     | `Bearer`                          | fila        | **não**                 | URL expira em **1 h** e o registro é apagado junto. Sem API de billing: ledger estimado para sempre. CORS bloqueado         |
| **KIE.ai**        | `Bearer`                          | fila        | parcial                 | `resultJson` volta como **string** contendo JSON. Duas gerações de API convivendo                                           |
| **WaveSpeed**     | `Bearer`                          | fila + sync | parcial                 | **Bronze = 2 simultâneas e 5/min** — mata o fan-out numa conta nova. Tem preço pré-voo em USD                               |
| **Runware**       | `Bearer` ou task de auth          | ambos       | **sim** (`includeCost`) | Único com **fan-out nativo** (array heterogêneo numa requisição). Falha **parcial** é o caso normal                         |
| **OpenAI**        | `Bearer`                          | sync        | parcial                 | **Verificação de organização com documento e reconhecimento facial**. Saída sempre base64. CORS bloqueado                   |
| **Google Gemini** | `x-goog-api-key`                  | sync        | parcial                 | **SynthID em toda imagem** — invisível, não removível, não opcional. Base64. 🧪 Imagen desligado em 17/08/2026 (reconferir) |
| **BFL / FLUX**    | `x-key`                           | fila        | **sim**                 | **URL expira em 10 minutos.** É a restrição mais dura do conjunto e o motivo da fila ser EDF                                |
| **Together**      | `Bearer`                          | sync        | não                     | **O CDN devolve 403 para User-Agent em branco** — a imagem já paga se perde                                                 |
| **Novita**        | `Bearer`                          | fila        | não                     | Documentação de imagem encolheu para 2 páginas; rotas clássicas dão 404                                                     |
| **DeepInfra**     | `Bearer`                          | sync        | não                     | **Único com compatibilidade OpenAI real e completa** — vira o adaptador canônico                                            |
| **Fireworks**     | `Bearer`                          | sync        | não                     | **Não usar.** Changelog de 10/06/2026: _"image generation are deprecated"_. A rota ainda responde 401                       |
| **Segmind**       | `x-api-key`                       | ambos       | desconhecido            | Mandar `Authorization` **e** `x-api-key` juntos = 401. Qualquer cliente que injete Bearer global quebra tudo                |

A última linha do Fireworks é o motivo de `provedor.ativo` existir: **health-check
ingênuo diria "provedor OK"** porque a rota responde. O monitor precisa distinguir
"rota viva" de "modelo existe".

**Não existe coluna `base_url` no banco, de propósito.** O destino de toda chamada
de saída é lista fechada em código — o servidor faz requisição autenticada com a
chave do usuário, então qualquer endpoint vindo de dado editável é rota de
exfiltração de credencial.

---

## 8. O cofre de chaves — e o que ele não protege

**Cifra de envelope na aplicação, `node:crypto`, dependência zero.** AES-256-GCM,
DEK de 32 B por credencial, KEK de 32 B em `PRUMO_KEK`. Plugues `env` (padrão),
`gcpkms`, `awskms` — trocar é uma linha de configuração mais um rewrap.

### Por que saiu do navegador

O plano v1 previa chave cifrada no dispositivo com frase secreta. **Descartado
tecnicamente, não por preferência:**

- a fal diz por escrito que _"most production applications require a server-side proxy"_;
- a Replicate bloqueia CORS na prática, e OpenAI, Google e BFL também;
- nenhum provedor oferece token efêmero para o navegador;
- e o decisivo: **fan-out com fila, retry e webhook exige um worker que trabalha
  depois que a aba fechou.** Zero-knowledge e trabalho em segundo plano não
  coexistem. Oferecer os dois seria vender teatro.

O modo `frase` fica como valor já aceito em `kek_provedor`, para o dia em que
existir uma modalidade "gerar com a aba aberta".

### A consequência desconfortável, que vai na tela

**Quem hospeda — inclusive você, na instância oficial — consegue ler a chave paga
de qualquer usuário.** É um cofre de confiança no operador, não de sigilo. Isso
fica escrito na **tela de cadastro de chave**, não só no README.

A cifra em repouso protege contra o que é provável num projeto pessoal: dump de
banco, backup vazado, réplica restaurada, SQL injection. Não protege contra host
comprometido — com RCE, o atacante lê `process.env.PRUMO_KEK`.

### Regras que esta camada impõe ao projeto inteiro

- **`axios` é proibido em qualquer lugar.** O objeto de erro dele carrega
  `config.headers`, e um `console.error(err)` numa branch rara publica a chave do
  usuário no log. Cliente HTTP é `fetch`/undici.
- **Sanitizar erro de provedor antes de gravar** — alguns ecoam parte do header
  recebido na mensagem.
- **Teste de CI faz `grep` no log** de uma execução completa procurando o prefixo
  da chave de teste, e reprova se achar.
- **`npm run backup` recusa incluir o `.env`.** Backup do banco cifrado guardado
  junto da KEK anula o cofre inteiro — e é o cenário mais provável de todos.
- **O ensaio de restauração prova que as chaves decifram depois do restore.**
- **O teto do Prumo não é o teto do provedor.** A UI instrui a criar chave
  **dedicada** ao Prumo com limite de gasto no painel do provedor. 🔴 Não
  verificado quais dos treze oferecem teto por chave.

---

## 9. Frontend e celular

**Cinco arquivos do Herz vão quase literais — 422 linhas medidas:** `index.css`
inteiro (base zinc com extremos afastados: numa grade de imagens, preto puro faz a
foto parecer recortada e branco puro dá efeito de faróis), `lib/relogio.ts` (um
`setInterval` compartilhado que pausa com a aba escondida — fan-out de 8 modelos
são 8 contadores ao vivo, e a forma ingênua são 8 timers), `estados.tsx` (os três
estados obrigatórios, com a distinção vazio-por-ausência × vazio-por-filtro),
`faixa-de-aviso.tsx` (a barra de "você usou 82% do teto") e `busca.ts`.

**É no celular que a gente mais se afasta do Herz — e ele mesmo registra o porquê.**
A casca dele é desktop-first com a navegação virando tira de `overflow-x-auto` no
celular, e não há um único `useMediaQuery` em todo o `src`.

- **Barra inferior** de 4 alvos abaixo de `md`, com `env(safe-area-inset-bottom)`.
- **Drawer do Base UI** para parâmetros e detalhe — 226 linhas com swipe, snap
  points e o hack de iOS. É a **única peça genuinamente mobile-first do Herz, e ele
  não a usa.**
- **Grade** com `aspect-ratio` reservado a partir de largura/altura da linha e
  `thumbhash` (28 bytes) como placeholder. Sem isso a galeria pula quando as
  miniaturas carregam — no celular, a diferença entre usável e insuportável.
- **Keyset**, nunca OFFSET: a galeria cresce pelo topo.
- **Lightbox como estado de URL** com `resetScroll:false` — armadilha nº 4 do
  Herz: abrir a imagem 200 e ser jogado ao topo destrói o contexto.
- **Code splitting real**: só `/gerar` no bundle inicial. O Herz tem zero `lazy()`
  e 20 páginas num bundle — aceitável em rede local de fábrica, inaceitável em 4G.
- **Upload com redução no cliente** antes de enviar.

**Tempo real:** uma conexão SSE por aba, multiplexando tudo. Não oito — o
navegador limita ~6 por host em HTTP/1.1, e oito gerações travariam as próprias
requisições da galeria. O evento carrega **só** invalidação escopada e o novo
estado; o contador de tempo roda no cliente. 🧪 SSE atravessando proxy não está
provado — qualquer proxy bufferiza e mata SSE **em silêncio**.

**As três telas que o Herz não tem como ensinar** (não existe uma única `<img>` de
conteúdo em todo o `apps/web/src`): a grade de fan-out, o confirmador de custo
("US$ 0,0013 **exato**" é diferente de "US$ 0,045 **estimado**") e o visor com
comparação lado a lado — que é a razão de existir do fan-out.

**Idioma:** código e API em inglês, interface em pt-BR com as strings num módulo
único. Diverge do invariante 23 do Alicerce, com ADR. **Mas a lição do prefixo
`use` fica:** `usarComando` fez a regra `rules-of-hooks` do oxlint nunca pegar nada
em 24 arquivos do Herz, porque ela identifica hook pelo prefixo. Nome que a
ferramenta não reconhece **desliga a ferramenta em silêncio**.

---

## 10. Preço é fórmula, não float

DeepInfra cobra `$0.009 × (w/1024) × (h/1024) × (iters/25)`. Together cobra
FLUX1.1[pro] por **megapixel** e schnell por **imagem**. BFL cobra o primeiro
megapixel e soma os seguintes. Um catálogo de "USD por imagem" calcula errado em
pelo menos cinco provedores — e o roteador escolhe a rota errada com confiança.

A tabela `preco` é **append-only** (a linha nunca é editada, só encerrada com
`vigente_ate`), guarda uma **união discriminada com parâmetros numéricos** — nunca
expressão interpretada, nunca `eval` — e carrega `fonte`, `coletado_em` e `metodo`
como colunas obrigatórias. Acima de 30 dias, sai do ranking automático.

O comparador ordena por **custo estimado para o pedido atual**, não por preço
nominal.

---

## 11. Marcos

| #      | Marco                                                        | Pronto quando                                                                                                                                                                                                                                                                                                                     | Depende |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **M0** | Fundação e portão                                            | `npm run verificar` nasce **completo** (instruções · formato · tipos · lint · fronteiras · testes · build) em < 2 min; branch protection ligada; gitleaks e Dependabot ativos; escafolding OSS do openkartline. **Prova de aceite: um erro plantado reprova no CI e uma violação de fronteira plantada reprova no depcruise**     | —       |
| **M1** | Esqueleto vertical vazio                                     | `docker compose up -d` em 3 comandos; migração no boot sob advisory lock; **o boot recusa subir nomeando a variável faltante**; contrato ts-rest tipando as duas pontas com validação de resposta ligada; RLS ligada; **teste de isolamento passa — A não alcança nada do B**                                                     | M0      |
| **M2** | Cofre de chaves                                              | Chave colada, cifrada, e verificada por chamada barata ao provedor. Nunca volta na resposta. **Grep no log reprova se achar o prefixo da chave.** Rewrap escrito e testado antes de precisar                                                                                                                                      | M1      |
| **M3** | **ESTÚDIO — uma imagem, um modelo, com o dinheiro fechando** | Prompt → custo na tela → clique → imagem, com o custo real descontado do teto e no extrato. Atravessa contrato → domínio → transação → reserva → tarefa → adaptador → ingestão → liquidação → SSE → tela. **Inclui o caminho em que o provedor falha depois de cobrar.** Prova: dois lotes disputando o último centavo — um vence | M2      |
| **M4** | **FAN-OUT**                                                  | N rotas numa transação; slots limitando e aprendendo com 429; fila EDF; cancelar uma não cancela as outras; `duvida_de_cobranca` com tela; 3 provedores cobrindo os três modos de custo (fal, Replicate, Runware). Provas: dois workers no mesmo slot, dois na mesma tarefa, webhook duplicado                                    | M3      |
| **M5** | Galeria e celular                                            | Grade com aspect-ratio reservado, keyset, lightbox na URL, barra inferior, Drawer, code splitting. **Prova: sessão real num celular em 4G gerando em 4 modelos, e SSE de 10 min atravessando o proxy de verdade**                                                                                                                 | M4      |
| **M6** | Índice vivo de preço                                         | 13 provedores com fórmula, fonte, data e método; coleta automática; preço velho sai do ranking; comparador ordena por custo do pedido atual                                                                                                                                                                                       | M5      |
| **M7** | img2img, inpaint, upscale                                    | Upload validado por magic bytes, editor de máscara com desfazer, **aviso visível de que a imagem sai do servidor para um terceiro antes do clique**, `suporta_mascara` respeitado                                                                                                                                                 | M6      |
| **M8** | Curadoria                                                    | Preset salva **rotas**, coleção pública, voto pareado dentro do lote alimentando "qual modelo ganha neste tipo de prompt" cruzado com preço                                                                                                                                                                                       | M6      |
| **M9** | Público                                                      | OAuth ligado, R2 no lugar do disco, **restauração ensaiada provando que as chaves decifram**, rollback ensaiado, alerta com destinatário nomeado. **Nenhum usuário externo antes disto**                                                                                                                                          | M5      |

M3 é a fatia vertical que define se o esqueleto presta — é onde se descobre,
custando horas, o que sairia caro descobrir depois.

---

## 12. O que vem do Alicerce e do OpenKartLine

**Do Alicerce (vendorizado, repo público não depende de repo privado):**
`verificar` · `fronteiras` · `segredo` · `elos` · `portao` · `hooks` ·
`ci/verificar.yml` · a camada `.ai/`. Mais três regras de fronteira que o Herz não
tem: `provedores/` não importa `db/` nem `dominio/`; `dominio/` e `app/` não
importam cliente HTTP, S3 nem `fs` (é o que **impõe** "nada de I/O externo dentro
da transação"); e a lista de `node_modules` proibida em `dominio/` é **denylist
total com exceção nomeada** — a do Herz é allowlist por nome e deixa passar `zod`,
`axios` ou o SDK do fal.

> A regra `dominio-puro` do Herz foi decorativa desde o nascimento e passou meses
> dando "✔ no dependency violations found" **com React dentro do domínio**
> (`Achados no Herz.md:30-38`). Porta que nunca disparou pode estar quebrada — por
> isso toda regra nasce com uma violação plantada que prova que ela reprova.

**Do Herz, a melhor ideia do repositório e agnóstica de stack:** `.ai/politica.md`
como fonte única gerando `CLAUDE.md`/`AGENTS.md`/`.cursor`, mais um **teste que
deriva fatos do código e exige que a documentação os contenha**. _"Guia que
descreve o código errado é pior que guia inexistente: a IA segue a descrição e
escreve contra a realidade, com confiança."_

**Do OpenKartLine:** Apache-2.0 no código + CC BY 4.0 no catálogo ·
`CODE_OF_CONDUCT` · `GOVERNANCE` · `SECURITY` · `SUPPORT` · `THIRD_PARTY` ·
`CITATION.cff` · `CODEOWNERS` · templates de issue e PR (mais dois do domínio:
correção de preço e novo provedor) · dependabot · CodeQL · release-drafter ·
lychee · README EN + pt-BR.

> **Cláusula obrigatória de repositório público:** workflow disparado por fork não
> recebe segredo. PR de estranho com acesso a segredo é exfiltração em um commit.

---

## 13. Riscos

| Risco                                                                                | O que fazemos                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Processo único é ponto único de falha** — deploy derruba HTTP, worker e SSE juntos | Modo drain (para de capturar, espera 30 s, encerra) e deploy fora de horário. Mitigação real seria redundância, que é a arquitetura recusada                                                             |
| **Host comprometido = todas as chaves de todos**                                     | Envelope torna migração para KMS uma configuração. E vai escrito na tela                                                                                                                                 |
| **Perder a `PRUMO_KEK` é perda irreversível**                                        | Cópia offline obrigatória, em lugar **diferente** do backup do banco                                                                                                                                     |
| **O ledger mente por construção em parte dos provedores**                            | Origem visível em toda linha. Vender estimativa como fato derruba a confiança na plataforma inteira                                                                                                      |
| **A promessa de fan-out simultâneo pode ser mentira visível**                        | Slots reais, posição na fila na tela. Fingir aqui quebra a promessa central no primeiro uso                                                                                                              |
| **Catálogo é manutenção manual permanente disfarçada de tabela**                     | Quando apodrecer, o produto continua funcionando enquanto **mente** — pior modo de falha que existe. Daí `coletado_em` e a saída automática do ranking                                                   |
| **Provedor some sem aviso** — aconteceu 2× na janela desta pesquisa                  | Monitor distingue "rota viva" de "modelo existe". `ativo=false` desliga sem deploy                                                                                                                       |
| **Onboarding é brutal e a arquitetura não ameniza**                                  | Conta em N provedores, cartão em cada um, e na OpenAI verificação com documento e reconhecimento facial                                                                                                  |
| **Autenticação própria é passivo**                                                   | `PRUMO_MODO=pessoal` fecha o registro; testes de auth obrigatórios no `verificar`; OAuth é plugue                                                                                                        |
| 🧪 **Esta arquitetura é decidida, não medida**                                       | O Herz, de onde ela herda o raciocínio, **não tem backend**. Tudo que descreve comportamento sob concorrência, latência ou volume é 🧪. **Tratar 🧪 como ✅ é o erro que a marcação existe para evitar** |

---

## 14. 🔴 Bloqueios — perguntas que travam código

No formato do `bloqueios.md` do Herz. Registrar a dúvida custa uma frase;
descobrir que o modelo de custo está errado depois de três telas custa a reescrita
delas.

1. **Como se contabiliza um job que falhou depois de o provedor cobrar?** Enquanto
   não decidido, ninguém escreve tela de gasto.
2. **A galeria guarda bytes para sempre ou expira?** Retenção decidida depois da
   primeira gravação vira migração de dado grande — e é a política de custo.
3. **Volume esperado, em ordem de grandeza.** Se forem três imagens por dia de uma
   pessoa só — o cenário mais provável nos primeiros seis meses — slots, EDF e
   backpressure são resposta para um problema que não existe.
4. **Preços de infraestrutura** (~R$ 30/mês parado) são ordem de grandeza, não
   fato conferido. Reconferir antes de entrar no README.

---

> Nada aqui substitui revisão humana. Preço, licença de modelo, política de uso e
> qualquer número deste documento gerados com apoio de IA precisam ser conferidos
> por uma pessoa antes de virarem fato exibido na tela.
