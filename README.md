# 🎙️ Rádio Personal

PWA de streaming de áudio a partir de uma pasta pública do **Google Drive**, com **programação gerada por IA** (Gemini ou OpenAI) e player fixo estilo Spotify. Interface dark mode (zinc/slate), responsiva, pronta para GitHub Pages — **sem build, sem Node em runtime**.

---

## ✨ Funcionalidades

| Módulo | Descrição |
|---|---|
| 🎵 Player | Play/pause, próxima/anterior, barra de progresso clicável, volume, shuffle, tela cheia e visualizador neon que reage ao áudio quando permitido pelo navegador/origem |
| 📁 Google Drive | Leitura de pastas públicas (`.mp3`, `.m4a`, `.aac`, etc.) via Drive API v3 |
| 🤖 Programação IA | Prompt estruturado que gera nome do bloco, grade horária, locução e ordem de reprodução usando o acervo real do Drive |
| ⚙️ Configurações | Chave de IA, link da pasta, nome/slogan/logo (persistidos em `localStorage`) |
| 📱 PWA | `manifest.json` + `sw.js` — instalável no celular/PC e interface offline |

> ⚠️ As chaves ficam **apenas** no seu navegador (`localStorage`) — nada é enviado a servidores besides os endpoints oficiais (Gemini/OpenAI/Drive).

---

## 🚀 Como publicar no GitHub Pages

### 1. Criar o repositório e enviar

```bash
cd radio-personal
git init && git branch -M main
git add . && git commit -m "feat: Rádio Personal PWA — player Drive + programação IA"
gh repo create radio-personal --public --source=. --push
```

(ou via web: crie o repo em github.com e `git remote add origin https://github.com/SEU_USUARIO/radio-personal.git && git push -u origin main`)

### 2. Ativar o GitHub Pages

**Pela interface:** `Settings → Pages → Source: GitHub Actions` (ou deploy from branch `main` / root).

**Via CLI (gh):**

```bash
gh api -X POST repos/SEU_USUARIO/radio-personal/pages -f build_type=workflow -f "source[branch]=main" -f "source[path]=/"
```

Ou adicione o workflow abaixo em `.github/workflows/deploy.yml`:

```yaml
name: Deploy GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: '.' }
      - id: deployment
        uses: actions/deploy-pages@v4
```

O site fica em `https://SEU_USUARIO.github.io/radio-personal/`.

---

## 🔑 Como configurar as chaves

### Chave de IA

1. **Gemini:** pegue em [aistudio.google.com](https://aistudio.google.com/app/apikey) (gratuita).
   **OpenAI:** em [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Abra o app → aba **Configurações** → escolha o provedor → cole a chave → **Salvar**.
3. Clique em **Testar IA** para validar.

> A MESMA chave Google é usada por padrão para ler o Drive — então a API **Drive** precisa estar habilitada no projeto Cloud com essa chave. Alternativa: crie uma chave dedicada no [Cloud Console](https://console.cloud.google.com/apis/credentials) com a *Google Drive API* ativada.

### Pasta do Google Drive

1. No Drive, crie uma pasta com suas músicas.
2. Compartilhe → **Qualquer pessoa com o link** (Leitor).
3. Copie o link (`https://drive.google.com/drive/folders/ID...`) e cole no campo da aba Configurações → Salvar.
4. Aba **Player** → **Carregar do Drive**.

### Login Google e sincronização

O botão **Entrar com Google** usa o Client ID público do aplicativo, embutido em `js/sync.js`; cada pessoa autoriza o acesso à própria conta. O ID não é um segredo e não deve ser confundido com um *client secret*. O app ignora valores antigos de `oauthClientId` que possam ter ficado no `localStorage`.

No [Google Cloud Console → APIs e serviços → Credenciais](https://console.cloud.google.com/apis/credentials), o administrador deve manter um cliente OAuth do tipo **Aplicativo da Web** ativo, com `https://bigfatalbear.github.io` em **Origens JavaScript autorizadas**, e habilitar a Google Drive API. O app usa o escopo `drive.file` para sincronizar playlists e enviar arquivos. Se o Google mostrar **Erro 401: invalid_client**, confirme que o Client ID embutido ainda existe e está ativo; se foi removido ou desativado, crie outro cliente Web, atualize `CLIENT_ID_FIXO` em `js/sync.js` e publique a alteração. Um Client ID novo não corrige erros inevitáveis do provedor, e o app não pode reativar credenciais no projeto Cloud.

Após atualizar o app, recarregue a página ou use o aviso **Nova versão disponível** para substituir arquivos offline antigos.

### Identidade da rádio

Em Configurações, informe nome, slogan e uma URL de logotipo (ou `data:image/...` base64). O cabeçalho e o título da aba atualizam automaticamente.

---

## 🧪 Rodar localmente (opcional)

Basta abrir o `index.html` (funciona mesmo com `file://`), ou:

```bash
python -m http.server 8080
# http://localhost:8080
```

O Service Worker só ativa em HTTPS (GitHub Pages) — em HTTP a UI funciona normalmente.

---

## 📂 Estrutura

```
radio-personal/
├── index.html        # SPA completa (Tailwind CDN + Lucide)
├── manifest.json     # Manifest PWA
├── sw.js             # Service Worker (cache básico, exclui streams)
├── css/styles.css    # Componentes visuais extras
├── js/
│   ├── app.js        # UI, navegação, renderização da fila/programação
│   ├── settings.js   # Persistência em localStorage
│   ├── drive.js      # Listagem da pasta do Drive
│   ├── ai.js         # Gemini / OpenAI — programação musical
│   └── player.js     # Motor <audio> + fila + shuffle
└── README.md
```

## 🛠️ Stack

HTML5 · Tailwind CSS (CDN) · JavaScript ES6 Modules · Lucide Icons · Inter · Service Worker + Manifest (PWA)
