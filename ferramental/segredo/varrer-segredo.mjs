#!/usr/bin/env node
// Varredura de segredo. Existe porque "nunca commitar credencial" é regra de
// documento (N6) e precisa virar porta (N1/N4) — invariante 18.
//
// Zero dependência. Varre o que o Git rastreia, não o disco: arquivo ignorado
// não é risco, e node_modules não é nosso.
//
// Uso:
//   node varrer-segredo.mjs              tudo que o Git rastreia
//   node varrer-segredo.mjs --staged     só o que está em stage (hook)
//   node varrer-segredo.mjs --json
//
// Escape hatch, na linha do achado:  // alicerce-segredo-ok: <motivo>
// Sem motivo escrito, não vale — regra de supressão com justificativa
// (invariante 15).

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const args = process.argv.slice(2)
const soStaged = args.includes('--staged')
const comoJson = args.includes('--json')

const TAMANHO_MAXIMO = 512 * 1024
const MARCA_LIBERACAO = /alicerce-segredo-ok:\s*\S+/

// Caminhos que não valem a varredura: lockfile é ruído puro, e binário nunca
// tem segredo em texto que este varredor consiga ler de forma confiável.
const IGNORAR_CAMINHO =
  /(^|\/)(node_modules|dist|build|\.next|coverage|vendor)\/|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|zip|gz|tgz|mp4|mov|woff2?|ttf|otf|eot|wasm|node|dll|exe|bin)$/i

// Placeholders são a principal fonte de falso positivo. Regra automática com
// falso positivo ensina a desligar verificação — que é a gambiarra que a
// constituição proíbe.
const PLACEHOLDER =
  /(process\.env|import\.meta\.env|\$\{|\$\(|<[^>]*>|\bxxx+\b|\bchange[_-]?me\b|\bexample\b|\bexemplo\b|\bplaceholder\b|\bseu[_-]|\bdummy\b|\bfake\b|\btest(e)?[_-]?(key|token|secret)\b|\*{4,}|\.{4,}|\bnull\b|\bundefined\b)/i

const REGRAS = [
  {
    nome: 'chave-privada',
    padrao: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    aceitaPlaceholder: false,
  },
  { nome: 'aws-access-key', padrao: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'github-token', padrao: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { nome: 'slack-token', padrao: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'google-api-key', padrao: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nome: 'chave-de-api', padrao: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  {
    nome: 'jwt',
    padrao: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    nome: 'string-de-conexao',
    padrao: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/i,
  },
  {
    nome: 'senha-em-conexao',
    padrao: /\b(?:password|pwd)\s*=\s*[^;\s"'<${]{6,}/i,
  },
  {
    nome: 'credencial-atribuida',
    padrao:
      /\b(?:senha|password|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*["'][^"']{8,}["']/i,
  },
]

function arquivosParaVarrer() {
  const comando = soStaged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files']
  try {
    return execFileSync('git', comando, { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((c) => !IGNORAR_CAMINHO.test(c))
  } catch {
    console.error('[segredo] não é um repositório Git, ou o git não está disponível.')
    process.exit(2)
  }
}

const achados = []

for (const caminho of arquivosParaVarrer()) {
  // Arquivo de ambiente rastreado é achado por si só, independente do conteúdo.
  if (/(^|\/)\.env(\.|$)/.test(caminho) && !/\.example$|\.exemplo$/.test(caminho)) {
    achados.push({ caminho, linha: 0, regra: 'env-versionado', trecho: caminho })
    continue
  }

  let conteudo
  try {
    if (statSync(caminho).size > TAMANHO_MAXIMO) continue
    conteudo = readFileSync(caminho, 'utf8')
  } catch {
    continue
  }
  // binário que escapou do filtro de extensão: NUL é o sinal confiável
  if (conteudo.indexOf(String.fromCharCode(0)) !== -1) continue

  const linhas = conteudo.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linha.length > 2000) continue
    if (MARCA_LIBERACAO.test(linha)) continue

    for (const regra of REGRAS) {
      if (!regra.padrao.test(linha)) continue
      if (regra.aceitaPlaceholder !== false && PLACEHOLDER.test(linha)) continue

      // Mostra o suficiente para achar, nunca o segredo inteiro: a saída desta
      // ferramenta vai para log de CI, que é outro lugar onde segredo não entra.
      const bruto = linha.trim()
      const trecho = bruto.length > 60 ? `${bruto.slice(0, 40)}…[${bruto.length} car.]` : bruto
      achados.push({ caminho, linha: i + 1, regra: regra.nome, trecho })
      break
    }
  }
}

if (comoJson) {
  console.log(JSON.stringify({ total: achados.length, achados }, null, 2))
} else if (achados.length === 0) {
  console.log(`[segredo] nenhum achado em ${soStaged ? 'stage' : 'arquivos rastreados'}.`)
} else {
  console.error(`\n[segredo] ${achados.length} achado(s):\n`)
  for (const a of achados) {
    console.error(`  error  ${a.caminho}:${a.linha}  ${a.regra}`)
    console.error(`         ${a.trecho}`)
  }
  console.error(
    '\n  Segredo que já entrou no histórico não se remove com commit novo:\n' +
      '  precisa ser ROTACIONADO. Reescrever histórico vem depois, não no lugar.\n' +
      '  Falso positivo: adicione na linha  // alicerce-segredo-ok: <motivo>\n',
  )
}

process.exit(achados.length === 0 ? 0 : 1)
