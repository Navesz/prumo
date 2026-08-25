#!/usr/bin/env node
// Executor de verificação: roda a sequência declarada em verificar.config.mjs e
// devolve uma resposta binária, com saída curta o bastante para caber num
// contexto de IA sem custar uma leitura inteira.
//
// Zero dependência, de propósito: o que confere o build não pode depender do
// build. Roda com `node ferramental/verificar/verificar.mjs` em qualquer
// projeto com Node >= 18, antes de existir toolchain.
//
// Uso:
//   node verificar.mjs                 roda tudo
//   node verificar.mjs --passo=tipos   roda um passo só
//   node verificar.mjs --json          saída legível por máquina (telemetria)
//   node verificar.mjs --tudo          não para no primeiro grupo que reprova

import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const LIMITE_LINHAS_PADRAO = 6
const LARGURA_MAXIMA_LINHA = 160

const args = process.argv.slice(2)
const opcoes = {
  json: args.includes('--json'),
  tudo: args.includes('--tudo'),
  passo: args.find((a) => a.startsWith('--passo='))?.slice('--passo='.length),
  config: args.find((a) => a.startsWith('--config='))?.slice('--config='.length),
  // Grava o resultado em .ai/estado/ para a retomada de sessão saber em que pé
  // a árvore estava, sem precisar rodar tudo de novo.
  registrar: args.includes('--registrar'),
}

const cor = process.stdout.isTTY && !process.env.NO_COLOR && !opcoes.json
const c = {
  verde: (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s),
  vermelho: (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s),
  cinza: (s) => (cor ? `\x1b[90m${s}\x1b[0m` : s),
  forte: (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s),
}

// ── configuração ────────────────────────────────────────────────────────────

// A config declara os passos em ordem de custo crescente. Essa ordem não é
// estética: define qual falha é reportada como "conserte primeiro".
async function carregarConfig() {
  const candidatos = opcoes.config
    ? [opcoes.config]
    : ['verificar.config.mjs', 'verificar.config.js', '.alicerce/verificar.config.mjs']

  for (const caminho of candidatos) {
    const absoluto = resolve(process.cwd(), caminho)
    if (!existsSync(absoluto)) continue
    const modulo = await import(pathToFileURL(absoluto).href)
    const passos = modulo.default
    if (!Array.isArray(passos)) {
      throw new Error(`${caminho} precisa exportar um array de passos como default.`)
    }
    return { passos, origem: caminho }
  }

  throw new Error(
    `Nenhum verificar.config.mjs encontrado a partir de ${process.cwd()}.\n` +
      `Copie ferramental/verificar/verificar.config.exemplo.mjs para a raiz do projeto.`,
  )
}

// ── execução ────────────────────────────────────────────────────────────────

function executar(passo) {
  return new Promise((resolvePromessa) => {
    const inicio = Date.now()
    const filho = spawn(passo.comando, {
      shell: true,
      // Muita ferramenta enfeita a saída quando enxerga TTY, e o enfeite atrapalha
      // a extração de erro. Aqui a saída é sempre capturada, sempre crua.
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    let saida = ''
    let encerrado = false
    const limitarSaida = (pedaco) => {
      // Ferramenta que despeja megabytes existe. Guardar 1 MB já é mais que
      // suficiente para extrair as primeiras linhas de erro.
      if (saida.length < 1_000_000) saida += pedaco
    }

    filho.stdout.on('data', (d) => limitarSaida(String(d)))
    filho.stderr.on('data', (d) => limitarSaida(String(d)))

    const tempoLimite = passo.tempoLimite ?? 10 * 60 * 1000
    const relogio = setTimeout(() => {
      if (encerrado) return
      encerrado = true
      filho.kill('SIGKILL')
      resolvePromessa({
        codigo: 124,
        saida: saida + `\n[alicerce] tempo limite de ${tempoLimite} ms estourado`,
        duracaoMs: Date.now() - inicio,
      })
    }, tempoLimite)

    const finalizar = (codigo) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)
      resolvePromessa({ codigo, saida, duracaoMs: Date.now() - inicio })
    }

    filho.on('error', (e) => {
      saida += `\n[alicerce] falha ao executar: ${e.message}`
      finalizar(127)
    })
    filho.on('close', (codigo) => finalizar(codigo ?? 1))
  })
}

