/**
 * Fronteiras de camada — perfil API.
 *
 *   domain/  regra de negócio pura. Não importa framework, banco, contrato de
 *            transporte nem nada de infraestrutura.
 *   app/     casos de uso. Recebe a unidade de trabalho; nunca a instância do
 *            banco. Não conhece HTTP.
 *   http/    só traduz: recebe, chama caso de uso, responde.
 *   db/      acesso a dados. Nenhuma regra de negócio.
 *
 * A regra `sem-io-externo-no-caso-de-uso` é a que mais paga: efeito externo
 * dentro de transação não tem rollback, e o retry o executa de novo. Tudo que
 * sai do banco nasce na outbox e acontece depois do commit (invariante 7).
 *
 * Cada regra tem prova em ferramental/fronteiras/provas/.
 */
module.exports = {
  forbidden: [
    {
      name: 'dominio-puro',
      comment:
        'domínio não conhece framework, banco nem transporte. É o que permite testá-lo ' +
        'sem container e o que mantém a regra de negócio auditável.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        pathNot: '^src/domain',
        path: '^(src/(app|http|db)|node_modules/(fastify|express|koa|@nestjs|kysely|knex|typeorm|sequelize|@prisma|mongoose|pg|mysql2|tedious|mssql|redis|ioredis))',
      },
    },
    {
      name: 'caso-de-uso-nao-conhece-http',
      comment:
        'app/ não sabe que existe HTTP. Se soubesse, o mesmo caso de uso não poderia ser ' +
        'chamado por job, fila ou CLI sem arrastar o framework junto.',
      severity: 'error',
      from: { path: '^src/app' },
      to: { path: '^(src/http|node_modules/(fastify|express|koa|@nestjs))' },
    },
    {
      name: 'http-nao-acessa-banco',
      comment:
        'a camada HTTP traduz e delega. Consulta direta na rota é a forma mais comum de ' +
        'regra de negócio nascer fora do domínio.',
      severity: 'error',
      from: { path: '^src/http' },
      to: { path: '^src/db(?!/tipos)' },
    },
    {
      name: 'sem-io-externo-no-caso-de-uso',
      comment:
        'nada de I/O externo dentro da transação: efeito externo não tem rollback e o retry ' +
        'o executa de novo. Use a outbox — o efeito acontece depois do commit.',
      severity: 'error',
      from: { path: '^src/(domain|app)' },
      to: {
        path: '^node_modules/(axios|node-fetch|undici|got|nodemailer|@sendgrid|@aws-sdk|aws-sdk)$|^(fs|node:fs|child_process|node:child_process|dgram|node:dgram)$',
      },
    },
    {
      name: 'banco-sem-regra-de-negocio',
      comment:
        'db/ é acesso a dados. Importar domínio aqui é o primeiro passo para a regra de ' +
        'negócio se espalhar entre repositório e caso de uso.',
      severity: 'error',
      from: { path: '^src/db' },
      to: { path: '^src/(domain|app|http)' },
    },
    {
      name: 'contrato-sem-node',
      comment:
        'o pacote de contrato é importado pelo bundle do navegador. Qualquer módulo nativo ' +
        'do Node aqui quebra o build do cliente — e só na hora de empacotar.',
      severity: 'error',
      from: { path: '^(packages/contracts|src/contracts)' },
      to: { dependencyTypes: ['core'] },
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
        pathNot: '(^src/(main|index|servidor)\\.[jt]s$|\\.d\\.ts$|\\.test\\.[jt]s$|\\.config\\.[jt]s$|^src/db/migrations/)',
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.[jt]s$' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require'],
      extensions: ['.js', '.ts'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
