import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import {
  formatarPorMil,
  formatarUnitario,
  formatarVezes,
  custoMensal,
  larguraDaBarra,
  nomeDaTarefa,
  quantasVezes,
} from './preco.js'

/**
 * O índice de preços.
 *
 * A tela anterior era uma planilha com CSS: 648 linhas planas, o identificador na
 * terceira coluna, seis casas decimais em toda célula, e a razão de existir do
 * produto invisível. Quatro coisas mudam isso, e três delas não são visuais:
 *
 * 1. **O modelo é a entidade, o provedor é a oferta.** `FLUX.1 [schnell]` no fal
 *    e `black-forest-labs/FLUX-1-schnell` na DeepInfra viram uma linha só, que
 *    diz "a partir de X, em N provedores, o mais caro é 3,2× o mais barato".
 *    Sem isso a pergunta que o produto existe para responder — onde eu rodo ESTE
 *    modelo mais barato — não tem onde ser feita.
 * 2. **A unidade é mil imagens.** Ver `preco.ts`.
 * 3. **A procedência vira link.** A URL da página de preço do provedor já era
 *    coletada, já viajava no contrato, e era jogada fora. Era a única coisa que
 *    fechava o laço de confiança.
 * 4. **A tarefa aparece.** Um modelo de inpaint sentava na mesma lista, no mesmo
 *    preço, que um texto→imagem, e nada avisava que ele não roda a partir de um
 *    prompt.
 */

type Entry = Awaited<ReturnType<typeof api.catalog.index>>['entries'][number]

interface Grupo {
  readonly chave: string
  readonly titulo: string
  readonly maker: string | null
  readonly ofertas: Entry[]
  readonly maisBarata: Entry | null
  readonly maisCara: Entry | null
  readonly provedores: number
  /** Vale abrir: mais de uma oferta, em mais de um provedor. */
  readonly agrupado: boolean
  /**
   * Dá para comparar DE VERDADE: dois provedores que publicaram preço.
   *
   * Não é o mesmo que `agrupado`, e a diferença é o que separa uma promessa
   * cumprida de uma quebrada. FLUX.1 [schnell] está em dois provedores e só um
   * deles publica preço — abrir a linha é útil, mas prometer uma comparação de
   * preço ali é prometer o que não existe.
   */
  readonly comparavel: boolean
  /**
   * Quanto o provedor mais caro cobra em cima do mais barato, cada um no MELHOR
   * preço que ele publica.
   *
   * Antes isso era a razão entre a oferta mais barata e a mais cara do grupo, sem
   * olhar de quem eram — e o fal publica o mesmo modelo em várias rotas com preços
   * diferentes. A tela dizia "o mais caro custa 2,2×" comparando fal com fal, numa
   * coluna intitulada "provedores". Era uma frase verdadeira sobre números e falsa
   * sobre o que ela parecia dizer.
   */
  readonly fator: number
}

const IMAGENS_POR_MES = 1000

