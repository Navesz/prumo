/**
 * The boundaries.
 *
 * A rule in a README is intent; a rule in CI is a door. Everything here is a door.
 *
 * Every rule in this file was born with a violation planted on purpose, run, and
 * seen to FAIL — then the violation was deleted. That ritual is not ceremony: the
 * `domain-pure` rule in the Herz repository was decorative from birth and spent
 * months printing "no dependency violations found" while React sat inside the
 * domain layer. A door that has never fired might be broken.
 *
 * `node ferramental/portao/provar-portao.mjs` re-runs that proof on demand.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'domain/ is arithmetic and rules. No network, no filesystem, no framework, and no npm package at all — a total denylist, not an allowlist by name. The Herz version listed forbidden packages one by one and therefore let zod, axios and provider SDKs straight through.',
      from: { path: '^apps/server/src/domain' },
      to: {
        pathNot: '^apps/server/src/domain',
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'core'],
      },
    },
    {
      name: 'domain-imports-nothing-else',
      severity: 'error',
      comment: 'domain/ may not reach into app/, db/, http/, security/ or the contract package.',
      from: { path: '^apps/server/src/domain' },
      to: { path: '^(apps/server/src/(app|db|http|security|providers|storage|vault)|packages)' },
    },
    {
      name: 'app-has-no-io',
      severity: 'error',
      comment:
        'This is the rule that mechanically enforces the most expensive invariant in the system: no external I/O inside a transaction. A transaction that restarts re-runs its body, and re-running a provider call generates the image twice and charges twice. An external effect has no rollback, so app/ is not allowed to hold the thing that performs one.',
      from: { path: '^apps/server/src/app' },
      to: {
        path: '^(apps/server/src/(db|http|security|providers|storage)|node_modules/(fastify|@fastify|kysely|pg|@orpc|undici|aws4fetch|sharp))',
      },
    },
    {
      name: 'app-has-no-node-io-core',
      severity: 'error',
      comment:
        'Same rule, the core-module half: fs, net, http and https do not belong in a use case.',
      from: { path: '^apps/server/src/app' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|node:fs|net|node:net|http|node:http|https|node:https|dgram|node:dgram|child_process|node:child_process)',
      },
    },
    {
      name: 'db-does-not-know-http',
      severity: 'error',
      comment: 'The data layer must not depend on how the request arrived.',
      from: { path: '^apps/server/src/db' },
      to: { path: '^apps/server/src/http' },
    },
    {
      name: 'providers-are-isolated',
      severity: 'error',
      comment:
        'A provider adapter talks to one vendor and returns plain data. It never reaches the database or the domain — otherwise every vendor quirk leaks into the model. (No adapters exist yet; the door is open before anyone walks through it.)',
      from: { path: '^apps/server/src/providers' },
      to: { path: '^apps/server/src/(db|domain|http|app)' },
    },
    {
      name: 'no-axios-anywhere',
      severity: 'error',
      comment:
        "axios is banned project-wide because of the key vault. Its error object carries config.headers, so a console.error(err) in a rare branch publishes a user's paid API key into the log. The HTTP client is fetch/undici.",
      from: {},
      to: { path: 'node_modules/axios' },
    },
    {
      name: 'contract-runs-in-a-browser',
      severity: 'error',
      comment:
        'packages/contract is imported by the browser bundle. A node core module in there breaks the build for the client, and it breaks it late.',
      from: { path: '^packages/contract' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle is how a change in one file starts costing a review of four.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nobody imports is either dead or a missing wire.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '^apps/server/src/main\\.ts$',
          '^apps/web/src/main\\.tsx$',
          '^apps/server/src/db/migrations/',
          // Wired through vitest.config.ts, which is not part of the graph.
          '^apps/server/tests/setup[.]ts$',
          '[.]config[.](ts|js|mjs|cjs)$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Anchored to OUR paths on purpose. A loose `(^|/)dist/` also matches
    // `node_modules/<pkg>/dist/...`, which is where almost every package's build
    // output lives — so every npm dependency vanishes from the graph and the
    // rules that forbid them (`domain-is-pure`, `no-axios-anywhere`) pass while
    // enforcing nothing. That is not hypothetical: it is what this config did
    // until `provar-portao.mjs` planted an import and the door failed to close.
    exclude: { path: '^(apps/[^/]+/(dist|coverage)|packages/[^/]+/dist|coverage|ferramental)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
