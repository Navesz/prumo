import { Check, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

/**
 * Os filtros, e a contagem que parou de se contradizer.
 *
 * O chip dizia "fal.ai 589" e entregava 63 linhas. Ele contava ENTRADAS do
 * catálogo e a tabela mostra GRUPOS já filtrados — a tela se desmentindo em um
 * clique. Agora a contagem é do que o clique realmente entrega.
 *
 * O chip "todos" também saiu. Era um botão a mais para desfazer uma coisa só, e
 * não zerava a busca nem os dois booleanos. No lugar entra "Limpar tudo", que
 * aparece quando há o que limpar e limpa os quatro estados.
 */

export interface EstadoDosFiltros {
  provedor: string
  busca: string
  soComparaveis: boolean
  mostrarSemPreco: boolean
}

export function Filtros({
  estado,
  aoMudar,
  provedores,
  comparaveis,
  semPreco,
}: {
  estado: EstadoDosFiltros
  aoMudar: (parcial: Partial<EstadoDosFiltros>) => void
  provedores: ReadonlyArray<{ slug: string; nome: string; total: number }>
  comparaveis: number
  semPreco: number
}) {
  const temFiltro =
    estado.provedor !== '' || estado.busca !== '' || estado.soComparaveis || estado.mostrarSemPreco

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={estado.busca}
            onChange={(e) => aoMudar({ busca: e.target.value })}
            placeholder="flux, seedream, nano banana…"
            aria-label="Buscar modelo"
            className="h-10 pl-9"
          />
          {estado.busca !== '' && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => aoMudar({ busca: '' })}
              aria-label="Limpar a busca"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <X />
            </Button>
          )}
        </div>

        {temFiltro && (
          <Button
            variant="ghost"
            size="lg"
            onClick={() =>
              aoMudar({ provedor: '', busca: '', soComparaveis: false, mostrarSemPreco: false })
            }
            className="min-h-10 text-muted-foreground hover:text-foreground"
          >
            <X />
            Limpar tudo
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Os dois booleanos vêm primeiro e carregam um check quando ligados:
            eles somam-se ao filtro de provedor em vez de trocar de faceta, e a
            forma tem de dizer isso antes do clique. */}
        {comparaveis > 0 && (
          <Chip
            ativo={estado.soComparaveis}
            aoClicar={() => aoMudar({ soComparaveis: !estado.soComparaveis })}
            contagem={comparaveis}
            marcavel
          >
            dá para comparar
          </Chip>
        )}

        {semPreco > 0 && (
          <Chip
            ativo={estado.mostrarSemPreco}
            aoClicar={() => aoMudar({ mostrarSemPreco: !estado.mostrarSemPreco })}
            contagem={semPreco}
            marcavel
          >
            sem preço publicado
          </Chip>
        )}

        {provedores.length > 0 && (
          <Separator orientation="vertical" className="mx-1 hidden !h-6 sm:block" />
        )}

        {/* Faceta exclusiva: escolher um provedor troca, não soma. */}
        <div role="group" aria-label="Filtrar por provedor" className="flex flex-wrap gap-2">
          {provedores.map((p) => (
            <Chip
              key={p.slug}
              ativo={estado.provedor === p.slug}
              aoClicar={() => aoMudar({ provedor: estado.provedor === p.slug ? '' : p.slug })}
              contagem={p.total}
            >
              {p.nome}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 40px de altura, e isso é decisão, não sobra.
 *
 * A escala do shadcn é densa de desktop: o botão padrão tem 32px e o maior, 36.
 * A 2.5.8 exige 24, mas um polegar em pé no ônibus precisa de mais — e este é o
 * único controle da tela que uma pessoa usa com o dedo.
 */
function Chip({
  ativo,
  aoClicar,
  contagem,
  marcavel = false,
  children,
}: {
  ativo: boolean
  aoClicar: () => void
  contagem: number
  marcavel?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        ativo
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {marcavel && ativo && <Check className="size-3.5" aria-hidden="true" />}
      {children}
      <span className="tabular-nums opacity-60">{contagem}</span>
    </button>
  )
}
