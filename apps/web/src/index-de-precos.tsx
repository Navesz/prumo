import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from './api.js'

/**
 * The price index, and the first thing anybody sees.
 *
 * No account, no key. Handing a service an API key is a decision, and nobody
 * should have to make it before seeing a single price — which is exactly what the
 * previous version of this screen asked for, and why it was wrong.
 *
 * One table with every combination of model and provider, cheapest first, because
 * the fact worth paying for is that the SAME model costs different amounts in
 * different places.
 */

type Entry = Awaited<ReturnType<typeof api.catalog.index>>['entries'][number]

export function PriceIndex() {
  const [provider, setProvider] = useState('')
  const [search, setSearch] = useState('')
  const [ceiling, setCeiling] = useState('')
  const [showUnpriced, setShowUnpriced] = useState(false)

  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.catalog.index({ width: 1024, height: 1024, steps: 25 }),
    staleTime: 5 * 60_000,
  })

  const entries = catalog.data?.entries ?? []

  const providers = useMemo(() => {
    const names = new Map<string, string>()
    for (const entry of entries) names.set(entry.provider, entry.providerName)
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const cap = ceiling.trim() === '' ? null : Number(ceiling) * 1e9

    return entries.filter((entry) => {
      if (provider !== '' && entry.provider !== provider) return false
      if (needle !== '' && !`${entry.name} ${entry.family ?? ''}`.toLowerCase().includes(needle)) {
        return false
      }
      if (entry.costNanoUsd === null) return showUnpriced && cap === null
      if (cap !== null && Number(entry.costNanoUsd) > cap) return false
      return true
    })
  }, [entries, provider, search, ceiling, showUnpriced])

  const priced = entries.filter((e) => e.costNanoUsd !== null).length

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Preço por imagem, 1024×1024</h2>
        <p className="text-xs text-(--color-ink-muted)">
          Todos os provedores e modelos, do mais barato para o mais caro, sem precisar de conta nem
          de chave. Coletado das APIs públicas de cada um — cada linha diz de onde veio e quando.
          Você põe chave só nos que valerem a pena.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-ink-muted)">Provedor</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="rounded border border-(--color-line) bg-(--color-ground) px-2 py-1.5 text-sm"
          >
            <option value="">todos</option>
            {providers.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-ink-muted)">Modelo</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="flux, seedream…"
            className="w-40 rounded border border-(--color-line) bg-(--color-ground) px-2 py-1.5 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-ink-muted)">Até US$</span>
          <input
            inputMode="decimal"
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            placeholder="0.01"
            className="w-24 rounded border border-(--color-line) bg-(--color-ground) px-2 py-1.5 text-right font-mono text-sm tabular-nums"
          />
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-xs text-(--color-ink-muted)">
          <input
            type="checkbox"
            checked={showUnpriced}
            onChange={(event) => setShowUnpriced(event.target.checked)}
          />
          mostrar os sem preço publicado
        </label>
      </div>

      {catalog.isPending ? (
        <p className="text-sm text-(--color-ink-muted)">Carregando o índice…</p>
      ) : catalog.isError ? (
        <p className="text-sm text-(--color-state-failed)">
          Não deu para carregar o índice. O servidor respondeu com erro.
        </p>
      ) : (
        <>
          <p className="font-mono text-xs text-(--color-ink-muted)">
            {filtered.length} de {entries.length} linhas · {priced} com preço comparável ·{' '}
            {entries.length - priced} sem preço publicado pelo provedor
          </p>

          <div className="overflow-x-auto rounded border border-(--color-line)">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-(--color-line) text-left">
                  <Th className="text-right">US$ / imagem</Th>
                  <Th>Provedor</Th>
                  <Th>Modelo</Th>
                  <Th>Como é cobrado</Th>
                  <Th>Fonte</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((entry) => (
                  <Row key={entry.modelId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > 300 && (
            <p className="text-xs text-(--color-ink-muted)">
              Mostrando as 300 primeiras de {filtered.length}. Filtre para chegar no que interessa.
            </p>
          )}

          {catalog.data && catalog.data.providersWithoutMachineReadablePrices.length > 0 && (
            <p className="rounded border-l-2 border-(--color-state-queued) bg-(--color-surface) p-3 text-xs text-(--color-ink-muted)">
              <strong className="text-(--color-ink)">O que ainda não está aqui.</strong> Estes
              provedores não publicam preço em nenhum formato que uma máquina leia:{' '}
              {catalog.data.providersWithoutMachineReadablePrices.join(', ')}. Os preços deles
              entram à mão, por pull request, com a URL da fonte e a data. Uma tabela que mostra só
              o que é fácil de coletar se lê como “estes são todos os preços que existem”.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium tracking-wide text-(--color-ink-muted) ${className}`}
    >
      {children}
    </th>
  )
}

function Row({ entry }: { entry: Entry }) {
  // Always six decimals. A price column where one row shows 0.000200 and the next
  // shows 0.0100 cannot be scanned down: the eye compares digit positions, not
  // values, and the cheapest row stops looking cheapest.
  const price = entry.costNanoUsd === null ? null : (Number(entry.costNanoUsd) / 1e9).toFixed(6)

  return (
    <tr className="border-b border-(--color-line) last:border-b-0 align-top">
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {price === null ? (
          // Never a blank cell: an empty price reads as "free" or as a bug, and
          // the reason is the useful part.
          <span className="text-xs text-(--color-ink-muted)" title={entry.explanation}>
            não comparável
          </span>
        ) : (
          <span className={entry.fresh ? '' : 'text-(--color-state-capped)'}>{price}</span>
        )}
      </td>
      <td className="px-3 py-2">{entry.provider}</td>
      <td className="px-3 py-2">
        <span>{entry.name}</span>
        {entry.watermark === 'synthid' && (
          <span
            className="ml-2 text-xs text-(--color-state-capped)"
            title="Toda imagem sai com marca d'água SynthID: invisível, permanente, não opcional."
          >
            SynthID
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-(--color-ink-muted)">
        {entry.basis ?? '—'}
        {entry.note && <span className="block">{entry.note}</span>}
      </td>
      <td className="px-3 py-2 text-xs text-(--color-ink-muted)">
        {entry.collectedAt ? (
          <>
            {entry.method} · {new Date(entry.collectedAt).toLocaleDateString('pt-BR')}
            {!entry.fresh && (
              <span className="block text-(--color-state-capped)">
                acima de 30 dias — fora do ranking
              </span>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  )
}
