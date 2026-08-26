import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { custoMensal, formatarPorMil, formatarUnitario } from '@/preco.js'
import type { Grupo } from './agrupar.js'
import { Etiquetas, Preco, Procedencia, Provedores } from './celulas.js'

/**
 * Abaixo de `md`, cartão em vez de tabela.
 *
 * Quatro colunas em 375px viram rolagem horizontal, e a coluna que explica o
 * preço fica a centenas de pixels de distância da coluna do preço — a cor
 * sozinha passa a ser a única marca de que o dado envelheceu, o que é a 1.4.1
 * falhando.
 */

const TETO = 60
const IMAGENS_POR_MES = 1000

export function Cartoes({
  grupos,
  faixa,
  aberto,
  aoAbrir,
}: {
  grupos: Grupo[]
  faixa: { min: number; max: number }
  aberto: string | null
  aoAbrir: (chave: string | null) => void
}) {
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {grupos.slice(0, TETO).map((g) => {
        const abertoAqui = aberto === g.chave
        const barata = g.maisBarata

        return (
          <li key={g.chave}>
            <Card className="gap-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{g.titulo}</p>
                  <Etiquetas grupo={g} limite={1} />
                </div>

                <div className="shrink-0">
                  <Preco entrada={barata} faixa={faixa} compacto />
                  {barata?.costNanoUsd && (
                    <p className="mt-1 text-[0.7rem] text-muted-foreground">mil imagens</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
                <Provedores
                  grupo={g}
                  aberto={abertoAqui}
                  aoAbrir={() => aoAbrir(abertoAqui ? null : g.chave)}
                />
                <Procedencia entrada={barata} />
              </div>

              {abertoAqui && (
                <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {g.ofertas.map((o) => (
                    <li
                      key={o.modelId}
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
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
                <>
                  <Separator className="mt-3" />
                  <p className="mt-2 text-[0.7rem] text-muted-foreground">
                    {formatarUnitario(barata.costNanoUsd)} ·{' '}
                    {IMAGENS_POR_MES.toLocaleString('pt-BR')} por mês custam{' '}
                    {custoMensal(barata.costNanoUsd, IMAGENS_POR_MES)}
                  </p>
                </>
              )}
            </Card>
          </li>
        )
      })}

      {grupos.length > TETO && (
        <li className="px-1 py-2 text-xs text-muted-foreground">
          Mostrando {TETO} de {grupos.length.toLocaleString('pt-BR')}. Use a busca ou os filtros.
        </li>
      )}
    </ul>
  )
}
