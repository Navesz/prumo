#!/usr/bin/env node
// Camada de contexto: o estado do trabalho mora no repositório, não na conversa.
//
// O problema que isto resolve: quando a conversa é a única memória, retomar
// custa reler tudo, e compactar uma sessão grande custa mais que a tarefa.
// Invariantes 20 e 21 — decisão importante vira estado gravado, e a conversa
// não é fonte de verdade.
//
// Zero dependência. Comandos:
//
//   ai.mjs iniciar "<objetivo>"   abre tarefa, grava o commit de base
//   ai.mjs retomar                imprime o pacote de retomada de sessão
//   ai.mjs encerrar               arquiva a tarefa em concluidas/ e limpa
//   ai.mjs orcamento              mede o custo do pacote e reprova se estourar
//   ai.mjs estado                 uma linha: há tarefa aberta?

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const AI = join(RAIZ, '.ai')
const ESTADO = join(AI, 'estado')
const TAREFA = join(ESTADO, 'tarefa-ativa.md')
const BASE = join(ESTADO, 'base.json')
const VERIFICACAO = join(ESTADO, 'ultima-verificacao.json')
const CONCLUIDAS = join(AI, 'concluidas')
const NUCLEO = join(AI, 'NUCLEO.md')
const MODELOS = join(dirname(fileURLToPath(import.meta.url)), 'modelos')

// Estimativa, não contagem: tokenizador de verdade é dependência, e o objetivo
// aqui é ordem de grandeza para decidir se o pacote cabe. Português tokeniza um
// pouco pior que inglês; 3,5 caracteres por token é o lado conservador.
const CARACTERES_POR_TOKEN = 3.5
const emTokens = (texto) => Math.round(texto.length / CARACTERES_POR_TOKEN)

const ORCAMENTO_PADRAO = { nucleo: 1500, retomada: 5000, concluida: 600 }

function orcamento() {
  const caminho = join(AI, 'orcamento.json')
  if (!existsSync(caminho)) return ORCAMENTO_PADRAO
  return { ...ORCAMENTO_PADRAO, ...JSON.parse(readFileSync(caminho, 'utf8')) }
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const ler = (caminho) => (existsSync(caminho) ? readFileSync(caminho, 'utf8') : '')

const hoje = () => git('log', '-1', '--format=%cs') || 'sem-data'

function apelido(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas de acento separadas pelo NFD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-[^-]*$/, '') // corta na palavra inteira, não no meio dela
}

// Os modelos trazem comentário HTML explicando como preenchê-los. Isso é para
// quem escreve, não para quem lê depois — e o arquivo gerado tem orçamento.
const semInstrucoes = (texto) => texto.replace(/<!--[\s\S]*?-->\n?/g, '').replace(/\n{3,}/g, '\n\n')

// ── iniciar ─────────────────────────────────────────────────────────────────

function iniciar(objetivo) {
  if (!objetivo) {
    console.error('Uso: ai.mjs iniciar "<objetivo em uma frase>"')
    process.exit(2)
  }
  if (existsSync(TAREFA)) {
    console.error(
      'Já existe tarefa aberta. Uma por vez — é o que mantém o contexto pequeno.\n' +
        'Encerre com: ai.mjs encerrar',
    )
    process.exit(1)
  }

  mkdirSync(ESTADO, { recursive: true })
  const modelo = ler(join(MODELOS, 'tarefa-ativa.md'))
  writeFileSync(TAREFA, modelo.replace('{{OBJETIVO}}', objetivo))

  // O commit de base é o que permite, no encerramento, dizer o que esta tarefa
  // mudou — sem depender de ninguém ter anotado.
  writeFileSync(
    BASE,
    JSON.stringify({ objetivo, commit: git('rev-parse', 'HEAD'), aberta: hoje() }, null, 2),
  )
  console.log(`Tarefa aberta: ${objetivo}`)
  console.log(`Descreva o resto em ${TAREFA.replace(RAIZ + '/', '')}`)
}

// ── retomar ─────────────────────────────────────────────────────────────────

