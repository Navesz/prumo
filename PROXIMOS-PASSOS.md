# Onde parei, e o que só você pode fazer

## 1. Autorizar o push (30 segundos)

O repositório `github.com/Navesz/prumo` já existe, público e vazio. O commit está
pronto aqui, mas o token do `gh` não tem o escopo `workflow`, então o GitHub recusa
criar `.github/workflows/`. Isso exige o seu navegador:

```bash
gh auth refresh -h github.com -s workflow
```

Depois:

```bash
git push -u origin main
```

## 2. Ligar a proteção de ramo — o M0 não fecha sem isso

Workflow que não bloqueia é sugestão. Depois do primeiro CI rodar, em
**Settings → Branches → Add rule** para `main`:

- Require a pull request before merging
- Require status checks to pass: **`verificar`** e **`portao`**
- Require branches to be up to date before merging

Ou pela linha de comando:

```bash
gh api -X PUT repos/Navesz/prumo/branches/main/protection --input .github/branch-protection.json
```

## 3. Subir o Postgres para fechar o M1 localmente

O Docker Desktop não estava rodando aqui, então a suíte de integração ficou pulada —
e ela pula em voz alta, de propósito, em vez de passar calada. São as asserções que
mock nenhum consegue fazer: RLS forçada, isolamento entre usuários, bigint sem perda
de precisão e a corrida do último centavo do teto.

```bash
docker compose up -d postgres
npm run verificar
```

O CI já roda essa suíte com `postgres:17-alpine` como serviço, então ela é executada
de verdade a cada push — mas rodar uma vez na sua máquina é o que fecha o M1 com
prova sua, não minha.

## 4. Conferir antes de canonizar

Números coletados de documentação de terceiro em 24/08/2026, ainda **não** verificados
contra o provedor:

- Fireworks descontinuou geração de imagem em 10/06/2026
- Imagen do Google desligado em 17/08/2026
- quais dos 13 provedores oferecem teto de gasto **por chave**

O último é o mais importante: onde não houver teto por chave, um vazamento tem dano
ilimitado, e o card daquele provedor precisa dizer isso.
