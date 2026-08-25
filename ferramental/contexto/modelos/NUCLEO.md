# {{PROJETO}}

<!--
  Modelo do núcleo. É o único texto lido em TODA retomada de sessão — orçamento
  de 1.500 tokens, verificado por `ai.mjs orcamento`.

  Regra para o que entra aqui: só o que a IA erraria sem saber, em qualquer
  tarefa. Regra específica de uma área vai para regra por caminho; procedimento
  vai para skill; catálogo de componente vai para o MCP do projeto.

  Se você está em dúvida se algo entra, não entra.
-->

## O que é

{{UMA_FRASE}}

## Stack

{{STACK_EM_ATE_6_LINHAS}}

## Arquitetura

{{CAMADAS_E_DIRECAO_DE_IMPORT}}

## Invariantes que mais pegam

<!-- Os 5 a 8 que a IA viola com mais frequência neste projeto. Não os 23. -->

- {{INVARIANTE}}

## Verificação

```bash
{{COMANDO_UNICO}}
```

"Terminei" significa que este comando passou. Não é opinião.

## Onde está a verdade

| Assunto | Fonte |
|---|---|
| contrato | {{CAMINHO}} |
| banco | {{CAMINHO}} |
| arquitetura | `.ai/decisoes/` |
| estado do trabalho | `.ai/estado/tarefa-ativa.md` |
| histórico | Git, e `.ai/concluidas/` |

A conversa **não** é fonte de verdade.