// ── extração de erro ────────────────────────────────────────────────────────

// A diferença entre 300 e 15 mil tokens por ciclo de correção está aqui. Uma
// ferramenta que reprova despejando 400 linhas de rastro de pilha custa uma
// leitura inteira de contexto; as mesmas 6 linhas certas custam quase nada.
const PADRAO_ERRO = /(^|\s)(error|erro|✗|✘|FAIL|failed|falhou)\b|error TS\d+|:\d+:\d+/i

function extrairErros(passo, saida) {
  const linhas = saida
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)

  let candidatas
  if (passo.extrair instanceof RegExp) {
    candidatas = linhas.filter((l) => passo.extrair.test(l))
  } else if (typeof passo.extrair === 'function') {
    candidatas = passo.extrair(linhas) ?? []
  } else {
    candidatas = linhas.filter((l) => PADRAO_ERRO.test(l))
  }

  // Sem padrão reconhecido, as últimas linhas costumam ser o resumo da
  // ferramenta — mais útil que as primeiras, que são banner.
  if (candidatas.length === 0) candidatas = linhas.slice(-LIMITE_LINHAS_PADRAO)

  const unicas = [...new Set(candidatas.map((l) => l.trim()))]
  const limite = passo.limite ?? LIMITE_LINHAS_PADRAO
  return {
    total: unicas.length,
    mostradas: unicas.slice(0, limite).map((l) =>
      l.length > LARGURA_MAXIMA_LINHA ? `${l.slice(0, LARGURA_MAXIMA_LINHA - 1)}…` : l,
    ),
  }
}

// ── relatório ───────────────────────────────────────────────────────────────

