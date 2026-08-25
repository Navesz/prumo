/**
 * The gate. One command decides whether the task is finished.
 *
 * It is born COMPLETE, on purpose. The Herz version was born without lint,
 * without format and without build, and nobody noticed for months — because a
 * gate you add later is a gate you add around code that already violates it, and
 * a gate that starts red gets switched off.
 *
 * ORDER MATTERS: cheapest first. The first failing step is the one reported as
 * "fix this first", because fixing it usually erases the ones below it.
 *
 * group 1 → seconds, always runs
 * group 2 → minutes, only runs if group 1 passed
 */
export default [
  {
    nome: 'instrucoes',
    comando: 'node .ai/gerar.mjs --verificar',
    dica: 'CLAUDE.md/AGENTS.md drifted from .ai/politica.md. Run `node .ai/gerar.mjs`. A guide that describes the wrong code is worse than no guide: the assistant follows the description and writes against reality, confidently.',
    extrair: /desatualizad|outdated|drift/i,
  },
  {
    nome: 'formato',
    comando: 'npx prettier --check .',
    dica: 'Run `npm run formato:corrigir`. None of your judgement is at stake here.',
    extrair: /^\[warn\]/,
  },
  {
    nome: 'controle',
    comando: 'node ferramental/controle/varrer-controle.mjs',
    dica: 'An invisible control character reached a source file — usually a `\\b` that lost an escape layer and became U+0008. The code still compiles, the regex stays valid, and it silently never matches again. Retype the line by hand; do not copy it.',
    extrair: /^error /,
  },
  {
    nome: 'segredo',
    comando: 'node ferramental/segredo/varrer-segredo.mjs',
    dica: "A secret is not fixed by a new commit — it has to be ROTATED at the provider first. This repository is about custody of other people's paid API keys; a leak here is somebody else's money.",
    extrair: /^\s*error\s/,
  },
  {
    nome: 'elos',
    comando: 'node ferramental/elos/verificar-elos.mjs',
    dica: 'A broken relative link in the docs. The assistant follows the reference, does not find it, and rewrites from scratch.',
    extrair: /^\s*error\s/,
  },
  {
    nome: 'tipos',
    comando: 'npx tsc -b',
    dica: 'A shape diverged. Start with the first file in the list — the rest are usually consequences.',
    extrair: /error TS\d+/,
    limite: 8,
  },
  {
    nome: 'lint',
    comando: 'npx oxlint --deny-warnings',
    extrair: /^\s*[✗x]|error|warning/i,
  },
  {
    nome: 'fronteiras',
    comando: 'npx depcruise apps packages --config .dependency-cruiser.cjs',
    dica: 'An import crossed a layer. The violated rule name is at the end of the line, and its `comment` says what breaks.',
    extrair: /^\s*(error|warn)\s/,
  },
  {
    nome: 'testes',
    comando: 'npx vitest run',
    grupo: 2,
    dica: 'The database suite needs Postgres: `docker compose up -d postgres`. It skips loudly rather than passing quietly.',
    extrair: /✗|×|FAIL|AssertionError|Error:/,
    limite: 12,
    tempoLimite: 5 * 60 * 1000,
  },
  {
    nome: 'build',
    comando: 'npm run build',
    grupo: 2,
    dica: 'It type-checks and still does not build. Usually a runtime-only import or a path that only exists in development.',
    extrair: /error|ERROR|failed/,
    tempoLimite: 5 * 60 * 1000,
  },
]
