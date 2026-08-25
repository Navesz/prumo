#!/usr/bin/env node
/**
 * Gera as instruções de IA do Prumo a partir de `.ai/politica.md`.
 *
 * Existiam, em três clientes diferentes, três cópias da mesma instrução mantidas
 * à mão. Drift não é hipótese nesse desenho: começa na primeira regra que muda,
 * e o sintoma é o pior possível — cada agente obedece uma versão diferente da
 * casa e todas parecem oficiais.
 *
 * Aqui as três saídas são derivadas de uma fonte só. O corpo é um por
 * construção; muda o cabeçalho, e o `.mdc` do Cursor recorta um subconjunto de
 * seções (ele é injetado em TODA requisição — o que entra ali é o que muda o que
 * você escreve em qualquer arquivo, não tabela de consulta).
 *
 *   node .ai/gerar.mjs              escreve as saídas
 *   node .ai/gerar.mjs --verificar  não escreve nada; sai 1 se alguma divergir
 *
 * O modo `--verificar` é a primeira etapa do portão, antes do typecheck.
 *
 * Node puro, zero dependência, de propósito: o que confere o repositório não
 * pode depender do build do repositório.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = '.ai/politica.md'
const AVISO =
  '<!-- GERADO a partir de .ai/politica.md — não edite aqui. Rode `node .ai/gerar.mjs`. -->'

const ABRE = /^<!--\s*inicio:([a-z0-9-]+)\s*-->\s*$/
const FECHA = /^<!--\s*fim:([a-z0-9-]+)\s*-->\s*$/

/** Falha alto e cedo. Gerador que "quase deu certo" publica instrução incompleta. */
function erro(mensagem) {
  console.error(`✖ ${mensagem}`)
  process.exit(1)
}

/**
 * Recorta a política em seções nomeadas, na ordem em que aparecem.
 *
 * Texto fora de seção é ERRO, não descarte silencioso: uma regra escrita fora
 * dos marcadores não entraria em saída nenhuma e ninguém notaria — exatamente o
 * modo de falha que esta camada existe para eliminar.
 */
function recortar(texto) {
  // O comentário de cabeçalho da fonte fala do gerador, não do projeto: sai.
  const corpo = texto.replace(/^﻿?\s*<!--[\s\S]*?-->\r?\n/, '')
  const secoes = new Map()
  let atual = null
  let acumulado = []
  let n = 0

  for (const linha of corpo.split('\n')) {
    n += 1
    const bruta = linha.replace(/\r$/, '')
    const abre = ABRE.exec(bruta)
    const fecha = FECHA.exec(bruta)

    if (abre) {
      if (atual) erro(`${FONTE}: 'inicio:${abre[1]}' aberto dentro de '${atual}'`)
      if (secoes.has(abre[1])) erro(`${FONTE}: seção '${abre[1]}' declarada duas vezes`)
      atual = abre[1]
      acumulado = []
    } else if (fecha) {
      if (!atual) erro(`${FONTE}: 'fim:${fecha[1]}' sem 'inicio' correspondente`)
      if (fecha[1] !== atual) erro(`${FONTE}: '${atual}' fechado como '${fecha[1]}'`)
      secoes.set(atual, acumulado.join('\n').trim())
      atual = null
    } else if (atual) {
      acumulado.push(bruta)
    } else if (bruta.trim() !== '') {
      erro(
        `${FONTE}: linha ${n} está fora de qualquer seção e não iria para saída nenhuma:\n` +
          `    ${bruta.trim().slice(0, 72)}`,
      )
    }
  }

  if (atual) erro(`${FONTE}: seção '${atual}' ficou aberta até o fim do arquivo`)
  if (secoes.size === 0) erro(`${FONTE}: nenhuma seção encontrada — faltam os marcadores 'inicio:'`)
  for (const [nome, conteudo] of secoes) {
    if (conteudo === '') erro(`${FONTE}: seção '${nome}' está vazia`)
  }
  return secoes
}

