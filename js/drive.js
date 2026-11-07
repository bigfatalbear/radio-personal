/**
 * drive.js — Leitura da pasta pública do Google Drive.
 * Usa a API pública de listagem (sem OAuth, pasta compartilhada "com o link"):
 *   GET https://www.googleapis.com/drive/v3/files?q='<folderId>' in parents&key=API_KEY
 * A API Key pode ser a mesma do Gemini ou uma chave dedicada do Cloud Console.
 * Suporta também fallback de link direto mapeado tipo
 *   https://drive.usercontent.google.com/download?id=<fileId>&confirm=t
 */
import { getConfig, extrairDriveId } from './settings.js';

/** Extensões de áudio reconhecidas */
export const EXT_AUDIO = /\.(mp3|m4a|aac|ogg|wav|opus|flac)$/i;

/** Cache em memória da última listagem */
let acervoCache = [];

/**
 * Lista os arquivos de áudio da pasta do Drive configurada.
 * @returns {Promise<Array<{id, nome}>} faixas
 */
export async function listarFaixasDrive() {
  const cfg = getConfig();
  const folderId = extrairDriveId(cfg.driveFonte);
  if (!folderId) {
    throw new Error('Nenhuma pasta do Google Drive válida configurada. Vá em Configurações e informe o link público da pasta.');
  }

  const apiKey = getConfig().driveApiKey || cfg.apiKey; // reutiliza a mesma chave por padrão
  if (!apiKey) {
    throw new Error('Uma API Key do Google é necessária para ler o Drive. Configure uma no painel de Configurações.');
  }

  const endpoint =
    `https://www.googleapis.com/drive/v3/files` +
    `?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}` +
    `&fields=files(id,name,mimeType,size)` +
    `&orderBy=name` +
    `&pageSize=500` +
    `&key=${apiKey}`;

  let resp;
  try {
    resp = await fetch(endpoint);
  } catch (e) {
    throw new Error('Falha de rede ao consultar o Google Drive. Verifique sua conexão.');
  }

  if (resp.status === 403) {
    throw new Error('Acesso negado pelo Drive (403). Confirme que a pasta é pública e que a API Key tem a Drive API ativada no Google Cloud Console.');
  }
  if (resp.status === 404) {
    throw new Error('Pasta do Drive não encontrada. Verifique o ID/link em Configurações.');
  }
  if (!resp.ok) {
    throw new Error(`Erro do Drive (${resp.status}) ao listar arquivos.`);
  }

  const json = await resp.json();
  const faixas = (json.files ?? [])
    .filter((f) => EXT_AUDIO.test(f.name) || f.mimeType?.startsWith('audio/'))
    .map((f) => ({ id: f.id, nome: f.name.replace(EXT_AUDIO, '') }));

  if (faixas.length === 0) {
    throw new Error('Nenhum arquivo de áudio (mp3, m4a, aac...) encontrado na pasta informada.');
  }

  acervoCache = faixas;
  return faixas;
}

/** Retorna o acervo em cache (para a IA sugerir ordem de reprodução). */
export function getAcervo() {
  return acervoCache;
}

/** URL de streaming direto de um arquivo do Drive (fallback público sem API Key). */
export function urlStream(fileId) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&confirm=t`;
}
