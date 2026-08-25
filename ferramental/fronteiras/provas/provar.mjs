#!/usr/bin/env node
// Prova que cada regra de fronteira fecha.
//
// Existe por causa de uma frase do manual (02-quem-impoe.md): regra automática
// com falso positivo ensina todo mundo — pessoa e IA — a desligar verificação.
// E desligar verificação é exatamente a gambiarra que a constituição proíbe.
//
// Então toda regra nasce com dois casos:
//   provas/<perfil>/reprovar/  cada regra é violada por pelo menos um arquivo
//   provas/<perfil>/aprovar/   mini-aplicação correta, zero violação
//
// A prova falha em dois sentidos, e o segundo é o que quase ninguém testa:
//   1. regra declarada que NÃO reprovou o caso que deveria → porta que não fecha
//   2. violação no caso correto → falso positivo, que é pior que regra ausente
//
// Uso:  node ferramental/fronteiras/provas/provar.mjs [--perfil=web]

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const aqui = dirname(fileURLToPath(import.meta.url))
const raizFronteiras = resolve(aqui, '..')
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const perfilPedido = args.find((a) => a.startsWith('--perfil='))?.slice('--perfil='.length)
const PERFIS = (perfilPedido ? [perfilPedido] : ['web', 'api']).map((nome) => ({
  nome,
  config: join(raizFronteiras, `${nome}-camadas.cjs`),
  reprovar: join(aqui, nome, 'reprovar'),
  aprovar: join(aqui, nome, 'aprovar'),
}))

function rodarCruzador(diretorio, config) {
  let bruto
  try {
    bruto = execFileSync(
      'npx',
      ['depcruise', 'src', '--config', config, '--output-type', 'json'],
      { cwd: diretorio, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (e) {
    // O dependency-cruiser sai com código != 0 quando encontra violação. Isso é
    // o esperado no caso `reprovar` — o que importa é a saída ter vindo.
    bruto = e.stdout ?? ''
    if (!bruto.trim()) {
      throw new Error(
        `depcruise não produziu saída em ${diretorio}.\n${e.stderr ?? e.message}`.trim(),
      )
    }
  }
  const relatorio = JSON.parse(bruto)
  return relatorio.summary?.violations ?? []
}

const c = process.stdout.isTTY && !process.env.NO_COLOR
const verde = (s) => (c ? `\x1b[32m${s}\x1b[0m` : s)
const vermelho = (s) => (c ? `\x1b[31m${s}\x1b[0m` : s)
const forte = (s) => (c ? `\x1b[1m${s}\x1b[0m` : s)

let houveFalha = false

for (const perfil of PERFIS) {
  console.log(`\n${forte(`PROVA DE FRONTEIRA — perfil ${perfil.nome}`)}`)

  if (!existsSync(perfil.config)) {
    console.error(`  ${vermelho('✗')} config não encontrada: ${perfil.config}`)
    houveFalha = true
    continue
  }

  const declaradas = require(perfil.config).forbidden.map((r) => r.name)

  const violacoesReprovar = rodarCruzador(perfil.reprovar, perfil.config)
  const disparadas = new Set(violacoesReprovar.map((v) => v.rule.name))

  const naoDispararam = declaradas.filter((nome) => !disparadas.has(nome))
  if (naoDispararam.length === 0) {
    console.log(`  ${verde('✓')} ${declaradas.length} regras reprovaram o caso que deviam`)
  } else {
    houveFalha = true
    console.log(`  ${vermelho('✗')} ${naoDispararam.length} regra(s) sem caso que as dispare:`)
    for (const nome of naoDispararam) {
      console.log(`      ${nome}  — falta fixture em provas/${perfil.nome}/reprovar/`)
    }
  }

  const violacoesAprovar = rodarCruzador(perfil.aprovar, perfil.config)
  if (violacoesAprovar.length === 0) {
    console.log(`  ${verde('✓')} nenhum falso positivo no caso correto`)
  } else {
    houveFalha = true
    console.log(`  ${vermelho('✗')} ${violacoesAprovar.length} falso(s) positivo(s):`)
    for (const v of violacoesAprovar) {
      console.log(`      ${v.rule.name}  ${v.from} → ${v.to}`)
    }
  }

  const extras = [...disparadas].filter((nome) => !declaradas.includes(nome))
  if (extras.length) {
    console.log(`  ! regras disparadas e não declaradas: ${extras.join(', ')}`)
  }
}

console.log(
  houveFalha
    ? `\n${vermelho('PROVA DE FRONTEIRA — REPROVADO')}\n`
    : `\n${verde('PROVA DE FRONTEIRA — APROVADO')}\n`,
)
process.exit(houveFalha ? 1 : 0)