function duracao(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function relatar(resultados, duracaoTotal) {
  const reprovados = resultados.filter((r) => !r.ok && !r.opcional)
  const avisos = resultados.filter((r) => !r.ok && r.opcional)
  const aprovados = resultados.filter((r) => r.ok)

  const titulo = reprovados.length ? c.vermelho('REPROVADO') : c.verde('APROVADO')
  console.log(`\n${c.forte('VERIFICAR')} — ${titulo}  ${c.cinza(duracao(duracaoTotal))}\n`)

  for (const r of [...reprovados, ...avisos]) {
    const marca = r.opcional ? c.cinza('!') : c.vermelho('✗')
    const contagem = r.erros.total === 1 ? '1 erro' : `${r.erros.total} erros`
    console.log(`  ${marca} ${r.nome.padEnd(12)} ${contagem}`)
    for (const linha of r.erros.mostradas) console.log(`      ${linha}`)
    if (r.erros.total > r.erros.mostradas.length) {
      const resto = r.erros.total - r.erros.mostradas.length
      console.log(c.cinza(`      … mais ${resto}. Rode: node verificar.mjs --passo=${r.nome}`))
    }
    console.log('')
  }

  if (aprovados.length) {
    console.log(`  ${c.verde('✓')} ${aprovados.map((r) => r.nome).join(' · ')}\n`)
  }

  const naoExecutados = resultados.filter((r) => r.pulado)
  if (naoExecutados.length) {
    console.log(c.cinza(`  ⊘ não executados: ${naoExecutados.map((r) => r.nome).join(' · ')}\n`))
  }

  // A config declara os passos do mais barato ao mais caro, então o primeiro
  // que reprovou é o que se conserta primeiro — e consertar costuma apagar os
  // de baixo junto.
  if (reprovados.length) {
    const primeiro = reprovados[0]
    const dica = primeiro.dica ? ` ${primeiro.dica}` : ''
    console.log(`  ${c.forte('Primeiro:')} ${primeiro.nome}.${dica}`)
    if (reprovados.length > 1) {
      console.log(c.cinza(`  Os outros ${reprovados.length - 1} podem sumir junto.`))
    }
    console.log('')
  }
}

// ── principal ───────────────────────────────────────────────────────────────

async function principal() {
  const { passos, origem } = await carregarConfig()

  const selecionados = opcoes.passo ? passos.filter((p) => p.nome === opcoes.passo) : passos
  if (opcoes.passo && selecionados.length === 0) {
    console.error(`Passo "${opcoes.passo}" não existe em ${origem}.`)
    console.error(`Disponíveis: ${passos.map((p) => p.nome).join(', ')}`)
    process.exit(2)
  }

  const grupos = [...new Set(selecionados.map((p) => p.grupo ?? 1))].sort((a, b) => a - b)
  const resultados = []
  const inicio = Date.now()
  let abortar = false

  for (const grupo of grupos) {
    const doGrupo = selecionados.filter((p) => (p.grupo ?? 1) === grupo)

    if (abortar) {
      for (const p of doGrupo) {
        resultados.push({ nome: p.nome, ok: false, pulado: true, erros: { total: 0, mostradas: [] } })
      }
      continue
    }

    // Dentro do grupo tudo roda, mesmo com falha: ver as três falhas baratas de
    // uma vez é melhor que descobrir uma por ciclo.
    for (const passo of doGrupo) {
      // Progresso só em terminal: em log de CI o \r não apaga nada e as linhas
      // se acumulam, sujando exatamente a saída que este script existe para
      // manter curta.
      const mostrarProgresso = !opcoes.json && process.stdout.isTTY
      if (mostrarProgresso) process.stdout.write(c.cinza(`  … ${passo.nome}\r`))
      const { codigo, saida, duracaoMs } = await executar(passo)
      const ok = codigo === 0
      resultados.push({
        nome: passo.nome,
        ok,
        opcional: Boolean(passo.opcional),
        dica: passo.dica,
        duracaoMs,
        erros: ok ? { total: 0, mostradas: [] } : extrairErros(passo, saida),
      })
      if (mostrarProgresso) process.stdout.write(' '.repeat(40) + '\r')
    }

    // Grupo caro não roda sobre código que já não compila: seria minuto gasto
    // para reconfirmar o que o grupo barato já disse. `--tudo` desliga isso.
    const reprovouAqui = resultados.some((r) => !r.ok && !r.opcional && !r.pulado)
    if (reprovouAqui && !opcoes.tudo) abortar = true
  }

  const duracaoTotal = Date.now() - inicio
  const reprovou = resultados.some((r) => !r.ok && !r.opcional && !r.pulado)

  const relatorio = {
    resultado: reprovou ? 'reprovado' : 'aprovado',
    quando: new Date().toISOString().slice(0, 16).replace('T', ' '),
    duracaoMs: duracaoTotal,
    passos: resultados.map((r) => ({
      nome: r.nome,
      ok: r.ok,
      pulado: Boolean(r.pulado),
      duracaoMs: r.duracaoMs ?? 0,
      erros: r.erros.mostradas,
      totalErros: r.erros.total,
    })),
  }

  if (opcoes.registrar) {
    const destino = join(process.cwd(), '.ai', 'estado')
    mkdirSync(destino, { recursive: true })
    writeFileSync(join(destino, 'ultima-verificacao.json'), JSON.stringify(relatorio, null, 2))
  }

  if (opcoes.json) {
    console.log(JSON.stringify(relatorio, null, 2))
  } else {
    relatar(resultados, duracaoTotal)
  }

  process.exit(reprovou ? 1 : 0)
}

principal().catch((e) => {
  console.error(`\n${c.vermelho('VERIFICAR — ERRO DE CONFIGURAÇÃO')}\n\n  ${e.message}\n`)
  process.exit(2)
})
