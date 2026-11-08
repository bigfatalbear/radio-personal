/**
 * sync.js — Sincronização de playlists com o Google Drive (OAuth).
 *
 * O OAuth Client ID é configuração de DESENVOLVIMENTO: fica FIXO no código
 * (CLIENT_ID_FIXO abaixo) — o usuário final nunca vê, apenas faz login com
 * a PROPRIA conta Google no pop-up do Google Identity Services.
 * As playlists de cada usuário ficam no Drive dele mesmo (escopo drive.file).
 */
import { getConfig, extrairDriveId } from './settings.js';

// ============================================================
// Client ID público do aplicativo (OAuth → Aplicativo da Web).
// A origem https://bigfatalbear.github.io deve estar autorizada no Google Cloud.
const CLIENT_ID_FIXO = '288831979888-1m0rud19lnvk3eqfqcevsises86b0bqo.apps.googleusercontent.com';
// ============================================================

const ESCOPO = 'https://www.googleapis.com/auth/drive.file';
const NOME_ARQUIVO = 'radio-personal-playlists.json';
const CLIENTE = 'https://accounts.google.com/gsi/client';

let tokenAcesso = null;
let expira = 0;

/** Client ID público do app; o usuário final entra com a própria conta Google. */
export function clientIdAtivo() {
  // Ignore oauthClientId legado do localStorage: o campo foi removido da UI
  // e um valor antigo pode apontar para um cliente inválido.
  return CLIENT_ID_FIXO.trim();
}

/** Client ID do OAuth configurado? (campo escondido mantido por compatibilidade) */
export function configurado() { return Boolean(clientIdAtivo()); }

function carregarGSI() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (!window.__gsiPromise) {
    window.__gsiPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = CLIENTE; s.async = true; s.defer = true;
      s.onload = () => {
        const oauth = window.google?.accounts?.oauth2;
        if (!oauth) {
          window.__gsiPromise = null;
          rej(new Error('O Google Identity Services carregou sem a API de login. Verifique bloqueadores de conteúdo e tente novamente.'));
          return;
        }
        res(oauth);
      };
      s.onerror = () => {
        window.__gsiPromise = null;
        rej(new Error('Falha ao carregar o login do Google. Verifique sua conexão ou bloqueadores de conteúdo e tente novamente.'));
      };
      document.head.appendChild(s);
    });
  }
  return window.__gsiPromise;
}

/** Fluxo de login → token (renova se expirado). */
async function obterToken() {
  if (tokenAcesso && Date.now() < expira - 30_000) return tokenAcesso;
  const cid = clientIdAtivo();
  if (!cid) {
    throw new Error('Login Google indisponível nesta build (Client ID não configurado). ' +
      'Suas playlists continuam funcionando salvas neste navegador.');
  }
  const oauth = await carregarGSI();
  return new Promise((resolve, reject) => {
    const cliente = oauth.initTokenClient({
      client_id: cid,
      scope: ESCOPO,
      callback: (resp) => {
        if (resp.error === 'invalid_client') {
          return reject(new Error(
            'O Google não reconheceu o Client ID deste app (invalid_client/401). Atualize o app e tente novamente. ' +
            'Se persistir, o administrador precisa reativar ou recriar o OAuth Client Web no Google Cloud, publicar o novo ID ' +
            'e confirmar a origem autorizada https://bigfatalbear.github.io. Suas playlists locais continuam salvas.'
          ));
        }
        if (resp.error === 'access_denied') {
          return reject(new Error('O login Google foi cancelado ou o acesso foi recusado. Tente novamente se quiser conectar a conta.'));
        }
        if (resp.error) {
          return reject(new Error(`O login Google não foi concluído (${resp.error}). Tente novamente; se persistir, contate o administrador do app.`));
        }
        if (!resp.access_token) {
          return reject(new Error('O Google não retornou um token de acesso. Tente novamente.'));
        }
        tokenAcesso = resp.access_token;
        expira = Date.now() + (resp.expires_in ?? 3600) * 1000;
        resolve(tokenAcesso);
      },
    });
    cliente.requestAccessToken(); // precisa de gesto do usuário (botão) — ok
  });
}

