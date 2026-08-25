import { buscarPedidos } from '../dados/api'
import { Botao } from '../components/botao'
import { podeIniciar } from '../dominio/regra'
export const Painel = async () => {
  const dados = await buscarPedidos()
  return podeIniciar("pronto") ? Botao("Iniciar") : dados
}
