import { sql, type Kysely } from 'kysely'

/**
 * The bootstrap policy migration 0001 forgot.
 *
 * Registration and sign-in run before a session exists, so they cannot set
 * `app.user_id`; they run under `app.bypass_rls` instead, and migration 0001
 * created a matching policy for `users`, `sessions` and `budgets` — and not for
 * `processed_commands`. Registration writes an idempotency record in that same
 * transaction, so every single sign-up failed with:
 *
 *     new row violates row-level security policy for table "processed_commands"
 *
 * Nothing caught it. The type checker cannot see a policy, the boundary rules
 * cannot see a policy, and the integration suite wrote to that table only from
 * inside a user scope, where the `_own` policy applies. It took starting the
 * application and pressing the button.
 *
 * The lesson is in `credentials.test.ts` now: the first use case a new user
 * touches gets an end-to-end test through the real code path, not through its
 * parts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE POLICY processed_commands_bootstrap ON processed_commands
      USING (current_setting('app.bypass_rls', true) = 'on')
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on')
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP POLICY IF EXISTS processed_commands_bootstrap ON processed_commands`.execute(db)
}
