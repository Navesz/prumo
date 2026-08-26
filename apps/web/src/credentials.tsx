import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, newCommandId } from './api.js'

/**
 * The key screen.
 *
 * The warning at the top is not a disclaimer to be softened later. Prumo is a
 * vault whose security property is trust in the operator, not secrecy from the
 * operator, and the moment to say so is the moment somebody is about to paste a
 * key — not in a SECURITY.md they will never open.
 */

export const credentialKeys = {
  providers: ['providers'] as const,
  credentials: ['credentials'] as const,
}

export function Credentials() {
  const providers = useQuery({
    queryKey: credentialKeys.providers,
    queryFn: () => api.credential.providers(),
    staleTime: 5 * 60_000,
  })

  const credentials = useQuery({
    queryKey: credentialKeys.credentials,
    queryFn: () => api.credential.list(),
  })

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Suas chaves de API</h2>
        <p className="rounded border-l-2 border-(--color-teto-fg) bg-background p-3 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">
            Quem hospeda esta instância consegue ler as suas chaves.
          </strong>{' '}
          Elas são cifradas no banco, o que protege contra dump, backup vazado e réplica restaurada
          — e <strong className="text-foreground">não</strong> protege contra o servidor
          comprometido, porque a chave que abre tudo vive na mesma máquina. Se você não confia em
          quem opera esta instância, não cole uma chave aqui: suba a sua.
          <br />
          <br />
          Crie uma chave <strong className="text-foreground">dedicada ao Prumo</strong>, com limite
          de gasto no painel do provedor. O teto do Prumo não vale nada se a chave vazar: ela é
          usada direto na API do provedor.
        </p>
      </header>

      <AddKey providers={providers.data?.providers ?? []} />

      {credentials.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : credentials.data && credentials.data.credentials.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {credentials.data.credentials.map((credential) => (
            <StoredKey
              key={credential.id}
              credential={credential}
              notice={
                providers.data?.providers.find((p) => p.slug === credential.provider)?.notice ??
                null
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma chave guardada. Sem pelo menos uma, não há como gerar imagem.
        </p>
      )}
    </section>
  )
}

type Provider = Awaited<ReturnType<typeof api.credential.providers>>['providers'][number]
type Credential = Awaited<ReturnType<typeof api.credential.list>>['credentials'][number]
type Verification = Awaited<ReturnType<typeof api.credential.add>>['verification']

function AddKey({ providers }: { providers: Provider[] }) {
  const queryClient = useQueryClient()
  const [slug, setSlug] = useState('')
  const [secret, setSecret] = useState('')
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = providers.find((p) => p.slug === slug)

  const add = useMutation({
    retry: false,
    mutationFn: () =>
      api.credential.add({
        commandId: newCommandId(),
        provider: slug,
        secret,
        ...(label.trim() === '' ? {} : { label: label.trim() }),
      }),
    onSuccess: async (data) => {
      setError(null)
      setResult(data.verification)
      // The secret leaves component state the instant the request succeeds. It
      // was never in a query cache and it is not going into one now.
      setSecret('')
      await queryClient.invalidateQueries({ queryKey: credentialKeys.credentials })
    },
    onError: (cause: unknown) => {
      setResult(null)
      setError(cause instanceof Error ? cause.message : 'Não deu para guardar a chave.')
    },
  })

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (slug !== '' && secret !== '') add.mutate()
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Provedor</span>
        <select
          required
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value)
            setResult(null)
          }}
          className="w-full rounded border border-input bg-background px-3 py-2.5 text-sm"
        >
          <option value="">Escolha…</option>
          {providers.map((provider) => (
            <option key={provider.slug} value={provider.slug} disabled={!provider.active}>
              {provider.name}
              {provider.active ? '' : ' — desativado'}
            </option>
          ))}
        </select>
      </label>

      {chosen?.notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded bg-background p-2 text-xs text-(--color-teto-fg)"
        >
          {chosen.notice}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Chave</span>
        <input
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="cole aqui"
          className="w-full rounded border border-input bg-background px-3 py-2.5 font-mono text-sm"
        />
        <span className="text-xs text-muted-foreground">
          Ela é guardada cifrada e nunca volta para a tela — nem mascarada. Depois de salvar, só os
          quatro últimos caracteres aparecem.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Apelido (opcional)</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          className="w-full rounded border border-input bg-background px-3 py-2.5 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={add.isPending}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {add.isPending ? 'Guardando e conferindo…' : 'Guardar chave'}
      </button>

      {result && <VerificationNote verification={result} />}
      {error && (
        <p role="status" aria-live="polite" className="text-sm text-(--color-falha-fg)">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * Seven outcomes, and only one of them means "the key is wrong".
 *
 * Collapsing these into a tick and a cross is what makes a user spend an hour
 * debugging a perfectly good key because the provider had not finished verifying
 * their organization.
 */
function VerificationNote({ verification }: { verification: Verification }) {
  const notes: Record<Verification['status'], { text: string; tone: string }> = {
    valid: { text: 'Chave conferida: o provedor aceitou.', tone: 'text-(--color-pronto-fg)' },
    invalid: { text: 'O provedor recusou esta chave.', tone: 'text-(--color-falha-fg)' },
    no_credit: {
      text: 'A chave funciona, mas a conta está sem crédito no provedor.',
      tone: 'text-(--color-teto-fg)',
    },
    unverified_account: {
      text: 'A chave é válida, mas o provedor ainda não verificou a sua conta — não é erro de chave.',
      tone: 'text-(--color-teto-fg)',
    },
    rate_limited: {
      text: 'O provedor está limitando a taxa agora. A chave foi guardada; dá para conferir depois.',
      tone: 'text-(--color-espera-fg)',
    },
    unavailable: {
      text: 'O provedor não respondeu. A chave foi guardada e continua por conferir.',
      tone: 'text-(--color-espera-fg)',
    },
    no_probe: {
      text: 'Guardada. Este provedor não expõe um jeito barato de conferir uma chave, então ela fica por conferir até a primeira geração — em vez de mostrarmos um certo que não significa nada.',
      tone: 'text-(--color-espera-fg)',
    },
  }

  const note = notes[verification.status]

  return (
    <p role="status" aria-live="polite" className={`text-sm ${note.tone}`}>
      {note.text}
    </p>
  )
}

function StoredKey({ credential, notice }: { credential: Credential; notice: string | null }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const verify = useMutation({
    retry: false,
    mutationFn: () => api.credential.verify({ id: credential.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialKeys.credentials }),
  })

  const revoke = useMutation({
    retry: false,
    mutationFn: () => api.credential.revoke({ commandId: newCommandId(), id: credential.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialKeys.credentials }),
  })

  const status =
    credential.status === 'invalid'
      ? { label: 'recusada pelo provedor', tone: 'text-(--color-falha-fg)' }
      : credential.verifiedAt
        ? { label: 'conferida', tone: 'text-(--color-pronto-fg)' }
        : { label: 'por conferir', tone: 'text-(--color-espera-fg)' }

  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">
            {credential.provider}
            {credential.label ? ` · ${credential.label}` : ''}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            ····{credential.lastFour} · <span className={status.tone}>{status.label}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="min-h-10 rounded-lg border border-input px-3 text-sm disabled:opacity-60"
          >
            {verify.isPending ? 'Conferindo…' : 'Conferir'}
          </button>
          <button
            onClick={() => (confirming ? revoke.mutate() : setConfirming(true))}
            disabled={revoke.isPending}
            className="min-h-10 rounded-lg border border-input px-3 text-sm text-(--color-falha-fg) disabled:opacity-60"
          >
            {confirming ? 'Confirmar remoção' : 'Remover'}
          </button>
        </div>
      </div>

      {confirming && (
        <p role="status" aria-live="polite" className="text-xs text-(--color-teto-fg)">
          Isto remove a chave do Prumo e <strong>não</strong> a revoga no provedor. Se ela vazou,
          rotacione no painel do provedor — é o único conserto de verdade.
        </p>
      )}

      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

      {verify.data && <VerificationNote verification={verify.data.verification} />}
    </li>
  )
}
