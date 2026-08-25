# Esquema do banco — Prumo

> Decidido em 24/08/2026. **Nenhuma migration escrita ainda** — este documento é a
> fonte da primeira. PostgreSQL 17. Dinheiro em nano-USD inteiro (bigint, 1 = 1e-9 USD).
>
> Toda linha marcada 🧪: decidida, não medida.

21 tabelas.

---

## 01 · `usuario`

**Colunas.** id uuid pk (v7 gerado na app) · email citext not null · senha_hash text null ('scrypt$N=131072,r=8,p=1$salt$hash') · nome text · papel enum('dono','usuario') · ativo bool not null default true · fuso text not null default 'America/Sao_Paulo' · criado_em/atualizado_em timestamptz

**Índices.** unique(email) · unique(provedor_identidade, id_externo) quando OAuth estiver ligado

**Por quê.** O IdP diz QUEM a pessoa é; quem entra e com que teto é cadastro LOCAL — regra de ouro do Herz que transplanta inteira e é o que permite banir alguém sem depender do GitHub. `fuso` não é enfeite: é ele que define a fronteira do mês do teto. QUEBRA QUANDO VIOLADO: o Herz errou um dia nas duas pontas comparando dia local com meia-noite UTC (achado A2) num sistema que mede tempo; aqui o mesmo erro libera teto que não deveria existir na virada do mês. Dois papéis, não oito — a taxonomia de área da BMB pressupõe mono-tenant com transparência total, o oposto exato do Prumo.

---

## 02 · `sessao`

**Colunas.** id uuid pk · usuario_id fk on delete cascade · token_hash bytea not null (SHA-256; o token NUNCA é gravado) · expira_em timestamptz not null · ultimo_uso_em · ip_hash bytea (HMAC do IP, nunca o IP) · ua_hash bytea · criada_em · revogada_em

**Índices.** unique(token_hash) · (usuario_id) where revogada_em is null · (expira_em) para a faxina

**Por quê.** UMA query por request junta sessao + usuario + orcamento: sessão válida, usuário ativo e teto atual saem juntos. O custo do banco já é pago, então JWT entregaria vantagem nenhuma. QUEBRA QUANDO VIOLADO: guardar o token em claro transforma um SELECT em roubo de sessão em massa; e sem sessão individual não existe 'desconectar este dispositivo' nem matar a sessão no instante em que uma chave é revogada.

---

## 03 · `credencial_provedor`

**Colunas.** id uuid pk (gerado na app ANTES de cifrar — entra na AAD) · usuario_id fk · provedor text fk · tipo enum('api_key','oauth_refresh','webhook_secret') · apelido text · kek_provedor enum('env','awskms','gcpkms') · kek_id text ('env:v1') · dek_envelopada bytea · dek_nonce bytea(12) · segredo_cifrado bytea (ciphertext||tag16) · segredo_nonce bytea(12) not null · aad_versao smallint · algoritmo text CHECK (algoritmo='AES-256-GCM') · impressao bytea(32) (HMAC-SHA256(PEPPER, chave em claro)) · ultimos4 text · status enum('ativa','invalida','revogada') · falhas_auth smallint default 0 · verificada_em · ultimo_uso_em · criada_em · revogada_em

**Índices.** unique(usuario_id, provedor, impressao) WHERE status='ativa' · (usuario_id, provedor) where status='ativa' · (kek_id) where status='ativa' — esta última É a fila do rewrap

**Por quê.** O eixo que o painel do Alicerce NÃO tem: ele pressupõe que todo segredo é DO SISTEMA; aqui o segredo é do USUÁRIO e o Prumo é depositário. A AAD nunca é armazenada, é RECALCULADA da linha ('v1|id|usuario_id|provedor|tipo'). QUEBRA QUANDO VIOLADO: se a AAD estivesse gravada, quem tivesse ESCRITA no banco moveria a linha para outro usuario_id mantendo a AAD antiga e a tag do GCM continuaria válida — a chave do usuário A passaria a gerar na conta do B. `algoritmo` é allowlist de UM item e NUNCA despacha o decifrador: é a correção direta do achado real do Leonardo (auth-microservico-spec.md:366, verifySession sem algorithms fixado). WRITE-ONLY: não existe rota de revelar chave, nem mascarada com botão — uma rota de leitura é o que um bug de autorização transforma em vazamento em massa.

