import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, formatUsd, newCommandId } from './api.js'
import { Credentials } from './credentials.js'
import { PriceIndex } from './index-de-precos.js'

/**
 * The shape of the product, in the order a person actually needs it.
 *
 * First the prices, with no account and no key: that is what tells you which
 * providers are worth opening an account with. Keys and spending caps live under
 * Settings, behind a sign-in, because they are what you do AFTER deciding.
 *
 * The previous version had this backwards — the first thing on screen was a form
 * asking for an API key, before giving anybody a reason to hand one over.
 */

const keys = {
  me: ['me'] as const,
  budgets: ['budgets'] as const,
}

type Screen = 'index' | 'settings'

export function App() {
  const [screen, setScreen] = useState<Screen>('index')

  const session = useQuery({
    queryKey: keys.me,
    queryFn: () => api.auth.me(),
    refetchOnWindowFocus: true,
  })

  const user = session.data?.user ?? null

  return (
    <div className="min-h-dvh px-5 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">Prumo</h1>
              <span className="font-mono text-xs text-(--color-brass)">M3</span>
            </div>
            <p className="max-w-xl text-sm text-(--color-ink-muted)">
              O preço real de gerar imagem com IA. Nenhuma geração existe ainda — é o próximo marco.
            </p>
          </div>

          <nav className="flex items-center gap-2 text-sm">
            <Tab active={screen === 'index'} onClick={() => setScreen('index')}>
              Preços
            </Tab>
            <Tab active={screen === 'settings'} onClick={() => setScreen('settings')}>
              Configurações
            </Tab>
          </nav>
        </header>

        {screen === 'index' ? (
          <PriceIndex />
        ) : user ? (
          <Settings user={user} />
        ) : (
          <SignedOut registrationOpen={session.data?.registrationOpen ?? false} />
        )}
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-(--color-line) bg-(--color-surface) p-5">
      {children}
    </section>
  )
}

function Settings({ user }: { user: { email: string; role: string; timezone: string } }) {
  const queryClient = useQueryClient()

  const budgets = useQuery({ queryKey: keys.budgets, queryFn: () => api.budget.list() })

  const signOut = useMutation({
    retry: false,
    mutationFn: () => api.auth.signOut(),
    onSuccess: () => queryClient.invalidateQueries(),
  })

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm">{user.email}</p>
            <p className="font-mono text-xs text-(--color-ink-muted)">
              {user.role} · {user.timezone}
            </p>
          </div>
          <button
            onClick={() => signOut.mutate()}
            className="rounded border border-(--color-line) px-3 py-1.5 text-sm"
          >
            Sair
          </button>
        </div>
      </Panel>

      <Credentials />

      <Panel>
        <h2 className="mb-1 text-sm font-medium">Tetos de gasto</h2>
        <p className="mb-4 text-xs text-(--color-ink-muted)">
          Uma conta nova começa com teto zero. Nada é gasto até alguém escrever um número — o
          contrário seria um sistema que gasta dinheiro que ninguém autorizou.
        </p>

        {budgets.isPending ? (
          <p className="text-sm text-(--color-ink-muted)">Carregando…</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {budgets.data?.budgets.map((budget) => (
              <BudgetRow key={budget.period} budget={budget} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function SignedOut({ registrationOpen }: { registrationOpen: boolean }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'sign-in' | 'register'>(
    registrationOpen ? 'register' : 'sign-in',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    retry: false,
    mutationFn: async () => {
      if (mode === 'register') {
        return api.auth.register({
          commandId: newCommandId(),
          email,
          password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }
      return api.auth.signIn({ email, password })
    },
    onSuccess: async () => {
      setError(null)
      await queryClient.invalidateQueries()
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Algo falhou. Tente de novo.')
    },
  })

  return (
    <Panel>
      <p className="mb-4 text-xs text-(--color-ink-muted)">
        A conta serve para guardar chave e teto de gasto. O índice de preços continua aberto sem
        ela.
      </p>

      <div className="mb-4 flex gap-2 text-sm">
        {registrationOpen && (
          <Tab active={mode === 'register'} onClick={() => setMode('register')}>
            Criar conta
          </Tab>
        )}
        <Tab active={mode === 'sign-in'} onClick={() => setMode('sign-in')}>
          Entrar
        </Tab>
      </div>

      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit.mutate()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-ink-muted)">E-mail</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border border-(--color-line) bg-(--color-ground) px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--color-ink-muted)">Senha</span>
          <input
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-(--color-line) bg-(--color-ground) px-3 py-2 text-sm"
          />
          <span className="text-xs text-(--color-ink-muted)">Mínimo de 12 caracteres.</span>
        </label>

        <button
          type="submit"
          disabled={submit.isPending}
          className="mt-1 rounded bg-(--color-brass) px-4 py-2 text-sm font-medium text-(--color-ground) disabled:opacity-60"
        >
          {submit.isPending ? 'Enviando…' : mode === 'register' ? 'Criar conta' : 'Entrar'}
        </button>

        {error && (
          <p role="status" aria-live="polite" className="text-sm text-(--color-state-failed)">
            {error}
          </p>
        )}
      </form>
    </Panel>
  )
}

function BudgetRow({
  budget,
}: {
  budget: {
    period: 'month' | 'day'
    capNanoUsd: string
    spentNanoUsd: string
    reservedNanoUsd: string
  }
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const save = useMutation({
    retry: false,
    mutationFn: (usd: string) =>
      api.budget.setCap({
        commandId: newCommandId(),
        period: budget.period,
        capNanoUsd: usdToNano(usd),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.budgets }),
  })

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-(--color-line) pt-3 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm">{budget.period === 'month' ? 'Mês' : 'Dia'}</p>
        <p className="font-mono text-xs text-(--color-ink-muted)">
          gasto {formatUsd(budget.spentNanoUsd)} · reservado {formatUsd(budget.reservedNanoUsd)} ·
          teto {formatUsd(budget.capNanoUsd)}
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim() !== '') save.mutate(draft.trim())
        }}
      >
        <input
          inputMode="decimal"
          placeholder="10.00"
          aria-label={`Novo teto em dólares para ${budget.period === 'month' ? 'o mês' : 'o dia'}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-24 rounded border border-(--color-line) bg-(--color-ground) px-2 py-1 text-right font-mono text-sm tabular-nums"
        />
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded border border-(--color-line) px-3 py-1 text-sm disabled:opacity-60"
        >
          Salvar
        </button>
      </form>
    </li>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded bg-(--color-line) px-3 py-1.5'
          : 'rounded px-3 py-1.5 text-(--color-ink-muted)'
      }
    >
      {children}
    </button>
  )
}

/** "10.50" → "10500000000". No float ever enters the pipeline. */
function usdToNano(usd: string): string {
  const match = /^(\d+)(?:[.,](\d{1,9}))?$/.exec(usd)
  if (!match) throw new Error('Escreva um valor como 10.50')

  const whole = BigInt(match[1] ?? '0')
  const fraction = BigInt((match[2] ?? '').padEnd(9, '0'))

  return (whole * 1_000_000_000n + fraction).toString(10)
}
