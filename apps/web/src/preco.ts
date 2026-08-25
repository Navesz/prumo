/**
 * Como um preço vira algo que uma pessoa consegue comparar de cabeça.
 *
 * O índice cobre quatro ordens de grandeza: de US$ 0,0002 a US$ 0,15 por imagem,
 * um fator de 750. Nenhum formato numérico mostra essa diferença — `0.000200` e
 * `0.150000` ocupam a mesma largura, e o mais barato deixa de parecer o mais
 * barato. Duas decisões resolvem isso, e nenhuma delas é decoração:
 *
 * 1. **A unidade é MIL IMAGENS, não uma.** `US$ 0,20 / mil` em vez de
 *    `0.000200`. É a mesma escolha do Artificial Analysis, e pelo mesmo motivo:
 *    ninguém compara 0,000200 com 0,150000 de cabeça, e ninguém compra uma
 *    imagem só. Também é a unidade em que o teto de gasto já é escrito na tela
 *    de Configurações — as duas telas passam a falar a mesma língua sobre o
 *    mesmo dinheiro.
 *
 * 2. **Comprimento carrega magnitude.** O número diz o valor; a barra diz a
 *    ordem de grandeza sem ninguém precisar ler um dígito.
 */

const NANO_POR_USD = 1_000_000_000

/** Preço de mil imagens, em dólares. É a unidade que a tela mostra. */
export function porMil(nanoUsd: string): number {
  return (Number(nanoUsd) / NANO_POR_USD) * 1000
}

/**
 * Casas decimais conforme a magnitude, não fixas.
 *
 * Seis casas fixas em toda célula produz uma parede de zeros onde os dígitos que
 * diferenciam ficam na quinta e na sexta posição — a última que o olho alcança.
 * Duas casas significativas bastam para decidir, e o valor exato continua
 * disponível no detalhe da linha.
 */
export function formatarPorMil(nanoUsd: string): string {
  const v = porMil(nanoUsd)

  // Duas casas em toda a faixa de 1 a 999, e nao "casas significativas".
  // Significativas produziam `US$ 9,00` e `US$ 10,0` em linhas vizinhas, e numa
  // coluna alinhada a direita a virgula deixa de alinhar — que e exatamente o
  // que a fonte tabular existe para garantir.
  const casas = v >= 1000 ? 0 : v >= 1 ? 2 : 3
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
}

/** O preço unitário, para quem quiser conferir. Mostrado no detalhe, nunca na coluna. */
export function formatarUnitario(nanoUsd: string): string {
  const v = Number(nanoUsd) / NANO_POR_USD
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} por imagem`
}

/**
 * Largura da barra, em escala logarítmica.
 *
 * Linear seria inútil: com 750× de amplitude, tudo abaixo de US$ 0,01 vira uma
 * barra de zero pixel e o produto inteiro fica achatado contra a parede
 * esquerda. Log mantém os quatro degraus visíveis dentro da mesma coluna.
 *
 * Mais longo = mais caro, que é a leitura intuitiva de uma barra numa coluna de
 * preço. Um piso de 3% existe para a linha mais barata continuar tendo forma —
 * uma barra de largura zero se lê como dado faltando, não como preço baixo.
 */
export function larguraDaBarra(nanoUsd: string, minNano: number, maxNano: number): string {
  const v = Number(nanoUsd)
  if (!Number.isFinite(v) || v <= 0 || maxNano <= minNano) return '3%'

  const escala = (Math.log10(v) - Math.log10(minNano)) / (Math.log10(maxNano) - Math.log10(minNano))
  return `${Math.max(3, Math.min(100, escala * 100)).toFixed(1)}%`
}

/**
 * Quantas vezes o mais caro custa em cima do mais barato.
 *
 * É a frase que responde "vale a pena procurar?" sem a pessoa dividir dois
 * números de seis casas de cabeça, e é a razão de existir do índice dita em uma
 * linha.
 */
export function quantasVezes(menorNano: number, maiorNano: number): number {
  // Preço zero existe — um provedor pode publicar um modelo gratuito — e vira uma
  // divisão por zero que sai como `Infinity×` na tela.
  if (!Number.isFinite(menorNano) || menorNano <= 0) return 1
  return maiorNano / menorNano
}

export function formatarVezes(fator: number): string {
  if (fator < 1.05) return 'mesmo preço em todos'
  if (fator < 10) return `${fator.toFixed(1).replace('.', ',')}×`
  return `${Math.round(fator)}×`
}

/** Quanto custa um uso mensal declarado, para a conta que a pessoa faria fora do site. */
export function custoMensal(nanoUsd: string, imagensPorMes: number): string {
  const total = (Number(nanoUsd) / NANO_POR_USD) * imagensPorMes
  const casas = total >= 1000 ? 0 : total >= 1 ? 2 : 3
  return `US$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
}

/** A tarefa, escrita como alguém falaria dela. */
export function nomeDaTarefa(tarefa: string): string {
  const nomes: Record<string, string> = {
    'text-to-image': 'texto → imagem',
    'image-to-image': 'imagem → imagem',
    inpainting: 'inpaint',
    outpainting: 'outpaint',
    upscale: 'upscale',
    edit: 'edição',
  }
  return nomes[tarefa] ?? tarefa
}