---

## 04 · `provedor`

**Colunas.** slug text pk ('fal','replicate','openai','google','bfl','runware','wavespeed','kie','deepinfra','together','novita','segmind') · nome · ativo bool · auth_estilo enum('bearer','key','x-api-key','x-goog-api-key','x-key') · modo enum('sync','fila','ambos') · concorrencia_padrao smallint · rpm_padrao smallint null · ttl_saida_seg int · assina_gancho enum('ed25519_jwks','hmac_standard','segredo_url','nenhuma') · suporta_cancelar bool · custo_na_resposta enum('exato','unidades','nenhum') · doc_url · aviso text · verificado_em

**Índices.** pk basta · (ativo)

**Por quê.** NÃO existe coluna de base_url, de propósito. O destino de toda chamada de saída é lista FECHADA em código. QUEBRA QUANDO VIOLADO: é o buraco nº2 do painel do Alicerce e o mais perigoso do Prumo — o servidor faz requisição autenticada com a chave do usuário, então qualquer endpoint vindo de dado editável é rota de exfiltração de credencial. `auth_estilo` é enum de cinco porque a fal usa literalmente 'Key ' e não 'Bearer'. `ativo=false` desliga um provedor inteiro sem deploy — e isso é necessário: a Fireworks declarou imagem deprecada em 2026-06-10 e a rota HTTP AINDA responde 401, então health-check ingênuo diria 'provedor OK'. `aviso` é o que a UI mostra ('Google marca toda imagem com SynthID, invisível e não removível').

---

## 05 · `modelo`

**Colunas.** id text pk ('fal:fal-ai/flux-lora/inpainting', 'runware:bfl:6@1') · provedor_slug fk · endpoint_id text (o path/id nativo) · versao_pin text null (hash da Replicate) · nome_exibicao · familia · tarefas text[] ('t2i','i2i','inpaint','upscale','edit') · schema_entrada jsonb · schema_hash text · max_ref_imagens smallint · suporta_seed bool · suporta_mascara bool · marca_dagua enum('synthid','nenhuma','desconhecida') · exige_conta_verificada bool · suporta_idempotencia bool · ttl_saida_seg int · resolucoes jsonb · ativo bool · descontinuado_em

**Índices.** unique(provedor_slug, endpoint_id, coalesce(versao_pin,'')) · (ativo, familia) · GIN(tarefas)

**Por quê.** SUB-ENDPOINT É MODELO DIFERENTE, não flag: /inpainting e /image-to-image da fal têm SCHEMA distinto do endpoint base. Não existe id derivável por regra — é path na WaveSpeed, string sem padrão na KIE ('nano-banana-pro' e 'qwen/image-to-image' no mesmo catálogo), AIR versionado na Runware, owner/name+hash na Replicate. É tabela mantida à mão, versionada como JSON de seed. DUAS COLUNAS DECIDEM ARQUITETURA E NÃO SÃO METADADO: `suporta_idempotencia` governa se retry automático é PERMITIDO — o UNIQUE local prova que a MINHA transação não commitou, não prova que a fal não debitou; e `ttl_saida_seg` é o relógio da ingestão. Três colunas existem para a UI ser honesta e não podem ser simuladas: suporta_mascara (o Google não tem inpaint com máscara), marca_dagua e exige_conta_verificada.

---

## 06 · `preco`

**Colunas.** id bigserial pk · modelo_id fk · vigente_de timestamptz not null · vigente_ate timestamptz null · base enum('por_imagem','por_megapixel','por_passo','por_segundo','por_token_saida','formula') · formula jsonb (união DISCRIMINADA com parâmetros numéricos — nunca expressão interpretada) · valor_nano_usd bigint · moeda char(3) CHECK='USD' · fonte text (URL) not null · coletado_em timestamptz not null · metodo enum('doc','medido','estimado') not null

