// Declaração dos passos de verificação do projeto.
//
// A ORDEM É SIGNIFICATIVA: do mais barato para o mais caro. O primeiro passo que
// reprova é reportado como "conserte primeiro", porque consertá-lo costuma
// apagar os de baixo junto.
//
// grupo 1 → rápido, roda sempre e tudo junto (segundos)
// grupo 2 → caro, só roda se o grupo 1 passou (minutos)
//
// Campos por passo:
//   nome         curto, vira `--passo=<nome>`
//   comando      linha de shell
//   grupo        1 (padrão) ou 2
//   dica         uma frase mostrada quando este passo é o primeiro a reprovar
//   extrair      RegExp ou função(linhas) → linhas de erro a mostrar
//   limite       quantas linhas de erro mostrar (padrão 6)
//   tempoLimite  ms (padrão 10 min)
//   opcional     true → reprova como aviso, não derruba o resultado

export default [
  {
    nome: 'formato',
    comando: 'npx prettier --check .',
    dica: 'Rode `npx prettier --write .` — nenhuma decisão sua está em jogo aqui.',
    extrair: /^\[warn\]/,
  },
  {
    nome: 'lint',
    comando: 'npx oxlint',
    extrair: /^\s*[✗x]|error|warning/i,
  },
  {
    nome: 'tipos',
    comando: 'npx tsc -b',
    dica: 'Divergência de forma. Comece pelo primeiro arquivo da lista.',
    extrair: /error TS\d+/,
    limite: 8,
  },
  {
    nome: 'fronteiras',
    comando: 'npx depcruise src --config .dependency-cruiser.cjs',
    dica: 'Um import cruzou camada. O nome da regra violada está no fim da linha.',
    extrair: /^\s*(error|warn)\s/,
  },
  {
    nome: 'segredo',
    comando: 'node ferramental/segredo/varrer-segredo.mjs',
    dica: 'Segredo no repositório não se corrige com commit novo — precisa rotacionar.',
  },
  {
    nome: 'testes',
    comando: 'npx vitest run',
    grupo: 2,
    extrair: /^\s*(FAIL|×|✗|AssertionError|Error:)/,
    limite: 10,
  },
  {
    nome: 'build',
    comando: 'npm run build',
    grupo: 2,
    tempoLimite: 5 * 60 * 1000,
  },

  // Passos de grupo 2 que só existem quando o projeto os adotou na fase 0.
  // Deixe comentado o que não se aplica — passo declarado e sempre pulado vira
  // ruído, e ruído ensina a ignorar a saída.
  //
  // { nome: 'integracao', comando: 'npx vitest run -c vitest.integracao.ts', grupo: 2 },
  // { nome: 'migration',  comando: 'npm run migration:provar',              grupo: 2 },
  // { nome: 'e2e',        comando: 'npx playwright test',                   grupo: 2 },
  // { nome: 'a11y',       comando: 'npm run a11y',                          grupo: 2, opcional: true },
]