// O pacote que uma sessão nova precisa ler, e nada além. Tudo que estiver aqui
// é pago em toda retomada; tudo que não estiver continua acessível sob demanda,
// no Git e em .ai/concluidas.
function montarRetomada() {
  const partes = []
  const projeto = ler(NUCLEO)

  partes.push(projeto || '# (sem .ai/NUCLEO.md — rode: ai.mjs iniciar)')

  const tarefa = ler(TAREFA)
  partes.push(
    tarefa
      ? `\n---\n\n${tarefa}`
      : '\n---\n\n## Tarefa ativa\n\nNenhuma. Abra com `ai.mjs iniciar "<objetivo>"`.',
  )

  const recentes = git('log', '-5', '--format=%h %s')
  const sujos = git('status', '--porcelain')
  const listaSuja = sujos
    .split('\n')
    .filter(Boolean)
    .map((l) => `  ${l}`)
    .slice(0, 20)

  partes.push(
    '\n---\n\n## Git\n\n```\n' +
      (recentes || '(sem commits)') +
      '\n```\n' +
      (listaSuja.length
        ? `\nNão commitado (${sujos.split('\n').filter(Boolean).length} arquivos):\n\`\`\`\n${listaSuja.join('\n')}\n\`\`\`\n`
        : '\nÁrvore limpa.\n'),
  )

  if (existsSync(VERIFICACAO)) {
    const v = JSON.parse(ler(VERIFICACAO))
    const falhos = (v.passos ?? []).filter((p) => !p.ok && !p.pulado).map((p) => p.nome)
    partes.push(
      `\n---\n\n## Última verificação\n\n${v.resultado.toUpperCase()} — ${v.quando ?? 'sem data'}` +
        (falhos.length ? `\nReprovaram: ${falhos.join(', ')}` : '') +
        '\n',
    )
  } else {
    partes.push('\n---\n\n## Última verificação\n\nNão registrada nesta árvore. Rode `verificar`.\n')
  }

  const concluidas = existsSync(CONCLUIDAS) ? readdirSync(CONCLUIDAS).filter((f) => f.endsWith('.md')) : []
  if (concluidas.length) {
    partes.push(
      `\n---\n\n## Memória\n\n${concluidas.length} tarefas concluídas em \`.ai/concluidas/\`. ` +
        `Não leia todas: procure por nome quando precisar do porquê de algo.\n` +
        `Últimas: ${concluidas.sort().slice(-5).join(' · ')}\n`,
    )
  }

  return partes.join('')
}

// ── encerrar ────────────────────────────────────────────────────────────────