**Índices.** unique(modelo_id, vigente_de) · (modelo_id) where vigente_ate is null · (coletado_em) para o painel de frescor

**Por quê.** Append-only: a linha nunca é editada, só encerrada com vigente_ate. PREÇO É FÓRMULA, NÃO FLOAT — DeepInfra cobra '$0.009 × (w/1024) × (h/1024) × (iters/25)', Together cobra FLUX1.1[pro] por MEGAPIXEL e schnell por imagem, BFL cobra o primeiro MP e soma os seguintes. QUEBRA QUANDO VIOLADO: um catálogo de 'USD por imagem' calcula errado em pelo menos cinco provedores, e o roteador escolhe a rota errada — o produto nº3 passa a mentir com confiança. fonte+coletado_em+metodo é a Regra de Ouro do Alicerce virada coluna: preço sem fonte é NÃO VERIFICADO e não pode ser oferecido como 'a rota mais barata'; acima de 30 dias sai do ranking automático e a tela mostra o carimbo. NADA de eval: a fórmula é um tipo fechado avaliado por função pura em dominio/.

---

## 07 · `orcamento`

**Colunas.** id uuid pk · usuario_id fk · janela enum('mes','sessao') · janela_inicio timestamptz not null (calculada NO FUSO DO USUÁRIO por relógio injetável) · janela_fim · teto_nano bigint not null CHECK >=0 · reservado_nano bigint not null default 0 CHECK >=0 · gasto_nano bigint not null default 0 CHECK >=0 · estourou_em timestamptz null · alerta_pct smallint default 80 · atualizado_em

**Índices.** unique(usuario_id, janela, janela_inicio) · (janela_inicio) where estourou_em is not null

**Por quê.** O estoque do Herz com outro nome (banco.md:78-101). O invariante vive no WHERE da reserva, NÃO num CHECK composto — e este é o enxerto da proposta A que corrige B e C: `CHECK (gasto + reservado <= teto)` QUEBRA na liquidação, porque o custo apurado pode superar a reserva e o dinheiro JÁ FOI GASTO no provedor; recusar a escrita ali produz um ledger que mente sobre a fatura real. O estouro carimba `estourou_em` e vira faixa de aviso. ORDEM FIXA DE ESCRITA — sempre 'mes' e depois 'sessao'. QUEBRA QUANDO VIOLADO: duas transações tocando as mesmas duas linhas em ordens diferentes é a receita de deadlock previsível. Unidade: NANO-USD inteiro (1 = 1e-9 USD), enxerto de B com ajuste — centavo inteiro trunca o produto (imagem a US$ 0,0005 existe), string decimal do Herz não soma em SQL, e a própria fal já expõe cost_estimate_nano_usd; bigint cobre ~9 bilhões de dólares.

---

## 08 · `lote`

**Colunas.** id uuid pk (v7) · usuario_id fk · command_id uuid not null · prompt text · prompt_negativo text · tarefa enum('t2i','i2i','inpaint','upscale','edit') · parametros jsonb (GenSpec canônico) · entrada_imagem_id fk null · mascara_imagem_id fk null · politica_teto enum('tudo_ou_nada','ate_onde_couber') default 'tudo_ou_nada' · custo_estimado_nano bigint · estado enum('em_andamento','concluido','cancelado') · criado_em · concluido_em

**Índices.** unique(usuario_id, command_id) · (usuario_id, criado_em desc, id desc) — keyset, nunca OFFSET

**Por quê.** O fan-out. `politica_teto` é enxerto da A e é decisão de PRODUTO, não técnica: com 'tudo_ou_nada' o 422 devolve `disponivel_nano` e a tela oferece 'gerar só as N mais baratas'; com 'ate_onde_couber' o servidor tenta a reserva rota a rota em ordem crescente de custo e para no primeiro zero-linhas. QUEBRA QUANDO VIOLADO: sem a escolha explícita, o sistema ou recusa tudo quando faltava um centavo, ou aceita cinco de oito e surpreende o usuário. As duas políticas continuam race-free porque cada reserva é um UPDATE condicional atômico.

