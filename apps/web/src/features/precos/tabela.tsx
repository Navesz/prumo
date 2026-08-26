import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatarPorMil } from '@/preco.js'
import type { Coluna, Grupo, Ordem } from './agrupar.js'
import { CabecalhoOrdenavel } from './cabecalho-ordenavel.js'
import { Etiquetas, Preco, Procedencia, Provedores } from './celulas.js'

/**
 * A tabela, acima de `md`.
 *
 * Duas coisas que o `<table>` à mão fazia e o shadcn precisa que se peça:
 *
 * 1. `TableCell` e `TableHead` trazem `whitespace-nowrap` de fábrica. Na coluna
 *    Modelo, isso empurraria o fabricante e as etiquetas para fora em vez de
 *    empilhar — e não avisaria. `whitespace-normal` explícito nessa coluna.
 * 2. O `max-h-[70vh]` com rolagem própria saiu. Duas barras de rolagem na mesma
 *    direção prendem o rodapé "O que ainda não está aqui" atrás de milhares de
 *    pixels de linha, e esse bloco é a parte mais honesta da tela.
 */

const TETO = 200

export function Tabela({
  grupos,
  faixa,
  ordem,
  aoOrdenar,
  aberto,
  aoAbrir,
}: {
  grupos: Grupo[]
  faixa: { min: number; max: number }
  ordem: Ordem
  aoOrdenar: (coluna: Coluna) => void
  aberto: string | null
  aoAbrir: (chave: string | null) => void
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border md:block">
      <Table>
        <TableCaption className="sr-only">
          Modelos de geração de imagem e o preço de mil imagens em cada provedor.
        </TableCaption>

        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <CabecalhoOrdenavel coluna="modelo" ordem={ordem} aoOrdenar={aoOrdenar}>
              Modelo
            </CabecalhoOrdenavel>
            <CabecalhoOrdenavel
              coluna="preco"
              ordem={ordem}
              aoOrdenar={aoOrdenar}
              alinharDireita
              className="w-40 text-right"
            >
              Mil imagens
            </CabecalhoOrdenavel>
            <CabecalhoOrdenavel coluna="fator" ordem={ordem} aoOrdenar={aoOrdenar} className="w-52">
              Onde
            </CabecalhoOrdenavel>
            <TableHead className="w-56 px-2 text-xs font-medium text-muted-foreground">
              Procedência
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {grupos.slice(0, TETO).map((g) => (
            <Linha
              key={g.chave}
              grupo={g}
              faixa={faixa}
              aberto={aberto === g.chave}
              aoAbrir={() => aoAbrir(aberto === g.chave ? null : g.chave)}
            />
          ))}
        </TableBody>
      </Table>

      {grupos.length > TETO && (
        <div className="border-t border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
          Mostrando {TETO} de {grupos.length.toLocaleString('pt-BR')}. Filtre para chegar no que
          interessa — o resto não está escondido, só não cabe numa tela.
        </div>
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
  // Ofertas com preço primeiro; as sem preço vão depois de um divisor, porque
  // "2 provedores" onde só um publica preço não é uma comparação.
  const comPreco = grupo.ofertas.filter((o) => o.costNanoUsd !== null)
  const semPreco = grupo.ofertas.filter((o) => o.costNanoUsd === null)

  return (
    <>
      <TableRow className="border-border">
        {/* O identificador é cabeçalho de linha e vem primeiro. Numa tabela cuja
            razão de existir é comparar o preço do MESMO modelo entre provedores,
            navegar a coluna de preço e ouvir "0,20" sem saber de qual modelo é
            não serve para nada. */}
        <TableHead
          scope="row"
          className="h-auto px-2 py-3 text-left align-top font-normal whitespace-normal"
        >
          <span className="block font-medium">{grupo.titulo}</span>
          <Etiquetas grupo={grupo} />
        </TableHead>

        <TableCell className="px-2 py-3 text-right align-top">
          <Preco entrada={grupo.maisBarata} faixa={faixa} />
        </TableCell>

        <TableCell className="px-2 py-3 align-top whitespace-normal">
          <Provedores grupo={grupo} aberto={aberto} aoAbrir={aoAbrir} />
        </TableCell>

        <TableCell className="px-2 py-3 align-top whitespace-normal">
          <Procedencia entrada={grupo.maisBarata} />
        </TableCell>
      </TableRow>

      {aberto && (
        <>
          {comPreco.map((oferta) => (
            <TableRow key={oferta.modelId} className="border-border bg-muted/40">
              <TableHead
                scope="row"
                className="h-auto py-2 pr-2 pl-8 text-left text-xs font-normal whitespace-normal text-muted-foreground"
              >
                {oferta.name}
              </TableHead>
              <TableCell className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                {formatarPorMil(oferta.costNanoUsd!)}
              </TableCell>
              <TableCell className="px-2 py-2 text-xs">{oferta.providerName}</TableCell>
              <TableCell className="px-2 py-2 whitespace-normal">
                <Procedencia entrada={oferta} />
              </TableCell>
            </TableRow>
          ))}

          {semPreco.length > 0 && (
            <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={4} className="px-2 py-2 whitespace-normal">
                <Separator className="mb-2" />
                <span className="text-xs text-muted-foreground">
                  Também oferecido, sem preço publicado:{' '}
                  {semPreco.map((o) => `${o.providerName} · ${o.name}`).join(' · ')}
                </span>
              </TableCell>
            </TableRow>
          )}
        </>
      )}
    </>
  )
}
