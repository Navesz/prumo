import type { api } from '@/api.js'
import { quantasVezes } from '@/preco.js'

/**
 * O agrupamento e a ordenação do índice, sem uma linha de JSX.
 *
 * Estava dentro de um componente de 846 linhas, o que significa que a regra que
 * decide se o produto pode afirmar "2,0× mais caro" só era exercível montando
 * React. Aqui é função pura: entra `Entry[]`, sai `Grupo[]`.
 */

export type Entry = Awaited<ReturnType<typeof api.catalog.index>>['entries'][number]

export interface Grupo {
  readonly chave: string
  readonly titulo: string
  readonly maker: string | null
  readonly ofertas: Entry[]
  readonly maisBarata: Entry | null
  readonly provedores: number
  /** Vale abrir: mais de uma oferta, em mais de um provedor. */
  readonly agrupado: boolean
  /**
   * Dá para comparar DE VERDADE: dois provedores que publicaram preço.
   *
   * Não é o mesmo que `agrupado`, e a diferença separa uma promessa cumprida de
   * uma quebrada. Um modelo pode estar em dois provedores com só um publicando
   * preço — abrir a linha é útil, prometer comparação de preço ali não é.
   */
  readonly comparavel: boolean
  /**
   * Quanto o provedor mais caro cobra em cima do mais barato, cada um no MELHOR
   * preço que ele publica.
   *
   * Antes era a razão entre a oferta mais barata e a mais cara do grupo, sem
   * olhar de quem eram — e o fal publica o mesmo modelo em várias rotas com
   * preços diferentes. A tela dizia "2,2× mais caro" comparando fal com fal,
   * numa coluna intitulada "provedores".
   */
  readonly fator: number
}

export type Coluna = 'modelo' | 'preco' | 'fator'
export interface Ordem {
  readonly coluna: Coluna
  readonly desc: boolean
}

/** Sem pontuação: buscar "flux 2" precisa achar `FLUX-2-pro`. */
export function semPontuacao(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function agrupar(entries: readonly Entry[]): Grupo[] {
  const mapa = new Map<string, Entry[]>()

  for (const entry of entries) {
    // Identidade não reconhecida fica sozinha. Fingir um grupo aí seria juntar
    // modelos que ninguém provou serem o mesmo.
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

    // Um preço por provedor: o melhor que ele oferece. Duas rotas do mesmo fal
    // não são duas opções de compra, são a mesma loja com duas prateleiras.
    const melhorDeCada = new Map<string, number>()
    for (const o of comPreco) {
      const valor = Number(o.costNanoUsd)
      const atual = melhorDeCada.get(o.provider)
      if (atual === undefined || valor < atual) melhorDeCada.set(o.provider, valor)
    }
    const melhores = [...melhorDeCada.values()].sort((x, y) => x - y)
    const comparavel = melhores.length > 1

    const primeira = ofertas[0]
    const provedores = new Set(ofertas.map((o) => o.provider)).size

    grupos.push({
      chave,
      titulo:
        primeira?.matchedBy === 'known-family'
          ? (primeira.modelLabel ?? '')
          : (primeira?.name ?? ''),
      maker: primeira?.maker ?? null,
      ofertas: ofertas.slice().sort((a, b) => {
        if (a.costNanoUsd === null) return 1
        if (b.costNanoUsd === null) return -1
        return Number(a.costNanoUsd) - Number(b.costNanoUsd)
      }),
      maisBarata: comPreco[0] ?? null,
      provedores,
      agrupado: ofertas.length > 1 && provedores > 1,
      comparavel,
      fator: comparavel ? quantasVezes(melhores[0]!, melhores[melhores.length - 1]!) : 1,
    })
  }

  return grupos
}

/**
 * Ordena, e o sem-preço vai SEMPRE para o fim.
 *
 * Um grupo sem preço não é "o mais barato" nem "o mais caro" — é ausência de
 * dado, e deixar a ausência liderar um ranking de preço é a tabela mentindo por
 * ordenação. Vale para as duas direções.
 */
export function ordenar(grupos: readonly Grupo[], ordem: Ordem): Grupo[] {
  const sinal = ordem.desc ? -1 : 1

  return grupos.slice().sort((a, b) => {
    if (ordem.coluna === 'modelo') return sinal * a.titulo.localeCompare(b.titulo, 'pt-BR')

    if (ordem.coluna === 'fator') {
      if (a.comparavel !== b.comparavel) return a.comparavel ? -1 : 1
      return sinal * (a.fator - b.fator)
    }

    if (a.maisBarata === null || b.maisBarata === null) {
      if (a.maisBarata === b.maisBarata) return a.titulo.localeCompare(b.titulo, 'pt-BR')
      return a.maisBarata === null ? 1 : -1
    }
    return sinal * (Number(a.maisBarata.costNanoUsd) - Number(b.maisBarata.costNanoUsd))
  })
}

/** Aplica os filtros na ordem em que eles se limitam. */
export function filtrar(
  grupos: readonly Grupo[],
  f: {
    provedor: string
    busca: string
    soComparaveis: boolean
    mostrarSemPreco: boolean
  },
): Grupo[] {
  const agulha = semPontuacao(f.busca.trim())

  return grupos.filter((g) => {
    if (f.soComparaveis && !g.comparavel) return false
    if (f.provedor !== '' && !g.ofertas.some((o) => o.provider === f.provedor)) return false

    if (agulha !== '') {
      const palheiro = `${g.titulo} ${g.maker ?? ''} ${g.ofertas.map((o) => o.name).join(' ')}`
      if (!semPontuacao(palheiro).includes(agulha)) return false
    }

    if (g.maisBarata === null) return f.mostrarSemPreco
    return true
  })
}