---

## 09 · `geracao`

**Colunas.** id uuid pk (v7) · lote_id fk · usuario_id fk (DESNORMALIZADO — eixo de todo índice e da RLS) · provedor_slug text (DESNORMALIZADO — eixo do slot) · modelo_id fk · credencial_id fk · estado enum('na_fila','despachando','gerando','ingerindo','pronto','falhou','moderada','cancelado','duvida_de_cobranca') · versao int default 0 · params_efetivos jsonb · seed text · provider_job_id text · poll_url text (guardado INTEIRO) · cancel_url text · gancho_segredo bytea · preco_id fk · preco_snapshot jsonb not null · custo_estimado_nano bigint not null · reserva_nano bigint not null · custo_real_nano bigint null · custo_origem enum('exato','derivado','estimado') null · progresso smallint null · posicao_fila int null · erro_tipo text · erro_detalhe jsonb (SANITIZADO) · expira_saida_em timestamptz · criada_em · despachada_em · concluida_em

**Índices.** (usuario_id, criada_em desc, id desc) · (lote_id) · PARCIAL (provedor_slug, usuario_id) WHERE estado IN ('despachando','gerando','ingerindo') — o índice EM VOO, pequeno e quente · unique(provedor_slug, provider_job_id) WHERE provider_job_id IS NOT NULL · PARCIAL (expira_saida_em) WHERE estado='ingerindo'

**Por quê.** Nove estados, e três deles não existem em produto que colapsa tudo em 'erro': `falhou` (não cobrou), `moderada` (terminal, nunca retry — a BFL entrega isso como HTTP 200 com status 'Content Moderated' e a OpenAI como moderation_blocked) e `duvida_de_cobranca` (o POST deu timeout e ninguém sabe se o provedor cobrou). `preco_snapshot` é gravado POR VALOR. QUEBRA QUANDO VIOLADO: se apontasse só para preco_id, uma atualização do índice REESCREVERIA o passado e o histórico de gastos passaria a mentir retroativamente — sem erro, sem log, sem nada vermelho. `poll_url` inteiro porque a BFL diz por escrito que a URL de polling não pode ser reconstruída. O unique em (provedor, provider_job_id) é o que faz a fal reentregar webhook 31 vezes sem consequência.

---

## 10 · `tarefa`

**Colunas.** id bigserial pk · tipo enum('despachar','sondar','ingerir','cancelar_no_provedor','liquidar','reconciliar','coletar_preco','expurgar','rewrap') · geracao_id uuid null · usuario_id uuid null · provedor_slug text null · slot_id bigint null · chave_dedup text null · prioridade smallint default 5 (0 = máxima) · prazo_em timestamptz null · disponivel_em timestamptz default now() · lease_seg int default 30 · lease_ate timestamptz · lease_por text · tentativas smallint default 0 · max_tentativas smallint default 8 · ultimo_erro text · morta_em timestamptz · concluida_em timestamptz · payload jsonb · criada_em

**Índices.** PARCIAL (prioridade, coalesce(prazo_em,'infinity'), disponivel_em) WHERE concluida_em IS NULL AND morta_em IS NULL — SEM payload no INCLUDE · unique(chave_dedup) WHERE chave_dedup IS NOT NULL AND concluida_em IS NULL · (morta_em) where morta_em is not null

