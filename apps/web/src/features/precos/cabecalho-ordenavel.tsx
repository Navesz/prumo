import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { Coluna, Ordem } from './agrupar.js'

/**
 * Ordenar clicando na coluna — a funcionalidade que a tabela fingia ter.
 *
 * O cabeçalho antigo trazia uma seta LITERAL escrita no texto ("Mil imagens ↑")
 * e um `aria-sort="ascending"` fixo no `<th>`. Ou seja: anunciava uma ordenação
 * que ninguém podia mudar, e anunciava a mesma para sempre mesmo quando a lista
 * mudava. Prometer interação que não existe é pior do que não prometer.
 *
 * O `aria-sort` vai no `<th>` e não no botão — é a célula que carrega o estado da
 * coluna para o leitor de tela. O ícone diz o estado ATUAL; o `title` diz o que
 * o próximo clique faz, porque "crescente" não significa a mesma coisa em texto
 * e em preço.
 */

const PROXIMA: Record<Coluna, { asc: string; desc: string }> = {
  modelo: { asc: 'de A a Z', desc: 'de Z a A' },
  preco: { asc: 'do mais barato', desc: 'do mais caro' },
  fator: { asc: 'da menor diferença', desc: 'da maior diferença' },
}

export function CabecalhoOrdenavel({
  coluna,
  ordem,
  aoOrdenar,
  children,
  className,
  alinharDireita = false,
}: {
  coluna: Coluna
  ordem: Ordem
  aoOrdenar: (coluna: Coluna) => void
  children: React.ReactNode
  className?: string
  alinharDireita?: boolean
}) {
  const ativa = ordem.coluna === coluna
  const Icone = !ativa ? ChevronsUpDown : ordem.desc ? ArrowDown : ArrowUp

  // Clicar na coluna ativa inverte; clicar numa nova começa pelo padrão dela.
  const proximaDesc = ativa ? !ordem.desc : coluna !== 'modelo'
  const rotulo = PROXIMA[coluna][proximaDesc ? 'desc' : 'asc']

  return (
    <TableHead
      aria-sort={ativa ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
      className={cn('h-auto px-2 py-2', className)}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => aoOrdenar(coluna)}
        title={`Ordenar ${rotulo}`}
        className={cn(
          '-mx-2 h-8 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground',
          ativa && 'text-foreground',
          alinharDireita && 'ml-auto flex-row-reverse',
        )}
      >
        {children}
        <Icone
          className={cn('size-3.5', ativa ? 'text-primary' : 'opacity-50')}
          aria-hidden="true"
        />
        <span className="sr-only">
          {ativa
            ? `, ordenado ${ordem.desc ? 'decrescente' : 'crescente'}`
            : ', não ordenado por esta coluna'}
        </span>
      </Button>
    </TableHead>
  )
}
