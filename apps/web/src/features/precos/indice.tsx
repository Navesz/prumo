import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Carregando, EstadoErro, EstadoVazio } from '@/components/padroes/estados.js'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api } from '@/api.js'
import { agrupar, filtrar, ordenar, type Coluna, type Ordem } from './agrupar.js'
import { Cartoes } from './cartoes.js'
import { Filtros, type EstadoDosFiltros } from './filtros.js'
import { Manchete } from './manchete.js'
import { Tabela } from './tabela.js'

/**
 * O índice de preços — o orquestrador, e só isso.
 *
 * Era um arquivo de 846 linhas com tabela, cartão, filtro, manchete, estados e a
 * regra de agrupamento todos dentro. A regra que decide se o produto pode
 * afirmar "2,0× mais caro" só era exercível montando React.
 */

const PREMISSA = { width: 1024, height: 1024, steps: 25 } as const

export function Indice() {
  const [filtros, setFiltros] = useState<EstadoDosFiltros>({
    provedor: '',
    busca: '',
    soComparaveis: false,
    mostrarSemPreco: false,
  })
  const [ordem, setOrdem] = useState<Ordem>({ coluna: 'preco', desc: false })
  const [aberto, setAberto] = useState<string | null>(null)
  const [buscaEcoada, setBuscaEcoada] = useState('')

  const catalogo = useQuery({
    queryKey: ['catalog', PREMISSA],
    queryFn: () => api.catalog.index(PREMISSA),
    staleTime: 5 * 60_000,
  })

  const entries = useMemo(() => catalogo.data?.entries ?? [], [catalogo.data])
  const grupos = useMemo(() => agrupar(entries), [entries])

  /*
   * O contador é anunciado depois que a digitação para.
   *
   * `aria-live` ligado direto no estado da busca enfileira um anúncio por tecla:
   * digitar "flux" faz o leitor de tela falar quatro números por cima da própria
   * digitação, e a fila é FIFO — não descarta o que já venceu.
   */
  useEffect(() => {
    const t = setTimeout(() => setBuscaEcoada(filtros.busca), 500)
    return () => clearTimeout(t)
  }, [filtros.busca])

  const visiveis = useMemo(() => ordenar(filtrar(grupos, filtros), ordem), [grupos, filtros, ordem])

  const faixa = useMemo(() => {
    const v = grupos.map((g) => Number(g.maisBarata?.costNanoUsd ?? 0)).filter((n) => n > 0)
    return v.length > 0 ? { min: Math.min(...v), max: Math.max(...v) } : { min: 1, max: 1 }
  }, [grupos])

  /*
   * A contagem do chip conta o que o CLIQUE entrega, não o que existe no banco.
   *
   * "fal.ai 589" que devolvia 63 linhas era a tela se desmentindo em um clique:
   * ela contava entradas do catálogo e a tabela mostra grupos já filtrados pelos
   * outros controles.
   */
  const provedores = useMemo(() => {
    const mapa = new Map<string, { slug: string; nome: string; total: number }>()

    for (const entry of entries) {
      if (!mapa.has(entry.provider)) {
        mapa.set(entry.provider, { slug: entry.provider, nome: entry.providerName, total: 0 })
      }
    }

    for (const [slug, info] of mapa) {
      info.total = filtrar(grupos, { ...filtros, provedor: slug }).length
    }

    return [...mapa.values()].filter((p) => p.total > 0).sort((a, b) => b.total - a.total)
  }, [entries, grupos, filtros])

  const comPreco = grupos.filter((g) => g.maisBarata !== null)
  const disputados = grupos.filter((g) => g.comparavel).length
  const semPreco = grupos.length - comPreco.length
  const universo = filtros.mostrarSemPreco ? grupos.length : comPreco.length
  const filtrado = visiveis.length !== universo

  if (catalogo.isPending) return <Carregando />

  if (catalogo.isError) {
    return (
      <EstadoErro
        titulo="Não deu para carregar o índice."
        detalhe="O servidor respondeu com erro. Os preços continuam no banco — é a leitura que falhou."
        aoTentarNovamente={() => void catalogo.refetch()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Manchete
        modelos={entries.length}
        comparaveis={comPreco.length}
        disputados={disputados}
        maisBarato={comPreco[0] ?? null}
        premissa={PREMISSA}
      />

      <Filtros
        estado={filtros}
        aoMudar={(parcial) => setFiltros((atual) => ({ ...atual, ...parcial }))}
        provedores={provedores}
        comparaveis={disputados}
        semPreco={semPreco}
      />

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {buscaEcoada === filtros.busca && (
          <>
            <strong className="tabular-nums text-foreground">
              {visiveis.length.toLocaleString('pt-BR')}
            </strong>{' '}
            {visiveis.length === 1 ? 'modelo' : 'modelos'}
            {filtrado ? ` de ${universo.toLocaleString('pt-BR')}` : ''}
          </>
        )}
      </p>

      {visiveis.length === 0 ? (
        <EstadoVazio
          titulo={filtrado ? 'Nenhum modelo com esses filtros.' : 'O índice está vazio.'}
          detalhe={
            filtrado ? (
              'Os filtros se somam: provedor, busca e os dois interruptores valem ao mesmo tempo.'
            ) : (
              <>
                Rode <code className="font-mono">npm run coletar</code> para preencher.
              </>
            )
          }
          acao={
            filtrado ? (
              <Button
                variant="outline"
                size="lg"
                className="min-h-10"
                onClick={() =>
                  setFiltros({
                    provedor: '',
                    busca: '',
                    soComparaveis: false,
                    mostrarSemPreco: false,
                  })
                }
              >
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Tabela
            grupos={visiveis}
            faixa={faixa}
            ordem={ordem}
            aoOrdenar={(c: Coluna) =>
              setOrdem((a) =>
                a.coluna === c ? { ...a, desc: !a.desc } : { coluna: c, desc: c !== 'modelo' },
              )
            }
            aberto={aberto}
            aoAbrir={setAberto}
          />
          <Cartoes grupos={visiveis} faixa={faixa} aberto={aberto} aoAbrir={setAberto} />
        </>
      )}

      <SemPrecoPublicado
        provedores={catalogo.data?.providersWithoutMachineReadablePrices ?? []}
        quantos={semPreco}
      />
    </div>
  )
}

/**
 * O bloco mais honesto da tela, e por isso ele não fica atrás de uma rolagem.
 *
 * Uma tabela que mostra só o que é fácil de coletar se lê como "estes são todos
 * os preços que existem".
 */
function SemPrecoPublicado({ provedores, quantos }: { provedores: string[]; quantos: number }) {
  if (provedores.length === 0) return null

  return (
    <Alert>
      <Info />
      <AlertTitle>O que ainda não está aqui</AlertTitle>
      <AlertDescription>
        <strong className="tabular-nums text-foreground">{quantos.toLocaleString('pt-BR')}</strong>{' '}
        modelos aparecem no catálogo sem preço, porque o provedor não publica. E estes{' '}
        <strong className="tabular-nums text-foreground">{provedores.length}</strong> não publicam
        preço em formato nenhum que uma máquina leia: {provedores.join(', ')}. Os preços deles
        entram à mão, por pull request, com a URL da fonte e a data.
      </AlertDescription>
    </Alert>
  )
}
