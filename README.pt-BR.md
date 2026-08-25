# Prumo

> Geração de imagem open source com as suas próprias chaves de provedor: dispare um prompt
> em vários modelos ao mesmo tempo, veja quanto cada imagem custa antes de gastar e deixe o
> banco recusar as que estourariam o seu teto.

[![CI](https://github.com/Navesz/prumo/actions/workflows/ci.yml/badge.svg)](https://github.com/Navesz/prumo/actions/workflows/ci.yml)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-Apache--2.0-blue)](LICENSE)
[![Estado](https://img.shields.io/badge/estado-alpha%20%C2%B7%20nada%20roda%20ainda-red)](#estado)

[Read in English](README.md) · [Plano](PLANO.md) · [Contribuir](CONTRIBUTING.md) · [Segurança](SECURITY.md)

## O que é

O Prumo é um estúdio auto-hospedável para modelos pagos de imagem. Você cria conta na sua
própria instância, cola as suas chaves de API dos provedores que já paga — fal.ai,
Replicate, KIE.ai, OpenAI, Google, BFL, Runware, WaveSpeed, Together, Novita, DeepInfra,
Segmind — e gera: o mesmo prompt disparado em vários modelos ao mesmo tempo, o custo
estimado de cada rota na tela _antes_ do clique, um teto de gasto que o banco impõe em vez
de a interface sugerir, galeria, extrato e um índice de preço que diz qual provedor roda um
dado modelo mais barato hoje. Não há intermediário cobrando margem: o dinheiro vai direto da
sua chave para o provedor, pelo preço do próprio provedor.

## Estado

**M0/M1 em construção. Nada do produto funciona ainda.**

No momento em que isto foi escrito, este repositório contém um plano de construção, um
esquema de banco, um levantamento de provedores e o ferramental vendorizado. Contém **zero
código de geração**: existe o esqueleto do M1 — contrato tipado, uma migration, conta com
sessão, RLS forçada e teto de gasto imposto pelo banco —, mas nenhum adaptador de provedor,
nenhum adaptador, nenhum endpoint, nenhuma tela. `docker compose up -d` falha, porque não
há o que compor.

Concretamente, contra os marcos do [PLANO.md](PLANO.md):

| Marco | O que entrega                                                        | Estado       |
| ----- | -------------------------------------------------------------------- | ------------ |
| M0    | Portão de verificação, branch protection, varredura de segredo       | em andamento |
| M1    | Esqueleto vertical vazio: compose, migrações, contrato, RLS          | em andamento |
| M2    | Cofre de chaves                                                      | não começou  |
| M3    | Estúdio: uma imagem, um modelo, com o dinheiro fechando              | não começou  |
| M4    | Fan-out, slots, fila EDF, `duvida_de_cobranca`                       | não começou  |
| M5–M9 | Galeria e celular, índice vivo de preço, img2img, curadoria, público | não começou  |

Não aponte uma chave de valor para isto. Não porque exista um buraco conhecido, mas porque
o cofre (M2) não foi escrito, muito menos revisado. Quando houver algo para rodar, esta
seção vai dizer isso com um número de versão.

## Por quê

**O mesmo modelo custa dinheiro diferente em provedores diferentes, e não é diferença de
arredondamento.** Dois provedores, um catálogo em comum, lidos das próprias páginas
públicas de preço em 24/08/2026:

| Modelo, 1024×1024 | DeepInfra                                                            | Together                 | Diferença                                  |
| ----------------- | -------------------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| FLUX.2 [pro]      | US$ 0,015 / imagem                                                   | US$ 0,03 / imagem        | **2,0×**                                   |
| FLUX.2 [dev]      | `$0.01 × (w/1024) × (h/1024) × (passos/28)` → US$ 0,010 em 28 passos | US$ 0,0154 / imagem      | **1,5×**                                   |
| FLUX.1 [schnell]  | `$0.0005 × (w/1024) × (h/1024) × passos` → US$ 0,0020 em 4 passos    | US$ 0,0027 / imagem      | **1,35×**                                  |
| FLUX1.1 [pro]     | US$ 0,04 / imagem                                                    | US$ 0,04 / **megapixel** | igual em 1 MP, **2×** de diferença em 2 MP |

Fontes: `deepinfra.com/pricing`, `together.ai/pricing`, ambas lidas em 24/08/2026, método
`doc` — lido de documentação, nunca chamado com chave real, nunca medido. Podem já estar
velhas enquanto você lê, que é exatamente a razão de toda linha de preço do Prumo carregar
`fonte`, `coletado_em` e `metodo` e sair do ranking sozinha depois de 30 dias.

A última linha é a parte que uma planilha erra. **Preço é fórmula, não float.** A DeepInfra
cobra o FLUX.1[dev] como `$0.009 × (w/1024) × (h/1024) × (iters/25)`; a Together cobra o
FLUX1.1[pro] por megapixel e o schnell por imagem; a BFL cobra o primeiro megapixel e soma
os seguintes. Um catálogo de "USD por imagem" calcula o número errado em pelo menos cinco
dos treze provedores, e aí um roteador escolhe a rota errada com confiança.

**E os agregadores vendem assinatura por uma coisa que, por baixo, é pay-as-you-go.** Uma
mensalidade converte um custo variável que você poderia pagar direto em um custo fixo mais
margem, normalmente denominado em créditos que expiram. Isso é um raciocínio sobre o modelo
de negócio, não uma medição da tabela de preço de nenhum fornecedor específico — não
conferimos nenhuma. O que o Prumo faz em vez disso é mostrar a estimativa da rota que você
está prestes a disparar e recusar o clique quando ele estouraria o teto.

## Como funciona

```text
  prompt + 8 rotas escolhidas
       |
       v
  POST /lotes    command_id é um UUID v7 gerado PELO navegador
       |
       |   UMA transação. Zero chamada HTTP de saída dentro dela.
       +---> comando_processado : INSERT. Violou a PK, já aconteceu; devolve o guardado,
       |                          e nada é cobrado duas vezes
       +---> preço             : função pura sobre a união discriminada gravada em `preco`.
       |                          Nunca expressão interpretada, nunca eval
       +---> RESERVA           : UPDATE condicional em `orcamento`, ordem fixa: mes, depois sessao.
       |                          Zero linhas afetadas = teto estourado = o lote é recusado
       +---> lote + N geracao + N lancamento(reserva) + N tarefa
       |
     COMMIT ---> NOTIFY
       |
       v
  worker : captura uma linha de `slot_provedor`, depois uma de `tarefa`,
           ambas com FOR UPDATE SKIP LOCKED, slot primeiro. Sem slot, sem trabalho.
           A ordenação é EDF — prazo mais curto primeiro — não FIFO.
       |
       +--[ despachar ]--> abre o cofre e faz o POST no provedor com a chave do usuário
       +--[ sondar    ]--> reagenda a si mesma, backoff 2 -> 5 -> 10 -> 20 s, nunca abaixo de 2 s
       +--[ ingerir   ]--> prioridade 0: baixa os bytes em stream, calcula o SHA-256 no caminho,
       |                   sobe para o storage, gera 3 variantes + thumbhash, liquida o ledger
       v
  galeria  <--- SSE, uma conexão por aba, carregando só invalidação escopada e estado
```

Duas coisas nesse desenho sustentam o resto.

**O teto é uma cláusula WHERE, não um `if`.** A reserva é a conferência:

```sql
UPDATE orcamento
   SET reservado_nano = reservado_nano + $custo
 WHERE usuario_id = $u AND janela = $j AND janela_inicio = $i
   AND gasto_nano + reservado_nano + $custo <= teto_nano
RETURNING teto_nano - gasto_nano - reservado_nano AS folga;
```

Zero linhas afetadas significa teto estourado. Como a condição da regra _é_ a condição da
escrita, não existe janela entre conferir e debitar, e oito modelos disparados no mesmo
milissegundo não conseguem, estruturalmente, furar o limite. Dinheiro é inteiro em nano-USD
(`bigint`, 1 = 1e-9 USD) — nunca float, porque existe imagem a US$ 0,0005 e centavo trunca
o produto.

**Nada é "pronto" antes de os bytes estarem no storage do próprio Prumo.** Uma URL de saída
da BFL vive dez minutos; uma URL da Replicate e o registro inteiro vivem uma hora. É por
isso que a fila ordena por prazo: em FIFO, um worker onze minutos atrasado perde uma imagem
que você já pagou — e ninguém vê erro nenhum, porque nada falhou: o link só morreu.

A outra regra que o diagrama impõe em silêncio: **nenhuma chamada HTTP dentro de
transação.** Abre a transação, chama a fal, dá deadlock, a transação reinicia — e chama a
fal de novo. Duas imagens, duas cobranças. Efeito externo não tem rollback. O
`dependency-cruiser` proíbe `dominio/` e `app/` de importarem cliente HTTP — é porta, não
parágrafo de guia.

## As suas chaves

Leia isto antes de colar qualquer coisa.

As suas chaves ficam **cifradas em repouso no servidor**: cifra de envelope AES-256-GCM,
DEK de 32 bytes por credencial, envelopada por uma KEK guardada em `PRUMO_KEK`.
`node:crypto` puro, dependência zero. A AAD é recalculada a partir da linha
(`v1|id|usuario_id|provedor|tipo`) e nunca armazenada, então quem tiver escrita no banco não
consegue mover a linha da sua chave para outra conta mantendo a tag do GCM válida.

**Quem hospeda a instância consegue ler as chaves de todos os usuários dela.** Inclusive o
dono da instância oficial, se um dia existir uma. Este é um cofre cujo modelo de segurança é
confiança no operador, não sigilo em relação ao operador: com a KEK no ambiente do processo,
o operador — ou qualquer um com execução de código naquele host — decifra. A cifra em
repouso protege contra o que é de fato provável num projeto pessoal: dump de banco vazado,
backup perdido, réplica restaurada, SQL injection. Não protege contra host comprometido.
Esta frase também está na tela de cadastro de chave, não só aqui.

O desenho zero-knowledge no navegador foi considerado e descartado por motivo técnico, não
por preferência: a fal diz por escrito que a maioria das aplicações em produção precisa de
um proxy no servidor, a Replicate bloqueia CORS na prática e OpenAI, Google e BFL também,
nenhum provedor oferece token efêmero para o navegador e — o decisivo — fan-out com fila,
retry e webhook exige um worker que continua trabalhando depois que a aba fechou.
Zero-knowledge e trabalho em segundo plano não coexistem. Oferecer os dois seria teatro.

**Portanto: crie uma chave dedicada ao Prumo, com limite de gasto configurado no painel do
próprio provedor, e revogue-a lá quando parar de usar.** O teto do Prumo não é o teto do
provedor; é uma segunda linha, mais mole. 🔴 Quais dos treze provedores realmente oferecem
limite de gasto por chave não foi verificado.

Consequências que amarram o projeto inteiro, listadas aqui porque aparecem no código:
`axios` é proibido em qualquer lugar (o objeto de erro dele carrega `config.headers`, e um
`console.error(err)` numa branch rara publica a chave de um usuário no log); erro de
provedor é sanitizado antes de ser gravado, porque alguns ecoam parte do header recebido; a
CI faz `grep` no log de uma execução completa procurando o prefixo da chave de teste e
reprova se achar; e `npm run backup` recusa incluir o `.env`, porque backup de banco cifrado
guardado junto da KEK não é backup de banco cifrado.

Mais detalhe, e como reportar um buraco: [SECURITY.md](SECURITY.md).

## Provedores suportados

Levantados em 24/08/2026 contra a documentação oficial de cada um, e escritos em
[docs/PROVEDORES.md](docs/PROVEDORES.md) com endpoints, fontes e armadilhas. Levantado não é
implementado: **nenhum adaptador existe ainda**, então todo estado abaixo é planejado.

| Provedor      | Header de auth                    | Modo        | Custo na resposta       | Adaptador       | Armadilha que decide a arquitetura                                                                                         |
| ------------- | --------------------------------- | ----------- | ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| fal.ai        | `Authorization: Key` (não Bearer) | fila + sync | parcial                 | ⬜ planejado    | O corpo HTTP é **plano**; o `{"input":{…}}` dos snippets é assinatura de SDK. Webhook reentregue até 31×                   |
| Replicate     | `Bearer`                          | fila        | não                     | ⬜ planejado    | A URL de saída **e o registro** são apagados em 1 h. Sem API de billing, o ledger é estimativa para sempre. CORS bloqueado |
| KIE.ai        | `Bearer`                          | fila        | parcial                 | ⬜ planejado    | `resultJson` volta como **string contendo JSON**. Duas gerações de API convivendo                                          |
| WaveSpeed     | `Bearer`                          | fila + sync | parcial                 | ⬜ planejado    | **Nível Bronze = 2 simultâneas e 5/min** — mata o fan-out numa conta nova. Tem endpoint de preço pré-voo em USD            |
| Runware       | `Bearer` ou task de auth          | ambos       | **sim** (`includeCost`) | ⬜ planejado    | O único com **fan-out nativo** (array heterogêneo numa requisição). Falha **parcial** é o caso normal                      |
| OpenAI        | `Bearer`                          | sync        | parcial                 | ⬜ planejado    | **Verificação de organização com documento e reconhecimento facial.** Saída sempre base64. CORS bloqueado                  |
| Google Gemini | `x-goog-api-key`                  | sync        | parcial                 | ⬜ planejado    | **SynthID em toda imagem** — invisível, não removível, não opcional. Sem free tier para modelos de imagem                  |
| BFL / FLUX    | `x-key`                           | fila        | **sim**                 | ⬜ planejado    | **A URL de saída expira em 10 minutos.** É a restrição mais dura do conjunto e o motivo de a fila ser EDF                  |
| Together      | `Bearer`                          | sync        | não                     | ⬜ planejado    | **O CDN devolve 403 para User-Agent em branco** — uma imagem já paga se perde                                              |
| Novita        | `Bearer`                          | fila        | não                     | ⬜ planejado    | A documentação de imagem encolheu para 2 páginas; rotas clássicas dão 404                                                  |
| DeepInfra     | `Bearer`                          | sync        | não                     | ⬜ planejado    | **O único com compatibilidade OpenAI real e completa** — vira o adaptador canônico                                         |
| Segmind       | `x-api-key`                       | ambos       | desconhecido            | ⬜ planejado    | Mandar `Authorization` **e** `x-api-key` juntos devolve 401. Qualquer cliente que injete um Bearer global quebra só aqui   |
| Fireworks     | `Bearer`                          | sync        | não                     | ⛔ **excluído** | Descontinuado. Veja abaixo                                                                                                 |

**A Fireworks está mapeada e não vai ganhar adaptador.** A entrada do changelog dela datada
de 10/06/2026 diz, literalmente: `Audio inference and image generation are deprecated.` Sem
data de desligamento, sem guia de migração, sem substituto indicado; as páginas de imagem
dão 404 e a página de preço serverless não tem mais seção de imagem. A armadilha é que **a
rota HTTP ainda responde 401**, então um health-check ingênuo diria "provedor OK" e a falha
só apareceria na hora de gastar. É exatamente por isso que `provedor.ativo` existe e que o
monitor precisa distinguir "rota viva" de "modelo existe". Doze slugs estão planejados como
adaptadores; o décimo terceiro é documentação de um cadáver.

Não existe coluna `base_url` no banco, **de propósito**. Todo destino de saída é lista
fechada em código, porque o servidor faz requisição autenticada com a chave do usuário —
qualquer endpoint vindo de dado editável é rota de exfiltração de credencial.

## Início rápido

**Nada disto funciona hoje.** Não há `compose.yaml`, não há Dockerfile e não há migration na
árvore. O que vem abaixo é o critério de aceite do M1 escrito com antecedência, para o
formato ficar fixo antes de o código existir.

Requisitos: Docker Engine com Compose v2 (`docker compose`, não `docker-compose`). O arquivo
de compose vai subir dois serviços, `prumo` e `postgres:17-alpine`; o Caddy é um perfil
opcional. Para trabalhar no código sem Docker: Node 24 LTS e PostgreSQL 17.

```bash
git clone https://github.com/Navesz/prumo.git
cd prumo
cp .env.exemplo .env

# gera a KEK de 32 bytes que envelopa toda credencial guardada
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# ou: openssl rand -base64 32
# cole o resultado em PRUMO_KEK no .env

docker compose up -d
```

Três comandos para subir, mais a geração da chave. As migrações rodam no boot sob advisory
lock, então dois contêineres subindo ao mesmo tempo não disputam. O boot **recusa subir
nomeando a variável faltante**, em vez de levantar meio configurado. `PRUMO_PAPEL` escolhe o
papel do processo — `api`, `worker` ou `tudo` — e o padrão de contêiner único é `tudo`: um
binário servindo HTTP, worker e SSE.

Dois avisos sobre a `PRUMO_KEK`:

- **Perdê-la é irreversível.** Toda credencial guardada vira texto cifrado indecifrável e
  todo usuário precisa colar as chaves de novo. Mantenha uma cópia offline.
- **Guarde essa cópia em lugar diferente do backup do banco.** O jeito mais provável de
  anular este cofre inteiro é um arquivo de backup contendo as linhas cifradas e a chave que
  as abre.

`PRUMO_MODO=pessoal` fecha o registro, que é a configuração certa para uma instância de um
usuário só.

## Como se compara

Gerar imagem por um produto hospedado é um mercado bem servido, e para boa parte dele
existem respostas melhores que esta. O posicionamento honesto:

| Alternativa                                                                       | Onde ganha do Prumo                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Higgsfield** e outros estúdios por assinatura                                   | Existem e funcionam agora. Interface polida, lista curada de modelos, nada para hospedar, nenhuma conta de provedor, nenhum cartão cadastrado em doze lugares, suporte quando quebra. Se você quer uma imagem hoje à tarde, a resposta é essa e não esta. As tabelas de preço deles não foram conferidas aqui |
| **Os playgrounds dos próprios provedores** (fal, Replicate, Runware, BFL, OpenAI) | São primeira parte. Todo modelo novo no dia do lançamento, cobrança exata vinda de quem de fato te cobra, e nenhum terceiro guardando a sua chave. O Prumo sempre vai atrasar um lançamento pelo tempo que levar para escrever um adaptador                                                                   |
| **OpenRouter**                                                                    | Uma conta, um saldo, uma chave, hospedado e maduro, com uptime de verdade atrás. Você nunca administra doze contas de provedor nem doze faturas. O Prumo pede que você abra conta e ponha cartão em cada provedor que quiser usar                                                                             |

Onde o Prumo pretende ser diferente: o custo estimado de cada rota na tela antes do clique,
com a estimativa rotulada como exata ou derivada em vez de apresentada como fato; um teto que
o banco impõe, de modo que oito gerações simultâneas não conseguem estourá-lo em conjunto;
dinheiro indo direto para o provedor pelo preço do próprio provedor, sem margem no meio; e um
índice de preço que carrega fonte, data e método por linha e se aposenta sozinho quando
envelhece. Mais o código que produziu o número, legível.

Nada disso é verdade hoje. Tudo nesta seção é intenção, e a seção "Estado" lá em cima é a
medição.

## Mapa do repositório

O que existe na árvore hoje:

```text
PLANO.md              O plano de construção, v2. Em português. Fonte de verdade das decisões
docs/ESQUEMA.md       As 21 tabelas, coluna por coluna, com o que quebra quando cada uma é violada
docs/PROVEDORES.md    Os 13 provedores: auth, endpoints, limites, armadilhas, fontes
ferramental/          Portão de verificação, fronteiras de camada, varredura de segredo,
                      checagem de link, hooks. Vendorizado do repositório privado
                      Navesz/alicerce e deliberadamente mantido com os nomes originais em
                      português, para poder ser ressincronizado com a origem
adr/                  Registros de decisão, incluindo dinheiro em nano-USD e interface em pt-BR
.ai/                  Política de agente: uma fonte que gera CLAUDE.md e AGENTS.md
.github/              Workflows, formulários de issue e template de pull request
```

O que os marcos vão acrescentar:

```text
packages/contrato/    ts-rest + Zod. A rota inteira, com validação de resposta ligada
src/dominio/          Regras puras: fórmulas de preço, janelas de orçamento, máquinas de estado. Sem I/O
src/app/              Casos de uso. Uma transação cada, pelo UnitOfWork único
src/http/             Fastify 5, servindo a API e o build do Vite na mesma origem
src/db/               Kysely + pg, migrações, repositórios
src/provedores/       Um adaptador por provedor. O único lugar que fala HTTP para fora
src/armazenamento/    A interface Blobs: driver `disco` por padrão, `s3` opcional
src/cofre/            Cifra de envelope. Só node:crypto
apps/web/             React 19, Vite 8, TanStack Router/Query, Tailwind 4, shadcn sobre Base UI
```

As fronteiras são impostas pelo `dependency-cruiser`, não por convenção: `provedores/` não
pode importar `db/` nem `dominio/`; `dominio/` e `app/` não podem importar cliente HTTP, S3
nem `fs`. Toda regra nasce com uma violação plantada que prova que ela reprova o build —
regra de fronteira que nunca disparou pode simplesmente estar quebrada, e uma delas, no
código de referência, passou meses reportando zero violações com React dentro do domínio.

## Como contribuir

Leia primeiro o [CONTRIBUTING.md](CONTRIBUTING.md), depois o
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Existem dois templates de issue específicos deste
domínio: correção de preço e novo provedor. Uma correção de preço sem `fonte`, `coletado_em`
e `metodo` não pode ser aceita — não é correção, é outro boato.

Regras que vale conhecer antes do primeiro pull request:

- **Idioma.** Código, API, mensagem de commit, issue e documentação em **inglês**. Só
  `PLANO.md`, `docs/ESQUEMA.md`, `docs/PROVEDORES.md`, `README.pt-BR.md` e `.ai/` são em
  português. O `ferramental/` mantém os nomes em português porque é vendorizado.
- **`axios` é proibido** no projeto inteiro. Use `fetch`/undici.
- **Dinheiro é inteiro em nano-USD.** Nunca float, nunca string decimal.
- **O teto de gasto é imposto por UPDATE condicional**, nunca por ler-e-depois-escrever.
- **Nenhuma chamada HTTP dentro de transação de banco.** O verificador de fronteira impõe.
- `npm run verificar` é o comando único que decide se o seu trabalho terminou: instruções,
  formato, tipos, lint, fronteiras, testes, build.
- Workflow disparado por fork não recebe segredo. PR de estranho com acesso a segredo é
  exfiltração em um commit.

Marcação usada em toda a documentação: ✅ provado · 🧪 decidido mas não medido · 🔴 bloqueia
código. Tratar um 🧪 como ✅ é exatamente o erro que a marcação existe para evitar — esta
arquitetura é decidida, não medida, e tudo que descreve comportamento sob concorrência,
latência ou volume é 🧪 enquanto nada roda.

## Licença

O código é [Apache-2.0](LICENSE). O catálogo de preço — o levantamento de provedores e os
dados de semente de preço — é **CC BY 4.0**, então você pode reusar os números desde que
credite de onde vieram. Atribuição de terceiros e regras de proveniência de dado estão em
[THIRD_PARTY.md](THIRD_PARTY.md).

---

> Nada aqui substitui revisão humana. Preço, licença de modelo, política de uso e qualquer
> número deste repositório gerado com apoio de IA precisa ser conferido por uma pessoa antes
> de ser exibido a um usuário como fato.
