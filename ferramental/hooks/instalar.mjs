#!/usr/bin/env node
// Instala os hooks do Alicerce no repositório atual.
//
// Usa core.hooksPath em vez de copiar para .git/hooks: assim o hook é
// versionado, revisado como código e atualiza junto com o repositório. Hook que
// mora só na máquina de quem instalou não existe para mais ninguém.
//
// Uso:        node ferramental/hooks/instalar.mjs
// Desinstala: git config --unset core.hooksPath

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const DIRETORIO_HOOKS = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const caminhoRelativo = relative(RAIZ, DIRETORIO_HOOKS)

const jaConfigurado = (() => {
  try {
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: RAIZ,
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
})()

if (jaConfigurado && jaConfigurado !== caminhoRelativo) {
  console.error(
    `core.hooksPath já aponta para "${jaConfigurado}".\n` +
      `Não vou sobrescrever configuração que não é minha.\n` +
      `Se quiser trocar: git config core.hooksPath ${caminhoRelativo}`,
  )
  process.exit(1)
}

// .git/hooks com hook ativo e core.hooksPath configurado = o de .git/hooks para
// de rodar em silêncio. Melhor avisar do que deixar alguém achando que roda.
const hooksAntigos = join(RAIZ, '.git', 'hooks')
if (existsSync(hooksAntigos)) {
  const ativos = readdirSync(hooksAntigos).filter((f) => !f.endsWith('.sample'))
  if (ativos.length) {
    console.warn(
      `Aviso: .git/hooks tem ${ativos.join(', ')}. Com core.hooksPath, esses deixam de rodar.`,
    )
  }
}

for (const arquivo of readdirSync(DIRETORIO_HOOKS)) {
  if (arquivo.endsWith('.mjs') || arquivo.endsWith('.md')) continue
  chmodSync(join(DIRETORIO_HOOKS, arquivo), 0o755)
}

execFileSync('git', ['config', 'core.hooksPath', caminhoRelativo], { cwd: RAIZ })
console.log(`Hooks instalados: core.hooksPath = ${caminhoRelativo}`)
console.log('Pular uma vez: git commit --no-verify')