/** Encontra (ou devolve null) o json de playlists na pasta configurada. */
async function localizarArquivo(token, pastaId) {
  const q = `name='${NOME_ARQUIVO}' and '${pastaId}' in parents and trashed=false`;
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&key=${getConfig().driveApiKey || getConfig().apiKey}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Erro ao buscar playlists no Drive (${r.status}).`);
  return (await r.json()).files?.[0]?.id ?? null;
}

/** Salva (cria ou atualiza) o JSON de playlists na pasta compartilhada. */
export async function salvarNoDrive(conteudo) {
  const pastaId = extrairDriveId(getConfig().driveFonte);
  if (!pastaId) throw new Error('Configure a pasta do Drive antes de sincronizar.');
  const token = await obterToken();
  const id = await localizarArquivo(token, pastaId);

  const meta = {
    name: NOME_ARQUIVO,
    mimeType: 'application/json',
    ...(id ? {} : { parents: [pastaId] }), // novo: já cai na pasta certa
  };
  const forma = new FormData();
  forma.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  forma.append('file', new Blob([JSON.stringify(conteudo, null, 2)], { type: 'application/json' }));

  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
  const r = await fetch(url, { method: id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}` }, body: forma });
  if (!r.ok) throw new Error(`Falha ao salvar playlists no Drive (${r.status}). Verifique o OAuth Client ID e as permissions.`);
  return { criado: !id };
}

/** Baixa o JSON de playlists do Drive. @returns {Promise<obj|null>} null se nunca sincronizado */
export async function restaurarDoDrive() {
  const pastaId = extrairDriveId(getConfig().driveFonte);
  if (!pastaId) throw new Error('Configure a pasta do Drive antes de sincronizar.');
  const token = await obterToken();
  const id = await localizarArquivo(token, pastaId);
  if (!id) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Falha ao ler playlists do Drive (${r.status}).`);
  return r.json();
}

// ============================================================
// CONTA GOOGLE — login explícito + upload de áudio (drive.file)
// ============================================================
/** O usuário está conectado (token vivo)? */
export function conectado() {
  return Boolean(tokenAcesso && Date.now() < expira - 30_000);
}

/** Login com a conta Google (usado pelo botão "Entrar com Google"). */
export async function entrarComGoogle() {
  await obterToken();
  return true;
}

/** Sai (apenas descarta o token local — nada fica no servidor). */
export function sair() { tokenAcesso = null; expira = 0; }

/**
 * Envia um arquivo (File/Blob) para a pasta compartilhada configurada.
 * @param {File|Blob} arquivo  conteúdo
 * @param {string} nome        nome final no Drive (ex.: musica.mp3)
 * @param {string} mimeType
 * @returns {Promise<{id}>} ID do arquivo criado
 */
export async function enviarArquivo(arquivo, nome, mimeType) {
  const pastaId = extrairDriveId(getConfig().driveFonte);
  if (!pastaId) throw new Error('Configure a pasta do Drive antes de enviar músicas.');
  const token = await obterToken();
  const meta = { name: nome, parents: [pastaId] };
  const forma = new FormData();
  forma.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  forma.append('file', new Blob([arquivo], { type: mimeType || 'application/octet-stream' }));
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: forma,
  });
  if (r.status === 403) throw new Error('Upload recusado (403). Verifique o escopo/Client ID em Configurações.');
  if (!r.ok) throw new Error(`Falha ao enviar "${nome}" (${r.status}).`);
  return (await r.json());
}
// O arquivo vive em pasta compartilhada "com o link", então qualquer
// pessoa pode ler via API key. Usado no boot: quem administrar salvou
// lá uma vez, todos recebem as playlists automaticamente.
// ============================================================
// ============================================================
// MODO OUVINTE — leitura automática SEM login (API key)
// O arquivo vive em pasta compartilhada "com o link", então qualquer
// pessoa pode ler via API key. Usado no boot: quem administrar salvou
// lá uma vez, todos recebem as playlists automaticamente.
// ============================================================
export async function restaurarPublico() {
  const cfg = getConfig();
  const pastaId = extrairDriveId(cfg.driveFonte);
  const key = (cfg.driveApiKey || cfg.apiKey || '').trim();
  if (!pastaId || !key) return null;
  const q = `name='${NOME_ARQUIVO}' and '${pastaId}' in parents and trashed=false`;
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&key=${key}`);
  if (!r.ok) return null; // silencioso: modo ouvinte nunca atrapalha
  const id = (await r.json()).files?.[0]?.id;
  if (!id) return null;
  const r2 = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${key}`);
  if (!r2.ok) return null;
  return r2.json();
}
