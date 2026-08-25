# Contexto

O estado do trabalho mora no repositório, não na conversa.

Resolve o problema que originou este projeto: quando a conversa é a única
memória, retomar custa reler tudo, e compactar uma sessão grande custa mais que
a tarefa que estava sendo feita.

---

## Comandos

```bash
node ferramental/contexto/ai.mjs iniciar "<objetivo>"   # abre a tarefa
node ferramental/contexto/ai.mjs retomar                # o pacote de retomada
node ferramental/contexto/ai.mjs encerrar               # arquiva e limpa
node ferramental/contexto/ai.mjs orcamento              # mede e reprova
node ferramental/contexto/ai.mjs estado                 # há tarefa aberta?
```

## O ciclo

```
iniciar "objetivo"
     │   grava o commit de base
     ▼
.ai/estado/tarefa-ativa.md      ← atualizado DURANTE o trabalho
     │   decisões · tentativas que falharam · bloqueios · próximo passo
     ▼
verificar --registrar           ← deixa o resultado em .ai/estado/
     │
     ▼
encerrar
     │   diff contra o commit de base → arquivos e commits
     │   extrai decisões e becos sem saída da tarefa
     ▼
.ai/concluidas/AAAA-MM-DD-objetivo.md    ~600 tokens
     │
     └── a tarefa de 70k tokens de conversa vira meia página
```

Sessão nova começa por `retomar`, não por reler a conversa anterior.

## Estrutura

```
.ai/
├── NUCLEO.md                    lido em TODA retomada. Orçamento: 1.500 tokens
├── orcamento.json               limites, se diferentes do padrão
├── estado/
│   ├── tarefa-ativa.md          uma por vez
│   ├── base.json                commit de partida da tarefa
│   └── ultima-verificacao.json  escrito por `verificar --registrar`
├── decisoes/                    ADRs
└── concluidas/                  memória permanente, consultada por busca
```

## O orçamento é o portão

Sem medida, "contexto pequeno" é intenção. Com medida, o pacote de retomada não
consegue crescer sem alguém decidir que pode.

```
ORÇAMENTO DE CONTEXTO

  ok     nucleo     ███████·············  ~537 / 1500 tokens
  ok     retomada   ███·················  ~743 / 5000 tokens
```

É estimativa por caractere, não contagem de tokenizador — tokenizador de verdade
seria dependência, e o que importa aqui é ordem de grandeza para decidir se
cabe. Português tokeniza um pouco pior que inglês; a conta usa 3,5 caracteres
por token, que é o lado conservador.

`orcamento` é passo do `verificar`. Um pacote de retomada que engordou reprova
como qualquer outro erro.

## A seção que mais importa

`## Tentativas que falharam`, dentro da tarefa ativa.

É a informação que **toda** compactação de conversa perde, porque parece
descartável: já não deu certo, então some do resumo. E é justamente ela que faz
a sessão seguinte percorrer o mesmo caminho morto e pagar de novo — às vezes
duas, três vezes.

Formato: o que tentei → por que não funcionou. Duas linhas bastam.

## O que ainda não existe

**MCP de padrões gerado a partir do perfil** (M7b). Depende do formato do
`perfil.json`, que é a saída do painel de decisões e ainda não tem esquema
definido. Enquanto isso, o MCP de um projeto se escreve à mão — como no Herz,
que tem 17 guias.

## Regras

- **Uma tarefa aberta por vez.** É o que mantém o contexto pequeno. `iniciar`
  recusa abrir a segunda.
- **Atualize a tarefa durante o trabalho**, não no fim. O valor disto é
  sobreviver a uma sessão que acabou no meio.
- **Tarefa concluída é resumo, não relato.** O detalhe continua no Git; o
  arquivo diz onde procurar e o que não é dedutível lendo o diff.
- **Não leia `concluidas/` inteiro.** Procure por nome quando precisar do porquê
  de alguma coisa. Ler tudo recria o problema que a pasta existe para resolver.
