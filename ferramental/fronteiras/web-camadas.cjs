/**
 * Fronteiras de camada — perfil web.
 *
 * A regra existe escrita no manual, mas manual é intenção. Aqui é porta: o CI
 * reprova o import antes de alguém precisar notar na revisão.
 *
 *   dominio     → não importa nada de fora de si (nem contrato de transporte,
 *                 nem framework de interface). É TypeScript puro e testável
 *                 sem subir nada.
 *   dados       → conhece o transporte. Não renderiza.
 *   components  → recebe dado por prop. Não busca, não conhece feature.
 *   features    → compõe domínio + componentes + dados.
 *
 * Cada regra deste arquivo tem prova em ferramental/fronteiras/provas/.
 * Regra sem prova não é porta — é regra que ninguém sabe se fecha.
 *
 * Ajuste `^src/` se a estrutura do projeto usar outro prefixo.
 */
module.exports = {
  forbidden: [
    {
      name: 'dominio-puro',
      comment:
        'domínio é TypeScript puro: sem framework de interface, sem cliente HTTP, sem componente. ' +
        'Se um teste de domínio precisa subir alguma coisa, a fronteira já está errada.',
      severity: 'error',
      from: { path: '^src/dominio' },
      to: {
        pathNot: '^src/dominio',
        path: '^(src/(components|features|dados|paginas)|node_modules/(react|react-dom|vue|svelte|@angular|axios|@tanstack|sonner|recharts))',
      },
    },
    {
      name: 'componente-nao-importa-feature',
      comment:
        'componente é reusável; feature compõe. O sentido é feature → componente. ' +
        'Invertido, o componente deixa de poder ser usado em outra feature.',
      severity: 'error',
      from: { path: '^src/components' },
      to: { path: '^src/features' },
    },
    {
      name: 'componente-nao-busca-dado',
      comment:
        'componente recebe dado por prop. Quem consulta é feature ou página — senão o ' +
        'componente deixa de ser testável e reusável, e todo teste dele passa a exigir servidor.',
      severity: 'error',
      from: { path: '^src/components(?!/ui/)' },
      to: { path: '^src/dados' },
    },
    {
      name: 'transporte-e-detalhe',
      comment:
        'só a camada de dados conhece o transporte. Componente e feature falam com a API ' +
        'do projeto, nunca com o cliente HTTP — senão trocar de transporte vira refactor global.',
      severity: 'error',
      from: { pathNot: '^src/dados' },
      to: { path: '^src/dados/(transporte|cliente)' },
    },
    {
      name: 'dados-nao-importa-ui',
      comment: 'a camada de dados não renderiza nada.',
      severity: 'error',
      from: { path: '^src/dados' },
      to: { path: '^src/(components|features|paginas)' },
    },
    {
      name: 'sem-ciclo',
      comment: 'ciclo de import funciona até parar de funcionar.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sem-orfao',
      comment: 'módulo que ninguém importa é código não revisado morando no repositório.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: '(^src/(main|index)\\.[jt]sx?$|\\.d\\.ts$|\\.test\\.[jt]sx?$|\\.config\\.[jt]s$)',
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.test\\.[jt]sx?$|^src/components/ui/)' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
