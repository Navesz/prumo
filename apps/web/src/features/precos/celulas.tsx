import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatarPorMil, formatarVezes, larguraDaBarra, nomeDaTarefa } from '@/preco.js'
import type { Entry, Grupo } from './agrupar.js'

/**
 * As células que a tabela e o cartão compartilham.
 *
 * Elas existiam duas vezes, e as duas cópias já tinham divergido: o cartão
 * mostrava preço unitário e custo mensal que o desktop não mostrava. Duas telas
 * do mesmo dado com conteúdos diferentes é a versão de UI do mesmo bug que a
 * `agrupar.ts` resolve nos números.
 */

export function Preco({
  entrada,
  faixa,
  compacto = false,
}: {
  entrada: Entry | null
  faixa: { min: number; max: number }
  compacto?: boolean
}) {
  if (!entrada?.costNanoUsd) {
    return <span className="text-xs text-muted-foreground">não publicado</span>
  }

  return (
    <div className={compacto ? 'text-right' : 'ml-auto w-fit text-right'}>
      <span className="font-mono text-sm tabular-nums">{formatarPorMil(entrada.costNanoUsd)}</span>
      <span
        className="barra-preco mt-1.5 ml-auto block"
        style={{ width: larguraDaBarra(entrada.costNanoUsd, faixa.min, faixa.max) }}
        aria-hidden="true"
      />
    </div>
  )
}

/**
 * Onde se compra, e o quanto vale procurar.
 *
 * O botão ganha nome acessível próprio: numa lista, doze botões chamados
 * "2 provedores" são doze destinos indistinguíveis para quem navega por lista de
 * botões.
 */
export function Provedores({
  grupo,
  aberto,
  aoAbrir,
}: {
  grupo: Grupo
  aberto: boolean
  aoAbrir: () => void
}) {
  if (!grupo.agrupado) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Store className="size-3.5 shrink-0" aria-hidden="true" />
        {grupo.maisBarata?.providerName ?? '—'}
      </span>
    )
  }

  return (
    <Button
      variant="ghost"
      size="lg"
      onClick={aoAbrir}
      aria-expanded={aberto}
      aria-label={`${aberto ? 'Esconder' : 'Ver'} os ${grupo.provedores} provedores de ${grupo.titulo}`}
      className="-ml-2 h-auto min-h-10 flex-col items-start gap-0 py-1.5 text-left"
    >
      <span className="inline-flex items-center gap-1.5 text-primary">
        {aberto ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        {grupo.provedores} provedores
      </span>

      {grupo.comparavel && grupo.fator > 1.05 && (
        <span className="pl-5 text-xs font-normal text-muted-foreground">
          o mais caro custa {formatarVezes(grupo.fator)}
        </span>
      )}
    </Button>
  )
}

/** Fabricante e tarefa. A tarefa importa: um modelo de inpaint não roda de um prompt. */
export function Etiquetas({ grupo, limite = 2 }: { grupo: Grupo; limite?: number }) {
  const barata = grupo.maisBarata

  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {grupo.maker && <span className="text-xs text-muted-foreground">{grupo.maker}</span>}

      {barata?.tasks.slice(0, limite).map((t) => (
        <Badge key={t} variant="outline" className="font-normal">
          {nomeDaTarefa(t)}
        </Badge>
      ))}

      {barata?.watermark === 'synthid' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge className="border-teto-line bg-teto font-normal text-teto-fg">
                <AlertTriangle className="size-3" aria-hidden="true" />
                marca d&apos;água
              </Badge>
            }
          />
          <TooltipContent>
            Este modelo embute SynthID em toda imagem que gera. É invisível a olho nu e detectável
            por máquina.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

/**
 * De onde veio o número, com link.
 *
 * A URL da página de preço do provedor já era coletada e já viajava no contrato
 * em toda linha, e era descartada sem virar link — a única coisa que fecha o
 * laço de confiança estava no fio e no lixo.
 */
export function Procedencia({ entrada }: { entrada: Entry | null }) {
  if (!entrada?.collectedAt) return <span className="text-muted-foreground">—</span>

  const data = new Date(entrada.collectedAt).toLocaleDateString('pt-BR')

  return (
    <span className="flex flex-col items-start gap-0.5 text-xs text-muted-foreground">
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
          className="inline-flex min-h-6 w-fit items-center gap-1 text-primary underline underline-offset-2"
        >
          conferir na fonte
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      )}

      {!entrada.fresh && (
        <span className="inline-flex items-center gap-1 text-teto-fg">
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          acima de 30 dias — fora do ranking
        </span>
      )}
    </span>
  )
}