function encerrar() {
  if (!existsSync(TAREFA)) {
    console.error('Nenhuma tarefa aberta.')
    process.exit(1)
  }

  const base = existsSync(BASE) ? JSON.parse(ler(BASE)) : {}
  const tarefa = ler(TAREFA)
  const objetivo = base.objetivo ?? (tarefa.match(/^#\s+(.+)$/m)?.[1] ?? 'tarefa')

  const alterados = base.commit
    ? git('diff', '--name-only', base.commit, 'HEAD').split('\n').filter(Boolean)
    : []
  const commits = base.commit
    ? git('log', '--format=%h %s', `${base.commit}..HEAD`).split('\n').filter(Boolean)
    : []

  const verificacao = existsSync(VERIFICACAO)
    ? JSON.parse(ler(VERIFICACAO)).resultado
    : 'não registrada'

  // O que sobrevive da tarefa: decisões e o que já foi tentado e não funcionou.
  // A segunda parte é a que a compactação sempre perde, e é a que faz a sessão
  // seguinte repetir o mesmo caminho morto.
  const secao = (titulo) => {
    const achado = tarefa.match(new RegExp(`##\\s+${titulo}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'))
    const corpo = (achado?.[1] ?? '').trim()
    return corpo && !/^_?\(?nenhum/i.test(corpo) ? corpo : ''
  }

  const modelo = semInstrucoes(ler(join(MODELOS, 'concluida.md')))
  const conteudo = modelo
    .replace('{{OBJETIVO}}', objetivo)
    .replace('{{DATA}}', hoje())
    .replace('{{ARQUIVOS}}', alterados.length ? alterados.map((a) => `- \`${a}\``).join('\n') : '_nenhum_')
    .replace('{{DECISOES}}', secao('Decis(?:ões|oes)') || '_nenhuma registrada_')
    .replace('{{BECOS}}', secao('Tentativas que falharam') || '_nenhum registrado_')
    .replace('{{DIVIDA}}', secao('D(?:ívida|ivida)') || '_nenhuma_')
    .replace('{{VERIFICACAO}}', verificacao)
    .replace('{{COMMITS}}', commits.length ? commits.map((c) => `- ${c}`).join('\n') : '_nenhum_')

  mkdirSync(CONCLUIDAS, { recursive: true })
  const destino = join(CONCLUIDAS, `${hoje()}-${apelido(objetivo)}.md`)
  writeFileSync(destino, conteudo)

  rmSync(TAREFA)
  if (existsSync(BASE)) rmSync(BASE)

  const custo = emTokens(conteudo)
  const limite = orcamento().concluida
  console.log(`Arquivada: ${destino.replace(RAIZ + '/', '')}  (~${custo} tokens)`)
  if (custo > limite) {
    console.log(`Aviso: acima do orçamento de ${limite}. Uma tarefa concluída é resumo, não relato.`)
  }
  console.log('Tarefa ativa limpa. A próxima sessão retoma com o pacote pequeno.')
}

// ── orçamento ───────────────────────────────────────────────────────────────

// O portão desta camada. Sem medida, "contexto pequeno" é intenção; com medida,
// o pacote de retomada não consegue crescer sem alguém decidir que pode.
function medirOrcamento() {
  const limites = orcamento()
  const nucleo = ler(NUCLEO)
  const retomada = montarRetomada()

  const linhas = [
    { nome: 'nucleo', custo: emTokens(nucleo), limite: limites.nucleo },
    { nome: 'retomada', custo: emTokens(retomada), limite: limites.retomada },
  ]

  let estourou = false
  console.log('\nORÇAMENTO DE CONTEXTO\n')
  for (const l of linhas) {
    const proporcao = Math.min(1, l.custo / l.limite)
    const barra = '█'.repeat(Math.round(proporcao * 20)).padEnd(20, '·')
    const marca = l.custo > l.limite ? 'error' : 'ok   '
    if (l.custo > l.limite) estourou = true
    console.log(`  ${marca}  ${l.nome.padEnd(10)} ${barra}  ~${l.custo} / ${l.limite} tokens`)
  }

  if (existsSync(CONCLUIDAS)) {
    const grandes = readdirSync(CONCLUIDAS)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ f, custo: emTokens(ler(join(CONCLUIDAS, f))) }))
      .filter((x) => x.custo > limites.concluida)
    for (const g of grandes) {
      estourou = true
      console.log(`  error  concluída  ${g.f}  ~${g.custo} / ${limites.concluida} tokens`)
    }
  }

  console.log(
    estourou
      ? '\n  Estourou. Contexto que cresce sem decisão é o problema que esta camada existe para evitar.\n'
      : '\n  Dentro do orçamento.\n',
  )
  process.exit(estourou ? 1 : 0)
}

// ── despacho ────────────────────────────────────────────────────────────────

const [comando, ...resto] = process.argv.slice(2)

switch (comando) {
  case 'iniciar':
    iniciar(resto.join(' ').trim())
    break
  case 'retomar':
    process.stdout.write(montarRetomada())
    break
  case 'encerrar':
    encerrar()
    break
  case 'orcamento':
    medirOrcamento()
    break
  case 'estado':
    console.log(
      existsSync(TAREFA)
        ? `tarefa aberta: ${JSON.parse(ler(BASE) || '{}').objetivo ?? '(ver tarefa-ativa.md)'}`
        : 'nenhuma tarefa aberta',
    )
    break
  default:
    console.error(
      'Comandos: iniciar "<objetivo>" · retomar · encerrar · orcamento · estado',
    )
    process.exit(2)
}
