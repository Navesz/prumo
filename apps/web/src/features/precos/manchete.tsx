import { Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatarPorMil } from '@/preco.js'
import type { Grupo } from './agrupar.js'

/**
 * A manchete: o que o produto faz, e os quatro números que sustentam a frase.
 *
 * O número que mais importa é o TERCEIRO, e ele é pequeno: de 648 modelos, três
 * têm preço em mais de um provedor. A tela não pode inflá-lo nem escondê-lo — a
 * razão de existir do índice é justamente a comparação, e fingir que ela cobre
 * tudo seria vender o que não há.
 *
 * A premissa aparece como etiqueta, e isso é conserto de mentira: todo preço
 * desta tabela é o custo de UMA imagem 1024×1024 com 25 passos. Sem dizer,
 * "US$ 0,200 por mil imagens" parecia um preço absoluto e não a normalização que
 * é.
 */

export function Manchete({
  modelos,
  comparaveis,
  disputados,
  maisBarato,
  premissa,
}: {
  modelos: number
  comparaveis: number
  disputados: number
  maisBarato: Grupo | null
  premissa: { width: number; height: number; steps: number }
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Quanto custa mil imagens, em cada lugar que gera
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
          O mesmo modelo custa preços diferentes em provedores diferentes. Esta tabela mostra a
          diferença — sem conta e sem chave. Cada preço carrega de onde veio e de quando é.
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="outline" className="mt-1 w-fit gap-1.5 font-normal">
                <Info className="size-3" aria-hidden="true" />
                {premissa.width}×{premissa.height} · {premissa.steps} passos
              </Badge>
            }
          />
          <TooltipContent>
            Todo preço aqui é normalizado para uma imagem deste tamanho e deste número de passos.
            Provedores cobram por megapixel, por passo ou por segundo — sem uma premissa comum, os
            números não se comparam.
          </TooltipContent>
        </Tooltip>
      </div>

      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border p-0 sm:grid-cols-4">
        <Numero
          valor={modelos.toLocaleString('pt-BR')}
          rotulo="modelos no índice"
          ajuda="Tudo que os coletores encontraram nos provedores, com preço ou sem."
        />
        <Numero
          valor={comparaveis.toLocaleString('pt-BR')}
          rotulo="com preço comparável"
          ajuda="O provedor publica um preço que dá para normalizar para uma imagem. Cobrança por token de saída, por exemplo, não dá."
        />
        <Numero
          valor={disputados.toLocaleString('pt-BR')}
          rotulo="com preço em dois lugares"
          ajuda="Os únicos que respondem 'onde rodo ESTE modelo mais barato'. É pouco porque dez dos treze provedores não publicam preço legível por máquina."
        />
        <Numero
          valor={maisBarato?.maisBarata ? formatarPorMil(maisBarato.maisBarata.costNanoUsd!) : '—'}
          rotulo="mil imagens, o mais barato"
          ajuda={
            maisBarato ? `${maisBarato.titulo}, em ${maisBarato.maisBarata?.providerName}.` : '—'
          }
          destaque
        />
      </Card>
    </div>
  )
}

function Numero({
  valor,
  rotulo,
  ajuda,
  destaque = false,
}: {
  valor: string
  rotulo: string
  ajuda: string
  destaque?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="cursor-help bg-card px-4 py-3 text-left transition-colors hover:bg-accent">
            <dl>
              <dd
                className={`font-mono text-xl tracking-tight tabular-nums ${destaque ? 'text-primary' : ''}`}
              >
                {valor}
              </dd>
              <dt className="mt-0.5 text-xs text-muted-foreground">{rotulo}</dt>
            </dl>
          </div>
        }
      />
      <TooltipContent>{ajuda}</TooltipContent>
    </Tooltip>
  )
}