**Por quê.** Outbox escrita na MESMA transação do fato; at-least-once; todo consumidor idempotente pela chave_dedup. `estado` NÃO guarda 'processando' — em voo é lease_ate > now(). QUEBRA QUANDO VIOLADO: duas fontes de verdade produzem registro órfão quando o processo morre. A ORDENAÇÃO É EDF, NÃO FIFO — `prazo_em` (derivado de expira_saida_em) vem antes de disponivel_em, e isso é enxerto de B: com BFL na rota, um worker atrasado 11 minutos perde uma imagem JÁ PAGA, e ninguém vê erro nenhum porque nada falhou, só o link morreu. `ingerir` entra com prioridade 0. Backoff: disponivel_em = now() + min(2^tentativas s, 1 h). Fila morta VISÍVEL em painel — mensagem morta em tabela que ninguém consulta é mensagem perdida.

---

## 11 · `slot_provedor`

**Colunas.** id bigserial pk · usuario_id uuid · provedor_slug text · indice smallint · tarefa_id bigint null · ocupado_ate timestamptz null · max_aprendido smallint · aprendido_em · falhas_429 smallint · sucessos_seguidos smallint

**Índices.** unique(usuario_id, provedor_slug, indice) · PARCIAL (usuario_id, provedor_slug) WHERE tarefa_id IS NULL

**Por quê.** ENXERTO DE B, e é a tabela que salva o fan-out. O SLOT É A LINHA DISPUTADA. QUEBRA QUANDO VIOLADO: a versão ingênua — contar gerações em voo e comparar com o limite — É RACY; dois workers leem n=1 < 2 no mesmo instante, ambos capturam, viram 3 simultâneas e tomam 429 da fal. Com linha de slot, o FOR UPDATE SKIP LOCKED sobre a própria linha É o lock e a corrida some. CONCORRÊNCIA ADAPTATIVA: a fal começa com 2 slots e sobe até 40 conforme o histórico de faturas — isso não é conhecível a priori, então um 429 concurrent_requests_limit reduz max_aprendido em 1 e N sucessos seguidos tentam +1. Slots são criados preguiçosamente no primeiro uso.

---

## 12 · `lancamento (ledger)`

**Colunas.** id bigserial pk · usuario_id fk · geracao_id uuid null · lote_id uuid null · command_id uuid null · orcamento_mes_id uuid · tipo enum('reserva','liquidacao','estorno','ajuste') · valor_nano bigint COM SINAL · moeda char(3) · origem enum('exato','derivado','estimado') not null · estado enum('firme','duvida') not null default 'firme' · provedor_slug · modelo_id · preco_aplicado jsonb not null (SNAPSHOT por valor) · provedor_ref text null · criado_em · conciliado_em null

**Índices.** (usuario_id, criado_em desc, id desc) — keyset do extrato · (geracao_id) · unique(geracao_id, tipo) — torna o insert idempotente · PARCIAL (estado) WHERE estado='duvida' — a fila de conciliação

**Por quê.** APPEND-ONLY: sem UPDATE, sem DELETE, revogado no GRANT. 'O contador diz QUANTO, nunca DE QUEM' (banco.md:113-136) — guardar só o contador é o erro clássico de plataforma de crédito: você sabe que sobrou X e nunca sabe por quê. A reconciliação `orcamento.gasto_nano == SUM(lancamento)` deve devolver ZERO LINHAS SEMPRE e é ASSERTIVA DO TESTE DE CONCORRÊNCIA, não painel — 'vira portão, não relatório que alguém pode não olhar'. `origem` tem três valores porque os provedores divergem de forma incontornável: Runware devolve cost exato na resposta (com includeCost:true, que NÃO é o padrão), fal reconcilia depois por request_id em /v1/models/billing-events, e a Replicate NÃO TEM API de billing — lá o ledger é ESTIMATIVA para sempre. QUEBRA QUANDO VIOLADO: vender estimativa como fato é a forma mais rápida de o usuário perder a confiança na plataforma inteira. unique(geracao_id, tipo) é o que faz o worker at-least-once não cobrar duas vezes.

---

## 13 · `blob`

**Colunas.** usuario_id uuid + sha256 bytea → PK COMPOSTA · bytes bigint · mime text (validado por MAGIC BYTES, não por extensão) · largura int · altura int · caminho text · variantes jsonb ({mini:{caminho,bytes},medio:{caminho,bytes}}) · thumbhash bytea (~28 B) · refs int default 0 · criado_em · ultimo_acesso_em

