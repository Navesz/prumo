import { describe, expect, it } from 'vitest'
import {
  custoMensal,
  formatarPorMil,
  formatarUnitario,
  formatarVezes,
  larguraDaBarra,
  porMil,
  quantasVezes,
} from '../src/preco.js'

/**
 * Os testes da camada que transforma dinheiro em frase.
 *
 * Não é formatação decorativa: é onde nano-USD vira o número que decide onde
 * alguém gasta, e onde uma divisão vira a frase "4,8× mais caro". Um erro aqui
 * não quebra nada — só mente com confiança.
 */

describe('o preço que a pessoa lê', () => {
  it('converte nano-USD por imagem em dólares por mil imagens', () => {
    // DeepInfra cobra US$ 0,0002 por imagem no SDXL Turbo.
    expect(porMil('200000')).toBeCloseTo(0.2)
    expect(formatarPorMil('200000')).toBe('US$ 0,200')
  })

  it('escreve em português, com vírgula decimal', () => {
    // A tela inteira é em português e escrevia `US$ 0.200`, que num país onde o
    // ponto é separador de milhar se lê como duzentos.
    expect(formatarPorMil('9000000')).toBe('US$ 9,00')
    expect(formatarUnitario('200000')).toBe('US$ 0,000200 por imagem')
  })

  it('mantém a vírgula na mesma coluna em linhas vizinhas', () => {
    // Casas significativas davam `US$ 9,00` e `US$ 10,0` um em cima do outro, e a
    // fonte tabular existe justamente para essas duas vírgulas se alinharem.
    const nove = formatarPorMil('9000000')
    const dez = formatarPorMil('10000000')

    expect(nove).toBe('US$ 9,00')
    expect(dez).toBe('US$ 10,00')
    expect(nove.indexOf(',')).toBe(dez.indexOf(',') - 1)
  })

  it('não gasta casas decimais onde elas não decidem nada', () => {
    // Abaixo de US$ 1 os dígitos que diferenciam estão na terceira casa; acima de
    // mil, nenhum deles importa.
    expect(formatarPorMil('500000')).toBe('US$ 0,500')
    expect(formatarPorMil('2000000000')).toBe('US$ 2.000')
  })
})

describe('quantas vezes mais caro', () => {
  it('divide o mais caro pelo mais barato', () => {
    expect(quantasVezes(9_000_000, 20_000_000)).toBeCloseTo(2.22)
    expect(formatarVezes(quantasVezes(9_000_000, 20_000_000))).toBe('2,2×')
  })

  it('não trata uma diferença de arredondamento como diferença de preço', () => {
    // Dois provedores dentro de 5% um do outro não dão uma decisão de compra, e
    // anunciar "1,0× mais caro" é ruído com aparência de dado.
    expect(formatarVezes(quantasVezes(10_000_000, 10_200_000))).toBe('mesmo preço em todos')
  })

  it('sobrevive a um preço zero em vez de imprimir Infinity', () => {
    // Um provedor pode publicar um modelo gratuito. A divisão sai como `Infinity×`
    // na tela, que é o tipo de defeito que só aparece em produção.
    expect(quantasVezes(0, 9_000_000)).toBe(1)
    expect(Number.isFinite(quantasVezes(0, 9_000_000))).toBe(true)
  })

  it('arredonda diferenças grandes para um número inteiro', () => {
    // "48,3×" carrega uma precisão que ninguém usa para decidir.
    expect(formatarVezes(48.3)).toBe('48×')
  })
})

describe('a barra que mostra a magnitude', () => {
  it('cresce com o preço, em escala logarítmica', () => {
    const barato = Number(larguraDaBarra('200000', 200_000, 150_000_000).replace('%', ''))
    const meio = Number(larguraDaBarra('9000000', 200_000, 150_000_000).replace('%', ''))
    const caro = Number(larguraDaBarra('150000000', 200_000, 150_000_000).replace('%', ''))

    expect(barato).toBeLessThan(meio)
    expect(meio).toBeLessThan(caro)
    expect(caro).toBe(100)
  })

  it('dá forma ao mais barato em vez de largura zero', () => {
    // Uma barra de zero pixel se lê como dado faltando, não como preço baixo.
    expect(larguraDaBarra('200000', 200_000, 150_000_000)).toBe('3.0%')
  })

  it('não quebra quando só existe um preço no índice', () => {
    // min === max acontece com um provedor só configurado, e a divisão vira NaN.
    expect(larguraDaBarra('200000', 200_000, 200_000)).toBe('3%')
    expect(larguraDaBarra('0', 200_000, 150_000_000)).toBe('3%')
  })
})

describe('a conta do mês', () => {
  it('projeta o uso declarado', () => {
    expect(custoMensal('200000', 1000)).toBe('US$ 0,200')
    expect(custoMensal('9000000', 1000)).toBe('US$ 9,00')
  })
})
