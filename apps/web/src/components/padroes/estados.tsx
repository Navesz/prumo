import { CircleAlert, RotateCw, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Os quatro estados que toda tela tem e quase nenhuma escreve.
 *
 * Estavam improvisados em três arquivos, cada um com um texto e nenhum com saída.
 * Vazio POR AUSÊNCIA e vazio POR FILTRO são coisas diferentes — numa tela com
 * quatro filtros, é a diferença entre "não existe" e "você filtrou demais", e só
 * a segunda tem botão.
 */

export function Carregando({ linhas = 8 }: { linhas?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o índice de preços…</span>
      {/* Esqueleto com a FORMA do conteúdo, não um giro genérico: a pessoa
          entende o que vai chegar antes de chegar. */}
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-border p-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}

export function EstadoErro({
  titulo,
  detalhe,
  aoTentarNovamente,
}: {
  titulo: string
  detalhe: string
  aoTentarNovamente?: () => void
}) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{titulo}</AlertTitle>
      <AlertDescription>{detalhe}</AlertDescription>
      {aoTentarNovamente && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={aoTentarNovamente}>
            <RotateCw />
            Tentar de novo
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

export function EstadoVazio({
  titulo,
  detalhe,
  acao,
}: {
  titulo: string
  detalhe: ReactNode
  acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-input px-6 py-14 text-center">
      <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="max-w-md text-xs text-muted-foreground">{detalhe}</p>
      </div>
      {acao}
    </div>
  )
}