**Índices.** pk composta · PARCIAL (usuario_id) WHERE refs = 0 — a fila do coletor de lixo

**Por quê.** Deduplicação ESCOPADA POR USUÁRIO, de propósito. QUEBRA QUANDO VIOLADO: dedup global economizaria mais disco e criaria um canal de inferência entre inquilinos — dá para testar se outra pessoa gerou a mesma imagem. Num sistema que guarda chave paga de terceiro, isso não se troca por disco. O ganho real de dedup vem das imagens de ENTRADA reusadas em cadeias de img2img (a mesma foto enviada a 6 modelos grava um blob), que são por usuário por definição. Apagar decrementa refs; só a última referência remove o objeto.

---

## 14 · `imagem`

**Colunas.** id uuid pk (v7) · usuario_id fk · geracao_id fk null (null = upload) · papel enum('saida','entrada','mascara') · sha256 bytea (FK composta com usuario_id → blob) · indice smallint · largura int · altura int · alt text (derivado do prompt) · nsfw bool null · visibilidade enum('privada','link','publica') default 'privada' · favorita bool default false · criada_em · excluida_em · expurgo_em

**Índices.** PARCIAL (usuario_id, criada_em desc, id desc) WHERE excluida_em IS NULL — keyset da galeria · (geracao_id) · PARCIAL (usuario_id) WHERE favorita · PARCIAL (visibilidade) WHERE visibilidade='publica'

**Por quê.** O Herz decidiu 'guarda a referência, nunca os bytes'; aqui os bytes SÃO o produto e não há uma única `<img>` de conteúdo no frontend dele para copiar. largura/altura na linha porque a grade reserva a caixa por aspect-ratio ANTES de a imagem chegar. QUEBRA QUANDO VIOLADO: sem isso a galeria pula quando as miniaturas carregam, o que num celular com rolagem longa é a diferença entre usável e insuportável. `alt` é o sétimo item de acessibilidade que o Herz não precisava ter. `expurgo_em` nasce na primeira migration: retenção decidida DEPOIS vira migração de dado grande, e é ela que decide se o custo de armazenamento cresce para sempre.

---

## 15 · `comando_processado`

**Colunas.** command_id uuid pk · usuario_id fk · rota text · status smallint · resultado jsonb · criado_em

**Índices.** pk · (criado_em) para o expurgo de 30 dias

**Por quê.** Transforma 'resultado desconhecido' em retry seguro. SÓ GRAVA EM 2xx. QUEBRA QUANDO VIOLADO: o bug B5 do Herz cacheava a RECUSA — 422 gravado no commandId prendia o usuário em erro eterno, sem conseguir reenviar o mesmo prompt e sem entender por quê. Idempotência guarda resultado de operação COMPLETADA.

---

## 16 · `gancho_recebido`

**Colunas.** id bigserial pk · provedor_slug · gancho_id text (o webhook-id do provedor) · geracao_id uuid null · corpo_hash bytea · recebido_em · processado_em

**Índices.** unique(provedor_slug, gancho_id)

**Por quê.** ENXERTO DE B. A fal reentrega até 31 vezes e NÃO segue redirect; a Replicate repete o mesmo webhook-id nas retentativas. QUEBRA QUANDO VIOLADO: sem esta tabela, uma reentrega dispara uma segunda ingestão e uma segunda linha de ledger — cobrança duplicada por um evento que o provedor mandou de propósito.

---

## 17 · `evento_credencial`

**Colunas.** id bigserial pk · credencial_id uuid (SEM foreign key — sobrevive à exclusão) · usuario_id · provedor_slug · acao enum('criada','verificada','usada','falhou_auth','rewrap','revogada','excluida') · detalhe jsonb default '{}' · ip_hash bytea · em timestamptz

**Índices.** (usuario_id, em desc) · (credencial_id, em desc) · (acao, em desc)