export function Indice() {
  const [provedor, setProvedor] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaEcoada, setBuscaEcoada] = useState('')
  const [mostrarSemPreco, setMostrarSemPreco] = useState(false)
  const [soComparaveis, setSoComparaveis] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  const catalogo = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.catalog.index({ width: 1024, height: 1024, steps: 25 }),
    staleTime: 5 * 60_000,
  })

  const entries = useMemo(() => catalogo.data?.entries ?? [], [catalogo.data])

  /*
   * O contador é anunciado depois que a digitação para.
   *
   * `aria-live` ligado direto no estado da busca enfileira um anúncio por tecla:
   * digitar "flux" faz o leitor de tela falar quatro números por cima da própria
   * digitação, e a fila é FIFO — não descarta o que já venceu. Meio segundo de
   * silêncio transforma quatro anúncios em um.
   */
  useEffect(() => {
    const timer = setTimeout(() => setBuscaEcoada(busca), 500)
    return () => clearTimeout(timer)
  }, [busca])

  const grupos = useMemo(() => agrupar(entries), [entries])

  const filtrados = useMemo(() => {
    const agulha = busca.trim().toLowerCase()

    return grupos.filter((g) => {
      // O filtro que corresponde à razão de existir do produto. Sem ele, os
      // modelos com preço em dois provedores — a única resposta para "onde rodo
      // ESTE modelo mais barato" — ficam dispersos entre oitenta e uma linhas, e a
      // manchete anuncia um número que a pessoa não tem como isolar.
      if (soComparaveis && !g.comparavel) return false

      if (provedor !== '' && !g.ofertas.some((o) => o.provider === provedor)) return false

      if (agulha !== '') {
        const palheiro = `${g.titulo} ${g.maker ?? ''} ${g.ofertas.map((o) => o.name).join(' ')}`
        // Pontuação fora: buscar "flux 2" precisa achar `FLUX-2-pro`, e cada
        // provedor pontua o mesmo nome de um jeito.
        if (!semPontuacao(palheiro).includes(semPontuacao(agulha))) return false
      }

      if (g.maisBarata === null) return mostrarSemPreco
      return true
    })
  }, [grupos, provedor, busca, mostrarSemPreco, soComparaveis])

  const comPreco = grupos.filter((g) => g.maisBarata !== null)

  const faixa = useMemo(() => {
    const valores = comPreco.map((g) => Number(g.maisBarata?.costNanoUsd ?? 0)).filter((v) => v > 0)
    return valores.length > 0
      ? { min: Math.min(...valores), max: Math.max(...valores) }
      : { min: 1, max: 1 }
  }, [comPreco])

  const contagemPorProvedor = useMemo(() => {
    const mapa = new Map<string, { nome: string; total: number }>()
    for (const entry of entries) {
      const atual = mapa.get(entry.provider) ?? { nome: entry.providerName, total: 0 }
      atual.total += 1
      mapa.set(entry.provider, atual)
    }
    return [...mapa.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [entries])

  if (catalogo.isPending) return <Carregando />
  if (catalogo.isError) return <Erro />

  const comparaveis = comPreco.length
  const disputados = grupos.filter((g) => g.comparavel).length

  /*
   * O denominador é o que a lista mostraria SEM filtro, não o total do banco.
   * "12 de 413" com a lista sem filtro dizendo 81 faz a pessoa procurar por um
   * erro que não existe: 413 conta os grupos sem preço, que ela nunca viu.
   */
  const universo = mostrarSemPreco ? grupos.length : comparaveis

  return (
    <div className="flex flex-col gap-6">
      <Manchete
        modelos={entries.length}
        comparaveis={comparaveis}
        disputados={disputados}
        maisBarato={comPreco[0] ?? null}
      />

      <Filtros
        provedor={provedor}
        aoTrocarProvedor={setProvedor}
        busca={busca}
        aoBuscar={setBusca}
        mostrarSemPreco={mostrarSemPreco}
        aoAlternarSemPreco={setMostrarSemPreco}
        soComparaveis={soComparaveis}
        aoAlternarComparaveis={setSoComparaveis}
        comparaveisEntreProvedores={disputados}
        provedores={contagemPorProvedor}
        semPreco={grupos.length - comparaveis}
      />

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {buscaEcoada === busca && (
          <>
            <strong className="text-foreground tabular-nums">{filtrados.length}</strong>{' '}
            {filtrados.length === 1 ? 'modelo' : 'modelos'}
            {provedor !== '' || busca !== '' || soComparaveis ? ` de ${universo}` : ''}
          </>
        )}
      </p>

      {filtrados.length === 0 ? (
        <Vazio
          porFiltro={provedor !== '' || busca !== '' || soComparaveis}
          aoLimpar={() => {
            setProvedor('')
            setBusca('')
            setSoComparaveis(false)
          }}
        />
      ) : (
        <>
          {/* Acima de md: tabela. Abaixo: cartão. Cinco colunas em 375px viram
              672px de rolagem horizontal, e a coluna que explica o preço fica a
              337px de distância da coluna do preço — a cor sozinha passa a ser a
              única marca de que o dado envelheceu, o que é a 1.4.1 falhando. */}
          <Tabela grupos={filtrados} faixa={faixa} aberto={aberto} aoAbrir={setAberto} />
          <Cartoes grupos={filtrados} faixa={faixa} aberto={aberto} aoAbrir={setAberto} />
        </>
      )}

      <SemPrecoPublicado
        provedores={catalogo.data?.providersWithoutMachineReadablePrices ?? []}
        quantos={grupos.length - comparaveis}
      />
    </div>
  )
}

// --- a manchete ----------------------------------------------------------------

function Manchete({
  modelos,
  comparaveis,
  disputados,
  maisBarato,
}: {
  modelos: number
  comparaveis: number
  disputados: number
  maisBarato: Grupo | null
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium tracking-tight sm:text-2xl">
          Quanto custa mil imagens, em cada lugar que gera
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          O mesmo modelo custa preços diferentes em provedores diferentes. Esta tabela mostra a
          diferença — sem conta e sem chave. Cada preço carrega de onde veio e de quando é.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Numero rotulo="modelos no índice" valor={modelos.toLocaleString('pt-BR')} />
        <Numero rotulo="com preço comparável" valor={comparaveis.toLocaleString('pt-BR')} />
        <Numero rotulo="com preço em dois lugares" valor={disputados.toLocaleString('pt-BR')} />
        <Numero
          rotulo="mil imagens, o mais barato"
          valor={maisBarato?.maisBarata ? formatarPorMil(maisBarato.maisBarata.costNanoUsd!) : '—'}
          destaque
        />
      </dl>
    </header>
  )
}

function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string
  valor: string
  destaque?: boolean
}) {
  return (
    <div className="bg-card px-4 py-3">
      <dd
        className={`font-mono text-lg tracking-tight tabular-nums ${destaque ? 'text-primary' : ''}`}
      >
        {valor}
      </dd>
      <dt className="mt-0.5 text-xs text-muted-foreground">{rotulo}</dt>
    </div>
  )
}