// `secoes: null` = todas, na ordem da fonte.
const SAIDAS = [
  {
    arquivo: 'CLAUDE.md',
    secoes: null,
    cabecalho: `${AVISO}\n\n# Prumo — instruções de projeto\n`,
  },
  {
    arquivo: 'AGENTS.md',
    secoes: null,
    cabecalho:
      `${AVISO}\n\n# Instruções para agentes\n\n` +
      `Valem para qualquer agente, não só o Claude Code. Mesmo conteúdo do \`CLAUDE.md\`,\n` +
      `porque conteúdo diferente por cliente é drift esperando acontecer.\n`,
  },
  {
    // `alwaysApply: true` cobra este texto em toda requisição. Entra o que muda o
    // que se escreve em qualquer arquivo; fica de fora `leitura` (tabela de
    // consulta, cara e sob demanda) e `verificacao` (procedimento de fim).
    arquivo: '.cursor/rules/prumo.mdc',
    secoes: ['abertura', 'referencias', 'regras', 'marcacao', 'estado'],
    cabecalho:
      `---\n` +
      `description: Regras obrigatórias do Prumo — dinheiro em nano-USD, zero HTTP em transação, axios proibido, nenhuma rota revela chave\n` +
      `alwaysApply: true\n` +
      `---\n\n${AVISO}\n\n# Prumo — regras obrigatórias\n\n` +
      `Subconjunto de \`.ai/politica.md\` — daí a numeração pular. Ficam de fora a tabela\n` +
      `de leitura (§1) e o procedimento de verificação (§5), que estão em \`CLAUDE.md\` e\n` +
      `\`AGENTS.md\`: são consulta sob demanda, e este arquivo é cobrado em toda requisição.\n`,
  },
]

function montar(secoes, escolhidas, arquivo) {
  const nomes = escolhidas ?? [...secoes.keys()]
  return nomes
    .map((nome) => {
      const conteudo = secoes.get(nome)
      // Nome errado aqui apagaria uma seção inteira da saída sem avisar.
      if (conteudo === undefined) {
        erro(`${arquivo}: pede a seção '${nome}', que não existe em ${FONTE}`)
      }
      return conteudo
    })
    .join('\n\n')
}

// Comparação insensível a fim de linha: em Windows, `core.autocrlf` reescreve o
// arquivo no checkout e o portão passaria a reprovar por CRLF, não por conteúdo.
const normalizar = (texto) => texto.replace(/\r\n/g, '\n')

const verificando = process.argv.includes('--verificar')
const secoes = recortar(readFileSync(join(RAIZ, FONTE), 'utf8'))

// Monta TUDO antes de escrever QUALQUER coisa: um nome de seção errado numa
// saída derruba o gerador com o repositório intacto, em vez de deixar dois
// arquivos novos e o terceiro velho.
const planejadas = SAIDAS.map(({ arquivo, secoes: escolhidas, cabecalho }) => ({
  arquivo,
  quantas: (escolhidas ?? [...secoes.keys()]).length,
  esperado: `${cabecalho}\n${montar(secoes, escolhidas, arquivo)}\n`,
}))

let divergiu = false

for (const { arquivo, quantas, esperado } of planejadas) {
  const caminho = join(RAIZ, arquivo)

  if (verificando) {
    let atual = null
    try {
      atual = readFileSync(caminho, 'utf8')
    } catch {
      /* ausente conta como divergente */
    }
    if (atual === null) {
      console.error(`✖ ${arquivo} não existe`)
      divergiu = true
    } else if (normalizar(atual) !== normalizar(esperado)) {
      console.error(`✖ ${arquivo} divergiu de ${FONTE}`)
      divergiu = true
    }
  } else {
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, esperado)
    console.log(`✔ ${arquivo}  (${quantas} ${quantas === 1 ? 'seção' : 'seções'})`)
  }
}

if (verificando) {
  if (divergiu) {
    console.error(`\nRode \`node .ai/gerar.mjs\`. Edite ${FONTE}, nunca as cópias.`)
    process.exit(1)
  }
  console.log(`✔ instruções em sincronia com ${FONTE}`)
}
