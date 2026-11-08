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

/** Monta a URL de listagem (chave e ID codificados; suporta Drives compartilhados e paginação). */
export function montarUrlListagem(folderId, apiKey, pageToken = '') {
  const p = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken,files(id,name,mimeType,size)',
    orderBy: 'name',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key: apiKey,
  });
  if (pageToken) p.set('pageToken', pageToken);
  return `https://www.googleapis.com/drive/v3/files?${p}`;
}

/** Traduz o erro do provedor em mensagem acionável, sem expor a chave. */
export function mensagemErroDrive(status, corpo, apiKey = '') {
  const err = corpo?.error ?? {};
  const motivo = err.errors?.[0]?.reason || err.details?.find?.((d) => d.reason)?.reason || '';
  let detalhe = String(err.message || '');
  if (apiKey) detalhe = detalhe.split(apiKey).join('***');
  const sufixo = detalhe ? ` Detalhe do Google: ${detalhe}` : '';

  if (/API_KEY_INVALID|keyInvalid/i.test(motivo) || /API key not valid/i.test(detalhe)) {
    return 'API Key do Google inválida (400). Copie a chave novamente, sem espaços, em Configurações.';
  }
  if (/API_KEY_HTTP_REFERRER_BLOCKED|ipRefererBlocked/i.test(motivo) || /referer/i.test(detalhe)) {
    return 'A API Key bloqueia este site (restrição de referenciador). Adicione https://bigfatalbear.github.io/* nas restrições da chave.';
  }
  if (/invalid.*(value|query)|invalidQuery|badRequest/i.test(motivo + ' ' + detalhe) && status === 400) {
    return `Pedido inválido ao Drive (400): ID da pasta provavelmente incorreto. Cole o link da pasta em Configurações.${sufixo}`;
  }
  if (status === 400) return `Pedido recusado pelo Drive (400). Verifique a API Key e o link da pasta.${sufixo}`;
  if (status === 401) return 'Credencial rejeitada pelo Drive (401). Verifique a API Key.';
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(motivo + ' ' + detalhe)) {
      return 'A Drive API não está ativada para o projeto desta chave. Ative "Google Drive API" no Google Cloud Console.';
    }
    if (/rateLimit|quota/i.test(motivo + ' ' + detalhe)) return 'Cota da API do Drive excedida (403). Tente novamente mais tarde.';
    return 'Acesso negado pelo Drive (403). Confirme que a pasta é pública ("qualquer pessoa com o link") e que a chave permite a Drive API.';
  }
  if (status === 404) return 'Pasta do Drive não encontrada (404). Verifique o ID/link em Configurações e o compartilhamento.';
  if (status === 429) return 'Muitas requisições ao Drive (429). Aguarde um pouco e tente de novo.';
  return `Erro do Drive (${status}) ao listar arquivos.${sufixo}`;
}

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

  const apiKey = String(cfg.driveApiKey || cfg.apiKey || '').trim(); // reutiliza a mesma chave por padrão
  if (!apiKey) {
    throw new Error('Uma API Key do Google é necessária para ler o Drive. Configure uma no painel de Configurações.');
  }

  const arquivos = [];
  let pageToken = '';
  for (let pagina = 0; pagina < 20; pagina++) {
    let resp;
    try {
      resp = await fetch(montarUrlListagem(folderId, apiKey, pageToken));
    } catch (e) {
      throw new Error('Falha de rede ao consultar o Google Drive. Verifique sua conexão.');
    }
    if (!resp.ok) {
      let corpo = null;
      try { corpo = await resp.json(); } catch { /* corpo não-JSON */ }
      throw new Error(mensagemErroDrive(resp.status, corpo, apiKey));
    }
    const json = await resp.json();
    arquivos.push(...(json.files ?? []));
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }

  const faixas = arquivos
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