// --- filtros -------------------------------------------------------------------

function Filtros({
  provedor,
  aoTrocarProvedor,
  busca,
  aoBuscar,
  mostrarSemPreco,
  aoAlternarSemPreco,
  soComparaveis,
  aoAlternarComparaveis,
  comparaveisEntreProvedores,
  provedores,
  semPreco,
}: {
  provedor: string
  aoTrocarProvedor: (v: string) => void
  busca: string
  aoBuscar: (v: string) => void
  mostrarSemPreco: boolean
  aoAlternarSemPreco: (v: boolean) => void
  soComparaveis: boolean
  aoAlternarComparaveis: (v: boolean) => void
  comparaveisEntreProvedores: number
  provedores: ReadonlyArray<readonly [string, { nome: string; total: number }]>
  semPreco: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Buscar modelo</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="flux, seedream, nano banana…"
          className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground sm:max-w-sm"
        />
      </label>

      {/* Chips com a contagem dentro. Quem escolhe já sabe o tamanho do resultado,
          e nenhum filtro devolve zero de surpresa. */}
      <div className="flex flex-wrap gap-2">
        <Chip ativo={provedor === ''} aoClicar={() => aoTrocarProvedor('')}>
          todos
        </Chip>
        {comparaveisEntreProvedores > 0 && (
          <Chip ativo={soComparaveis} aoClicar={() => aoAlternarComparaveis(!soComparaveis)}>
            dá para comparar{' '}
            <span className="tabular-nums opacity-60">{comparaveisEntreProvedores}</span>
          </Chip>
        )}
        {provedores.map(([slug, { nome, total }]) => (
          <Chip key={slug} ativo={provedor === slug} aoClicar={() => aoTrocarProvedor(slug)}>
            {nome} <span className="tabular-nums opacity-60">{total}</span>
          </Chip>
        ))}
        {semPreco > 0 && (
          <Chip ativo={mostrarSemPreco} aoClicar={() => aoAlternarSemPreco(!mostrarSemPreco)}>
            sem preço publicado <span className="tabular-nums opacity-60">{semPreco}</span>
          </Chip>
        )}
      </div>
    </div>
  )
}

