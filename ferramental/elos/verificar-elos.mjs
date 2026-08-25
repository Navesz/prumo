#!/usr/bin/env node
// Confere que todo link relativo entre arquivos Markdown resolve.
//
// Num repositório cujo produto é o manual, link quebrado é o equivalente ao
// import quebrado: a IA segue a referência, não acha, e reconstrói do zero o
// que já estava escrito — pagando contexto por informação que existia.
//
// Zero dependência. Uso: node ferramental/elos/verificar-elos.mjs [raiz]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'

const raiz = resolve(process.argv[2] ?? process.cwd())

// Só o que o Git rastreia: arquivo ignorado não faz parte do produto.
const arquivos = execFileSync('git', ['ls-files', '*.md'], { cwd: raiz, encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

// [texto](destino) — ignora imagem (![...]) e link absoluto.
const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

const quebrados = []

for (const relativo of arquivos) {
  const absoluto = join(raiz, relativo)
  const linhas = readFileSync(absoluto, 'utf8').split('\n')

  let dentroDeBloco = false
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (/^\s*```/.test(linha)) dentroDeBloco = !dentroDeBloco
    if (dentroDeBloco) continue

    for (const achado of linha.matchAll(LINK)) {
      const destino = achado[1]
      if (/^(https?:|mailto:|#)/.test(destino)) continue

      // Âncora dentro do arquivo destino não é verificada: só a existência.
      const semAncora = destino.split('#')[0]
      if (!semAncora) continue

      const alvo = normalize(join(dirname(absoluto), decodeURIComponent(semAncora)))
      if (!existsSync(alvo)) {
        quebrados.push({ arquivo: relativo, linha: i + 1, destino })
      }
    }
  }
}

if (quebrados.length === 0) {
  console.log(`[elos] ${arquivos.length} arquivos, nenhum link relativo quebrado.`)
  process.exit(0)
}

console.error(`\n[elos] ${quebrados.length} link(s) quebrado(s):\n`)
for (const q of quebrados) {
  console.error(`  error  ${q.arquivo}:${q.linha}  destino não existe: ${q.destino}`)
}
console.error('')
process.exit(1)
