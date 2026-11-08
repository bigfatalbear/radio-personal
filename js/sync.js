/**
 * sync.js — Sincronização de playlists com a pasta do Google Drive (configurada).
 * Escrever no Drive exige OAuth (API key só lê). Usamos Google Identity Services
 * (token client) + escopo `drive.file`: nada além dos arquivos criados por aqui.
 * As playlists vão num JSON `radio-personal-playlists.json` dentro da sua pasta.
 */
import { getConfig } from './settings.js';

const ESCOPO = 'https://www.googleapis.com/auth/drive.file';
const NOME_ARQUIVO = 'radio-personal-playlists.json';
const CLIENTE = 'https://accounts.google.com/gsi/client';

let tokenAcesso = null;
let expira = 0;

/** Client ID OAuth configurado? (Configurações → campo "OAuth Client ID") */
export function configurado() { return Boolean(getConfig().oauthClientId?.trim()); }

function carregarGSI() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (!window.__gsiPromise) {
    window.__gsiPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = CLIENTE; s.async = true; s.defer = true;
      s.onload = () => res(window.google.accounts.oauth2);
      s.onerror = () => rej(new Error('Falha ao carregar o login do Google (rede?).'));
      document.head.appendChild(s);
    });
  }
  return window.__gsiPromise;
}

/** Fluxo de login → token (renova se expirado). */
async function obterToken() {
  if (tokenAcesso && Date.now() < expira - 30_000) return tokenAcesso;
  const cid = getConfig().oauthClientId?.trim();
  if (!cid) throw new Error('Configure o "OAuth Client ID" em Configurações para salvar no Drive.');
  const oauth = await carregarGSI();
  return new Promise((resolve, reject) => {
    const cliente = oauth.initTokenClient({
      client_id: cid,
      scope: ESCOPO,
      callback: (resp) => {
        if (resp.error) return reject(new Error('Login Google cancelado: ' + resp.error));
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
  const pastaId = getConfig().driveFonte?.trim();
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
  const pastaId = getConfig().driveFonte?.trim();
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