/** 40px de altura: a 2.5.8 exige 24, e um dedo em pé no ônibus precisa de mais. */
function Chip({
  ativo,
  aoClicar,
  children,
}: {
  ativo: boolean
  aoClicar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
        ativo
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-input text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// --- a tabela ------------------------------------------------------------------

function Tabela({
  grupos,
  faixa,
  aberto,
  aoAbrir,
}: {
  grupos: Grupo[]
  faixa: { min: number; max: number }
  aberto: string | null
  aoAbrir: (v: string | null) => void
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border md:block">
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Modelos de geração de imagem e o preço de mil imagens em cada provedor, ordenados do
            mais barato para o mais caro.
          </caption>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-input">
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
              >
                Modelo
              </th>
              <th
                scope="col"
                aria-sort="ascending"
                className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground"
              >
                Mil imagens ↑
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
              >
                Onde
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
              >
                Procedência
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.slice(0, 200).map((g) => (
              <Linha
                key={g.chave}
                grupo={g}
                faixa={faixa}
                aberto={aberto === g.chave}
                aoAbrir={() => aoAbrir(aberto === g.chave ? null : g.chave)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {grupos.length > 200 && (
        <p className="border-t border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
          Mostrando 200 de {grupos.length}. Filtre para chegar no que interessa — o resto não é
          escondido, só não cabe numa tela.
        </p>
      )}
    </div>
  )
}

function Linha({
  grupo,
  faixa,
  aberto,
  aoAbrir,
}: {
  grupo: Grupo
  faixa: { min: number; max: number }
  aberto: boolean
  aoAbrir: () => void
}) {
  const barata = grupo.maisBarata

  return (
    <>
      <tr className="border-b border-border transition-colors last:border-b-0 hover:bg-card">
        {/* O identificador é cabeçalho de linha, e vem primeiro. Numa tabela cuja
            razão de existir é comparar o preço do MESMO modelo entre provedores,
            navegar a coluna de preço e ouvir "0,20" sem saber de qual modelo é
            não serve para nada. */}
        <th scope="row" className="px-4 py-3 text-left font-normal">
          <span className="block font-medium">{grupo.titulo}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {grupo.maker && <span>{grupo.maker}</span>}
            {barata?.tasks.slice(0, 2).map((t) => (
              <Etiqueta key={t}>{nomeDaTarefa(t)}</Etiqueta>
            ))}
            {barata?.watermark === 'synthid' && <Etiqueta alerta>marca d&apos;água</Etiqueta>}
          </span>
        </th>

        <td className="px-4 py-3 text-right align-middle">
          {barata?.costNanoUsd ? (
            <>
              <span className="font-mono tabular-nums">{formatarPorMil(barata.costNanoUsd)}</span>
              <span
                className="barra-preco mt-1.5 ml-auto block"
                style={{ width: larguraDaBarra(barata.costNanoUsd, faixa.min, faixa.max) }}
                aria-hidden="true"
              />
            </>
          ) : (
            <span className="text-xs text-muted-foreground">não publicado</span>
          )}
        </td>

        <td className="px-4 py-3 align-middle">
          {grupo.agrupado ? (
            <button
              type="button"
              onClick={aoAbrir}
              aria-expanded={aberto}
              aria-label={`${aberto ? 'Esconder' : 'Ver'} os ${grupo.provedores} provedores de ${grupo.titulo}`}
              className="min-h-10 text-left text-sm"
            >
              <span className="block text-primary">
                {grupo.provedores} provedores {aberto ? '▾' : '▸'}
              </span>
              {grupo.comparavel && grupo.fator > 1.05 && (
                <span className="text-xs text-muted-foreground">
                  o mais caro custa {formatarVezes(grupo.fator)}
                </span>
              )}
            </button>
          ) : (
            <span className="text-muted-foreground">{barata?.providerName ?? '—'}</span>
          )}
        </td>

        <td className="px-4 py-3 align-middle text-xs text-muted-foreground">
          <Procedencia entrada={barata} />
        </td>
      </tr>

      {aberto &&
        grupo.ofertas.map((oferta) => (
          <tr key={oferta.modelId} className="border-b border-border bg-card">
            <th
              scope="row"
              className="py-2 pr-4 pl-10 text-left text-xs font-normal text-muted-foreground"
            >
              {oferta.name}
            </th>
            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
              {oferta.costNanoUsd ? formatarPorMil(oferta.costNanoUsd) : '—'}
            </td>
            <td className="px-4 py-2 text-xs">{oferta.providerName}</td>
            <td className="px-4 py-2 text-xs">
              <Procedencia entrada={oferta} />
            </td>
          </tr>
        ))}
    </>
  )
}

/**
 * De onde veio o número, com link.
 *
 * A URL da página de preço do provedor já era coletada, já viajava no contrato em
 * toda linha, e era descartada sem virar link — a única coisa que fecha o laço de
 * confiança estava no fio e no lixo.
 */
function Procedencia({ entrada }: { entrada: Entry | null }) {
  if (!entrada?.collectedAt) return <span>—</span>

  const data = new Date(entrada.collectedAt).toLocaleDateString('pt-BR')

  return (
    <span className="flex flex-col gap-0.5">
      <span>
        {entrada.method === 'api' ? 'API do provedor' : entrada.method} · {data}
      </span>
      {entrada.source && (
        <a
          href={entrada.source}
          target="_blank"
          rel="noreferrer noopener"
          // 24px de alvo, que é o mínimo da 2.5.8. O link tinha 16 e não vale a
          // exceção de "link dentro de frase": ele está sozinho na própria linha.
          className="inline-flex min-h-6 w-fit items-center text-primary underline underline-offset-2"
        >
          conferir na fonte
        </a>
      )}
      {!entrada.fresh && (
        <span className="text-(--color-teto-fg)">⚠ acima de 30 dias — fora do ranking</span>
      )}
    </span>
  )
}

function Etiqueta({ children, alerta = false }: { children: React.ReactNode; alerta?: boolean }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[0.7rem] ${
        alerta
          ? 'border-(--color-teto-fg) text-(--color-teto-fg)'
          : 'border-border text-muted-foreground'
      }`}
    >
      {children}
    </span>
  )
}

// --- celular -------------------------------------------------------------------

function Cartoes({
  grupos,
  faixa,
  aberto,
  aoAbrir,
}: {
  grupos: Grupo[]
  faixa: { min: number; max: number }
  aberto: string | null
  aoAbrir: (v: string | null) => void
}) {
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {grupos.slice(0, 60).map((g) => {
        const barata = g.maisBarata
        const abertoAqui = aberto === g.chave

        return (
          <li key={g.chave} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{g.titulo}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {g.maker && <span>{g.maker}</span>}
                  {barata?.tasks.slice(0, 1).map((t) => (
                    <Etiqueta key={t}>{nomeDaTarefa(t)}</Etiqueta>
                  ))}
                  {barata?.watermark === 'synthid' && <Etiqueta alerta>marca d&apos;água</Etiqueta>}
                </p>
              </div>

              <div className="shrink-0 text-right">
                {barata?.costNanoUsd ? (
                  <>
                    <p className="font-mono tabular-nums">{formatarPorMil(barata.costNanoUsd)}</p>
                    <p className="text-[0.7rem] text-muted-foreground">mil imagens</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">não publicado</p>
                )}
              </div>
            </div>

            {barata?.costNanoUsd && (
              <span
                className="barra-preco mt-3 block"
                style={{ width: larguraDaBarra(barata.costNanoUsd, faixa.min, faixa.max) }}
                aria-hidden="true"
              />
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              {g.agrupado ? (
                <button
                  type="button"
                  onClick={() => aoAbrir(abertoAqui ? null : g.chave)}
                  aria-expanded={abertoAqui}
                  aria-label={`${abertoAqui ? 'Esconder' : 'Ver'} os ${g.provedores} provedores de ${g.titulo}`}
                  className="min-h-10 text-primary"
                >
                  {g.provedores} provedores
                  {g.comparavel && g.fator > 1.05
                    ? ` · até ${formatarVezes(g.fator)} mais caro`
                    : ''}{' '}
                  {abertoAqui ? '▾' : '▸'}
                </button>
              ) : (
                <span className="text-muted-foreground">{barata?.providerName ?? '—'}</span>
              )}
              <Procedencia entrada={barata} />
            </div>

            {abertoAqui && (
              <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {g.ofertas.map((o) => (
                  <li key={o.modelId} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {o.providerName} · {o.name}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {o.costNanoUsd ? formatarPorMil(o.costNanoUsd) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {barata?.costNanoUsd && (
              <p className="mt-3 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
                {formatarUnitario(barata.costNanoUsd)} · {IMAGENS_POR_MES.toLocaleString('pt-BR')}{' '}
                por mês custam {custoMensal(barata.costNanoUsd, IMAGENS_POR_MES)}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// --- estados -------------------------------------------------------------------

function Carregando() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p className="text-sm text-muted-foreground">Carregando o índice…</p>
      {/* Esqueleto com a forma da tabela, não um giro genérico: a pessoa já
          entende o que vai chegar antes de chegar. */}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  )
}

function Erro() {
  return (
    <div className="rounded-lg border border-(--color-falha-fg) bg-card p-5">
      <p className="text-sm">Não deu para carregar o índice.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        O servidor respondeu com erro. Os preços continuam no banco — é a leitura que falhou.
      </p>
    </div>
  )
}

/**
 * Vazio por ausência e vazio por filtro são coisas diferentes.
 *
 * Numa tela com quatro filtros, é a diferença entre "não existe" e "você filtrou
 * demais" — e a segunda tem uma saída.
 */
function Vazio({ porFiltro, aoLimpar }: { porFiltro: boolean; aoLimpar: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm">
        {porFiltro ? 'Nenhum modelo com esses filtros.' : 'O índice está vazio.'}
      </p>
      {porFiltro ? (
        <button
          type="button"
          onClick={aoLimpar}
          className="mt-3 min-h-10 rounded-lg border border-input px-4 text-sm"
        >
          Limpar filtros
        </button>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Rode <code className="font-mono">npm run coletar</code> para preencher.
        </p>
      )}
    </div>
  )
}

function SemPrecoPublicado({ provedores, quantos }: { provedores: string[]; quantos: number }) {
  if (provedores.length === 0) return null

  return (
    <section className="rounded-lg border-l-2 border-(--color-espera-fg) bg-card p-4 text-xs leading-relaxed text-muted-foreground">
      <h3 className="mb-1 text-sm font-medium text-foreground">O que ainda não está aqui</h3>
      <p>
        <strong className="text-foreground tabular-nums">{quantos}</strong> modelos aparecem no
        catálogo sem preço, porque o provedor não publica. E estes{' '}
        <strong className="text-foreground tabular-nums">{provedores.length}</strong> não publicam
        preço em formato nenhum que uma máquina leia: {provedores.join(', ')}. Os preços deles
        entram à mão, por pull request, com a URL da fonte e a data — uma tabela que mostra só o que
        é fácil de coletar se lê como “estes são todos os preços que existem”.
      </p>
    </section>
  )
}

// --- agrupamento ---------------------------------------------------------------

function semPontuacao(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Agrupa por identidade de modelo, e só quando isso ajuda.
 *
 * Um grupo com uma oferta só é uma linha normal: embrulhar uma coisa sozinha em
 * "1 provedor ▸" adiciona um clique e não entrega nada. `matchedBy: 'unresolved'`
 * também fica solto — a identidade não foi reconhecida, e fingir um grupo aí
 * seria juntar modelos que ninguém provou serem o mesmo.
 */
function agrupar(entries: readonly Entry[]): Grupo[] {
  const mapa = new Map<string, Entry[]>()

  for (const entry of entries) {
    const chave = entry.matchedBy === 'known-family' ? entry.modelKey : `solo:${entry.modelId}`
    const lista = mapa.get(chave)
    if (lista) lista.push(entry)
    else mapa.set(chave, [entry])
  }

  const grupos: Grupo[] = []

  for (const [chave, ofertas] of mapa) {
    const comPreco = ofertas
      .filter((o) => o.costNanoUsd !== null)
      .sort((a, b) => Number(a.costNanoUsd) - Number(b.costNanoUsd))

    const provedores = new Set(ofertas.map((o) => o.provider)).size

    // Um preço por provedor: o melhor que ele oferece. Duas rotas do mesmo fal não
    // são duas opções de compra, são a mesma loja com duas prateleiras.
    const melhorDeCada = new Map<string, number>()
    for (const o of comPreco) {
      const valor = Number(o.costNanoUsd)
      const atual = melhorDeCada.get(o.provider)
      if (atual === undefined || valor < atual) melhorDeCada.set(o.provider, valor)
    }
    const melhores = [...melhorDeCada.values()].sort((x, y) => x - y)
    const comparavel = melhores.length > 1

    grupos.push({
      chave,
      titulo:
        ofertas[0]?.matchedBy === 'known-family'
          ? (ofertas[0]?.modelLabel ?? '')
          : (ofertas[0]?.name ?? ''),
      maker: ofertas[0]?.maker ?? null,
      ofertas: ofertas.slice().sort((a, b) => {
        if (a.costNanoUsd === null) return 1
        if (b.costNanoUsd === null) return -1
        return Number(a.costNanoUsd) - Number(b.costNanoUsd)
      }),
      maisBarata: comPreco[0] ?? null,
      maisCara: comPreco[comPreco.length - 1] ?? null,
      provedores,
      // Só vira grupo quando há mais de uma oferta E mais de um provedor. Duas
      // rotas do mesmo provedor não respondem "onde sai mais barato".
      agrupado: ofertas.length > 1 && provedores > 1,
      comparavel,
      fator: comparavel ? quantasVezes(melhores[0]!, melhores[melhores.length - 1]!) : 1,
    })
  }

  return grupos.sort((a, b) => {
    if (a.maisBarata === null && b.maisBarata === null) return a.titulo.localeCompare(b.titulo)
    if (a.maisBarata === null) return 1
    if (b.maisBarata === null) return -1
    return Number(a.maisBarata.costNanoUsd) - Number(b.maisBarata.costNanoUsd)
  })
}
