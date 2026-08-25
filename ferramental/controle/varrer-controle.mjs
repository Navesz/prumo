#!/usr/bin/env node
/**
 * Caça caracteres de controle invisíveis no código-fonte.
 *
 * Existe por causa de um defeito real, e vale contar como ele passou.
 *
 * Uma regra de identidade de modelo foi escrita como
 * `/flux[.\s-]*2.*klein.*4\s*b\b/i`. O `\b` — fronteira de palavra — atravessou
 * uma camada de escape a mais do que eu contava e chegou ao arquivo como
 * `U+0008`, o caractere BACKSPACE literal. A regex continuou sintaticamente
 * válida e passou a nunca casar com nada.
 *
 * Nada pegou. O prettier formatou o arquivo. O tsc compilou. O oxlint aprovou. E
 * o teste que existia para provar a regra foi escrito a partir da mesma suposição
 * errada, então também passou. O único sintoma foi um número silenciosamente
 * menor numa tela — duas comparações de preço que deveriam existir e não
 * existiam. Ninguém encontra isso lendo o diff: `\b` e `U+0008` são
 * indistinguíveis num editor.
 *
 * Zero dependência, pelo mesmo motivo do resto do ferramental: o que confere o
 * código não pode depender do build.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const IGNORAR = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo', 'tsconfig.tsbuildinfo'])
const EXTENSOES = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|yml|yaml|sql|html)$/

/**
 * Tab (9), LF (10) e CR (13) são estrutura. Todo o resto abaixo de 32 é ruído
 * que atravessou algum escape, e U+0008 e U+001B são os que mais doem: um
 * desativa regex, o outro injeta código de terminal em log.
 */
function ehControle(codigo) {
  return codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13
}

const NOMES = { 0: 'NUL', 7: 'BEL', 8: 'BACKSPACE', 11: 'VT', 12: 'FF', 27: 'ESC', 127: 'DEL' }

function* arquivos(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue
    const caminho = join(dir, entrada.name)
    if (entrada.isDirectory()) yield* arquivos(caminho)
    else if (EXTENSOES.test(entrada.name)) yield caminho
  }
}

const achados = []

for (const caminho of arquivos(process.cwd())) {
  const texto = readFileSync(caminho, 'utf8')
  let linha = 1

  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i)
    if (codigo === 10) {
      linha++
      continue
    }
    if (!ehControle(codigo)) continue

    const nome = NOMES[codigo] ?? `U+${codigo.toString(16).padStart(4, '0').toUpperCase()}`
    const trecho = texto.slice(Math.max(0, i - 40), i).split('\n').pop()

    achados.push(
      `error ${relative(process.cwd(), caminho)}:${linha} ${nome} depois de …${trecho}`,
    )
  }
}

if (achados.length > 0) {
  for (const a of achados) console.error(a)
  console.error(
    `\n${achados.length} caractere(s) de controle. Um \\b que virou BACKSPACE deixa a regex válida e inerte.`,
  )
  process.exit(1)
}

console.log('nenhum caractere de controle')
