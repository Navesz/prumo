# Onde parei, e o que falta

**Estado em 25/08/2026:** M0 fechado, M1 de pé, no ar em
[github.com/Navesz/prumo](https://github.com/Navesz/prumo) com CI verde.

## Feito

- Repositório público criado, 6 commits, todos assinados como `Navesz`.
- `verificar` passa nos 9 passos; `portão` reprova os 5 erros plantados.
- **Proteção de ramo ligada** em `main`, exigindo `verificar` e `portao`, valendo
  também para administrador, sem force push e sem exclusão.
- Suíte de integração rodando **de verdade** contra `postgres:17-alpine` no CI.

## O que o CI encontrou, e que só um banco de verdade encontraria

Três defeitos reais, nenhum deles visível em revisão de código:

1. **`window` é palavra reservada no PostgreSQL.** A migration falhava no
   `CREATE TABLE`. Virou `period`.
2. **A RLS era decorativa.** `POSTGRES_USER: prumo` faz do `prumo` o superusuário do
   contêiner, e superusuário **sempre** ignora row level security — `FORCE ROW LEVEL
SECURITY` não muda isso. Quem seguisse o README subiria uma instância onde um
   usuário lê os dados do outro, com chave paga de terceiro dentro. Corrigido pela
   migration 0002 e pelo papel `prumo_app` (ver `adr/0013`).
3. **O teste de isolamento estava errado**, rodando SQL cru fora da transação. A
   versão nova é mais forte: dentro do escopo do Bob, pede ao repositório os
   orçamentos da Alice.

## Falta

### Rodar a suíte de integração na sua máquina

O Docker Desktop não subiu aqui — o processo é iniciado e morre, e a distro WSL
`docker-desktop` fica em `Stopped`. Provavelmente precisa de uma abertura manual do
aplicativo, ou de reiniciar. Depois:

```bash
docker compose up -d postgres
```

```bash
npm run verificar
```

O CI já roda essa suíte a cada push, então ela não está sem cobertura — mas rodar
uma vez local fecha o M1 com prova sua.

### Conferir três números antes de canonizar

Coletados de documentação de terceiro em 24/08/2026, **não verificados** contra o
provedor:

- Fireworks descontinuou geração de imagem em 10/06/2026.
- Imagen do Google desligado em 17/08/2026.
- **Quais dos 13 provedores oferecem teto de gasto por chave.** Este é o que
  importa: onde não houver, um vazamento tem dano ilimitado, e o card daquele
  provedor precisa dizer isso na tela.

### Decidir os dois bloqueios do PLANO.md

`🔴 Como se contabiliza um job que falhou depois de o provedor cobrar` e a retenção
da galeria já tem resposta (guarda para sempre, `purge_at` nulo). O primeiro trava a
tela de gasto do M3.

## Próximo marco

**M2 — cofre de chaves.** Você cola a chave, ela é cifrada com envelope AES-256-GCM,
e uma chamada barata ao provedor confirma que funciona. A chave nunca volta numa
resposta, e um teste de CI faz `grep` no log procurando o prefixo dela.

Depois **M3 — estúdio**: a primeira imagem gerada de verdade, com o custo na tela
antes do clique e descontado do teto.