**Por quê.** Trilha da peça mais sensível. Sem FK de propósito: a trilha tem que sobreviver ao DELETE da credencial, senão auditoria de exclusão não existe. Cada métrica nomeia o defeito que detecta: explosão de `usada` fora do padrão é a assinatura de um cofre sendo esvaziado; três `falhou_auth` seguidas marcam a credencial inválida e param de queimar tentativas. QUEBRA QUANDO VIOLADO: `detalhe` é PROIBIDO conter segredo, e isso é um teste de CI que faz grep, não um parágrafo no README.

---

## 18 · `preset + preset_rota`

**Colunas.** preset: id uuid pk · usuario_id fk · nome · tarefa · parametros jsonb · publico bool · usos int · custo_medio_nano bigint · criado_em/usado_em. preset_rota: preset_id fk + modelo_id fk → PK composta · ordem smallint · n smallint

**Índices.** (usuario_id, usado_em desc) · PARCIAL (usos desc) WHERE publico · (modelo_id) na junção

**Por quê.** Preset é o fan-out salvo: 'este prompt, nestes 6 modelos'. Tabela de junção e não array de uuid porque precisa de FK real. QUEBRA QUANDO VIOLADO: modelo desativado vira id órfão dentro de um array e estoura no despacho, gastando uma reserva por nada. Reordenar preset e favoritar imagem são as ÚNICAS mutações onde atualização otimista é permitida — a fronteira que o Herz desenha (tanstack.md:119-126) é exatamente a certa: nunca mostrar 'gerando' antes do servidor aceitar, porque pode ter estourado o teto ou a chave estar inválida.

---

## 19 · `voto`

**Colunas.** usuario_id + imagem_id → PK composta · lote_id uuid · modelo_id text · valor smallint CHECK IN (-1,1) · criado_em

**Índices.** pk composta · (modelo_id, criado_em) · (lote_id)

**Por quê.** Dentro de um lote, todos os modelos receberam o MESMO prompt — então o voto é comparação pareada legítima, não opinião solta. Cruzado com `preco`, responde a pergunta que o produto existe para responder: qual é a rota mais barata que ainda presta. QUEBRA QUANDO VIOLADO: o `reporEstoque` do Herz contaminou uma média com amostra inválida e fez o sistema prometer que uma bateria em falta chega em zero dias, número que a cotação usava. Geração cancelada, falhada ou de teste NÃO entra no agregado, e existe teste que prova o critério de exclusão.

---

## 20 · `colecao + colecao_item`

**Colunas.** colecao: id uuid pk · usuario_id fk · nome · slug text · publica bool default false · capa_imagem_id · criada_em. colecao_item: colecao_id + imagem_id → PK composta · ordem int

**Índices.** unique(usuario_id, nome) · unique(slug) WHERE publica · (colecao_id, ordem)

**Por quê.** 'Galeria' NÃO é tabela: é consulta sobre imagem+geracao filtrada por dono, com keyset. Coleção é o álbum montado à mão. `publica` é a ÚNICA porta de saída de conteúdo para fora do dono e por isso é a única exceção explícita à RLS, escrita em policy nomeada. QUEBRA QUANDO VIOLADO: sem o teste que prova que o usuário A não alcança nada não-público do B, o isolamento é intenção — e o Herz não tem esse teste porque a regra dele é 'todos veem tudo'.

---

## 21 · `taxa_cambio`

**Colunas.** moeda_origem char(3) + moeda_destino char(3) + coletado_em timestamptz → PK composta · taxa numeric(20,10) · fonte text

**Índices.** pk composta · (moeda_origem, moeda_destino, coletado_em desc)

**Por quê.** Os provedores cobram em USD e o dono raciocina em BRL. A conversão acontece SÓ NA APRESENTAÇÃO, com o carimbo da cotação visível; o ledger inteiro vive em USD. QUEBRA QUANDO VIOLADO: converter na gravação faz a taxa mudar e o histórico passar a mentir — exatamente o mesmo defeito de gravar preço por referência.

---
