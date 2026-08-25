#!/usr/bin/env node
// O portão: escrever erro de propósito e provar que a verificação REPROVA.
//
// Existe porque CI que nunca reprovou nada é desenho de porta. Custa dez minutos
// escrever e é a diferença entre ter verificação e achar que tem.
//
// Cada caso quebra UMA coisa, roda o passo correspondente, confere que ele
// reprovou, desfaz, e confere que voltou a aprovar. As três asserções importam:
//   - aprovava antes        → senão o teste não prova nada
//   - reprovou com o erro   → a porta fecha
//   - aprovou ao desfazer   → não deixou sujeira nem falso positivo
//
// O formato de `casos` veio do Alicerce (repositório privado do mesmo autor);
// os casos abaixo são do Prumo, um por regra que a gente quer provar.
//
// Por que isto não é cerimônia: a regra `dominio-puro` do Herz foi decorativa
// desde o nascimento e passou meses dando "no dependency violations found" com
// React dentro do domínio. Porta que nunca disparou pode estar quebrada.
//
// Aviso: os casos de `elos` e `segredo` usam `git add`/`git rm` em caminhos
// próprios, porque os dois varredores só enxergam arquivo rastreado. Outras
// mudanças em stage não são tocadas.

import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

const LF = String.fromCharCode(10)

const casos = [
  {
    passo: 'tipos',
    descricao: 'dinheiro tratado como number em vez de bigint',
    caminho: 'apps/server/src/domain/_prova-portao-tipos.ts',
    quebrar() {
      writeFileSync(
        join(RAIZ, this.caminho),
        [
          "import { formatNano } from './money.js'",
          '// nano-USD é bigint. Passar number aqui é o erro que o compilador tem',
          '// que recusar antes de virar um valor errado na tela de gasto.',
          'export const errado: string = formatNano(0.1)',
          '',
        ].join(LF),
      )
    },
    desfazer() {
      unlinkSync(join(RAIZ, this.caminho))
    },
  },
  {
    passo: 'fronteiras',
    descricao: 'domínio importando o driver do banco',
    caminho: 'apps/server/src/domain/_prova-portao-fronteira.ts',
    quebrar() {
      writeFileSync(
        join(RAIZ, this.caminho),
        ["import type { Kysely } from 'kysely'", 'export type Proibido = Kysely<unknown>', ''].join(
          LF,
        ),
      )
    },
    desfazer() {
      unlinkSync(join(RAIZ, this.caminho))
    },
  },
  {
    passo: 'fronteiras',
    descricao: 'caso de uso importando a implementação do banco (I/O dentro da transação)',
    caminho: 'apps/server/src/app/_prova-portao-io.ts',
    quebrar() {
      writeFileSync(
        join(RAIZ, this.caminho),
        [
          "import { createPool } from '../db/connection.js'",
          'export const proibido = createPool',
          '',
        ].join(LF),
      )
    },
    desfazer() {
      unlinkSync(join(RAIZ, this.caminho))
    },
  },
  {
    passo: 'segredo',
    descricao: 'chave de API em arquivo rastreado',
    caminho: '_prova-portao-segredo.ts',
    quebrar() {
      // Valor sintético: formato de chave real, sem ser uma.
      const falsa = ['sk', 'ant', 'api03'].join('-') + 'A'.repeat(24)
      writeFileSync(join(RAIZ, this.caminho), 'export const chave = "' + falsa + '"' + LF)
      execFileSync('git', ['add', this.caminho], { cwd: RAIZ })
    },
    desfazer() {
      execFileSync('git', ['rm', '-f', '--quiet', this.caminho], { cwd: RAIZ })
    },
  },
  {
    passo: 'controle',
    descricao: 'regex com \\b que virou o caractere BACKSPACE',
    caminho: 'apps/server/src/domain/_prova-portao-controle.ts',
    quebrar() {
      // O defeito exatamente como ele aconteceu: o `\b` de fronteira de palavra
      // perdeu uma camada de escape a caminho do arquivo e chegou como U+0008. A
      // regex segue válida, compila, passa no lint — e nunca mais casa com nada.
      const backspace = String.fromCharCode(8)
      writeFileSync(
        join(RAIZ, this.caminho),
        'export const variante = /klein.*4b' + backspace + '/i' + LF,
      )
    },
    desfazer() {
      unlinkSync(join(RAIZ, this.caminho))
    },
  },
  {
    passo: 'elos',
    descricao: 'link relativo para arquivo inexistente',
    caminho: 'docs/_prova-portao.md',
    quebrar() {
      writeFileSync(
        join(RAIZ, this.caminho),
        '# Prova' + LF + LF + 'Veja o [capítulo sumido](99-nao-existe.md).' + LF,
      )
      execFileSync('git', ['add', this.caminho], { cwd: RAIZ })
    },
    desfazer() {
      execFileSync('git', ['rm', '-f', '--quiet', this.caminho], { cwd: RAIZ })
    },
  },
]

function rodarPasso(nome) {
  try {
    execFileSync('node', ['ferramental/verificar/verificar.mjs', `--passo=${nome}`], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { reprovou: false, saida: '' }
  } catch (e) {
    return { reprovou: e.status === 1, saida: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

let falhas = 0
console.log(LF + 'PORTÃO — a verificação reprova o que deve?' + LF)

for (const caso of casos) {
  const antes = rodarPasso(caso.passo)
  if (antes.reprovou) {
    console.log(`  ✗ ${caso.passo}: já reprovava ANTES do erro. Teste inválido.`)
    falhas++
    continue
  }

  caso.quebrar()
  const comErro = rodarPasso(caso.passo)
  caso.desfazer()
  const restaurado = rodarPasso(caso.passo)

  if (comErro.reprovou && !restaurado.reprovou) {
    console.log(`  ✓ ${caso.passo.padEnd(12)} reprovou: ${caso.descricao}`)
  } else {
    falhas++
    console.log(`  ✗ ${caso.passo.padEnd(12)} NÃO fechou: ${caso.descricao}`)
    console.log(`      com o erro: ${comErro.reprovou ? 'reprovou' : 'APROVOU — porta aberta'}`)
    console.log(`      restaurado: ${restaurado.reprovou ? 'AINDA REPROVA — sujeira' : 'aprovou'}`)
  }
}

// Nenhum arquivo de prova pode sobrar, mesmo que um caso tenha estourado.
for (const caso of casos) {
  if (caso.caminho.includes('_prova-portao')) {
    const absoluto = join(RAIZ, caso.caminho)
    if (existsSync(absoluto)) {
      console.log(`  ! sobrou ${caso.caminho} — removendo`)
      unlinkSync(absoluto)
      falhas++
    }
  }
}

console.log(falhas === 0 ? LF + 'PORTÃO — FECHA' + LF : LF + `PORTÃO — ${falhas} FALHA(S)` + LF)
process.exit(falhas === 0 ? 0 : 1)
