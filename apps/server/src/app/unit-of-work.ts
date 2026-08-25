import type { Repos } from './ports.js'

/**
 * One transaction per use case, and exactly one place that opens it.
 *
 * Saying "every write receives a trx" without saying WHO creates the trx is how
 * an assistant ends up opening transactions in three different files. So: no use
 * case calls `db.transaction()`. It calls `uow.run(...)`.
 *
 * This is also the only place that runs `SET LOCAL app.user_id`, which is what
 * makes row level security work. Scattering that would mean a repository could
 * run outside a scope and see everyone's rows.
 */

export type Scope =
  | { readonly kind: 'user'; readonly userId: string }
  /**
   * Registration and sign-in happen before a session exists, so no `app.user_id`
   * can be set. Exactly two use cases may ask for this, and a boundary rule plus
   * a test prove no third one does. It is deliberately noisy to write.
   */
  | { readonly kind: 'bootstrap'; readonly reason: 'register' | 'sign-in' }
  /**
   * Reading data nobody owns: the provider catalogue and the price index.
   *
   * Sets neither `app.user_id` nor the bypass flag, so if one of these queries
   * ever touches a table that DOES have row level security, it returns nothing
   * rather than everything. The failure mode of a mistake here is an empty page,
   * not a leak.
   */
  | { readonly kind: 'public' }

export interface UnitOfWork {
  run<T>(scope: Scope, fn: (repos: Repos) => Promise<T>): Promise<T>
}
