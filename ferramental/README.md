# Ferramental

> **Vendorizado.** Este diretório é uma cópia do repositório privado
> `Navesz/alicerce`, mantida com os nomes originais em português para poder ser
> ressincronizada com a origem. Ver `adr/0002-vendor-alicerce-tooling.md`.
> As referências ao `manual/` abaixo vivem lá, não aqui.

A fase 1 deixa de ser prosa e vira arquivos que se copiam.

Tudo aqui é **Node puro, zero dependência**, de propósito: o que confere o build
não pode depender do build. Roda com Node ≥ 18 em repositório recém-criado,
antes de existir toolchain.

| Peça | O que faz | Impõe |
|---|---|---|
| `verificar/` | O comando único que decide se a tarefa terminou | invariante 13 |
| `fronteiras/` | Presets de camada, com prova de que cada regra fecha | invariantes 11, 12 |
| `segredo/` | Varredura de credencial no que o Git rastreia | invariante 18 |
| `elos/` | Link relativo quebrado em Markdown | — |
| `portao/` | Prova que a verificação reprova o que deve | o portão da fase 1 |
| `hooks/` | O que precisa ser barrado antes de existir | — |
| `../ci/` | Modelo de GitHub Actions | invariante 13 |

---

## Instalação num projeto novo

Trinta minutos, com o repositório ainda vazio.

**1. Copie o ferramental e o modelo de CI**

```bash
mkdir -p ferramental .github/workflows
cp -R /caminho/para/alicerce/ferramental/* ferramental/
cp /caminho/para/alicerce/ci/verificar.yml .github/workflows/
```

**2. Declare os passos**

```bash
cp ferramental/verificar/verificar.config.exemplo.mjs verificar.config.mjs
```

Abra e apague o que o projeto não tem. Passo declarado e sempre pulado vira
ruído, e ruído ensina a ignorar a saída.

**3. Escolha o preset de fronteira**

```bash
cp ferramental/fronteiras/web-camadas.cjs .dependency-cruiser.cjs   # ou api-camadas.cjs
```

**4. Instale o hook**

```bash
node ferramental/hooks/instalar.mjs
```

**5. Rode**

```bash
node ferramental/verificar/verificar.mjs
```

Num repositório vazio isso passa. É o ponto: a verificação nasce verde e só fica
vermelha por culpa de uma mudança específica.

**6. Feche o portão** — o passo que quase todo mundo pula

Adapte `ferramental/portao/provar-portao.mjs` aos casos do projeto: um por regra
que você quer provar. Depois:

```bash
node ferramental/portao/provar-portao.mjs
```

**7. Ligue a proteção de ramo** apontando para os jobs `verificar` e `portao`.
O arquivo de workflow sozinho não bloqueia nada — verificação que não bloqueia
é sugestão.

---

## Instalação num projeto que já existe

A ordem muda, porque ferramenta de qualidade instalada sobre código existente
entrega mil violações e vira ruído.

1. Instale com **tudo em `severity: 'warn'`** e meça quantas violações existem.
2. Suba para `error` **uma regra por vez**, corrigindo o que ela acusa.
3. Regra que você não vai corrigir agora: registre como dívida, com dono e
   prazo. Não a apague — regra apagada some do radar; regra em dívida é contada.
4. Só ligue o bloqueio de merge quando o `verificar` passar em `main`.

---

## `verificar`

```bash
node ferramental/verificar/verificar.mjs                 # tudo
node ferramental/verificar/verificar.mjs --passo=tipos   # um passo
node ferramental/verificar/verificar.mjs --json          # telemetria
node ferramental/verificar/verificar.mjs --tudo          # não para no grupo 1
```

**Grupo 1** roda inteiro mesmo com falha — ver as três falhas baratas de uma vez
é melhor que descobrir uma por ciclo. **Grupo 2** só roda se o grupo 1 passou:
não faz sentido gastar minutos de teste sobre código que não compila.

A saída é curta de propósito. A diferença entre 300 e 15 mil tokens por ciclo de
correção está na formatação da saída de uma ferramenta:

```
VERIFICAR — REPROVADO  4.2 s

  ✗ tipos        2 erros
      src/dados/pedido.ts:41   Property 'rowVersion' is missing
      src/dados/pedido.ts:52   Type 'string' is not assignable to 'Dinheiro'

  ✓ formato · lint · segredo
  ⊘ não executados: testes · build

  Primeiro: tipos. Divergência de forma, comece pelo primeiro arquivo.
```

`--json` devolve duração por passo — é o gancho da telemetria de custo (M-1).

---

## `fronteiras`

Dois presets: `web-camadas.cjs` (domínio · dados · componentes · features) e
`api-camadas.cjs` (domain · app · http · db).

O que os diferencia de uma configuração qualquer de `dependency-cruiser` é
`provas/`:

```bash
node ferramental/fronteiras/provas/provar.mjs
```

Cada regra tem um caso que ela **deve reprovar** e uma mini-aplicação correta que
ela **deve aprovar**. A segunda asserção é a que quase ninguém escreve, e é a
que importa: regra com falso positivo ensina todo mundo — pessoa e IA — a
desligar verificação.

Ao criar regra nova, crie os dois casos junto. Regra sem prova não é porta.

---

## `segredo`

```bash
node ferramental/segredo/varrer-segredo.mjs            # tudo que o Git rastreia
node ferramental/segredo/varrer-segredo.mjs --staged   # o hook usa esta
```

Detecta chave privada, credencial de nuvem, token de serviço, JWT, string de
conexão com senha e `.env` versionado. Varre o que o Git rastreia — arquivo
ignorado não é risco.

Falso positivo se libera na própria linha, com motivo escrito:

```ts
const exemplo = 'sk-exemplo-para-a-documentacao' // alicerce-segredo-ok: valor fictício do manual
```

Sem motivo, não vale — é a regra de supressão com justificativa (invariante 15).

> Achado real não se corrige com commit novo. Segredo que entrou no histórico
> precisa ser **rotacionado**; reescrever histórico vem depois, não no lugar.

---

## O que ainda não existe aqui

Honestidade sobre o estado: `verificar`, `fronteiras`, `segredo`, `elos`,
`portao`, `hooks` e o modelo de CI estão feitos e testados neste repositório.

Falta, e está no plano do Alicerce: registro de dívida verificado no CI (M6),
camada de contexto `.ai/` e MCP gerado (M7), gerador de base a partir do perfil
(M8) e telemetria de custo (M-1, que consome o `--json` daqui).
