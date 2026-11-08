/**
 * offline.js — Cache de músicas via Cache Storage para ouvir sem internet.
 * Cada faixa é baixada uma vez e guardada em `radioPersonal:audio`.
 * Chave sintética: https://offline.radio-p/track/<id ou slug-do-nome>
 */
import { getConfig } from './settings.js';

const CACHE_AUDIO = 'radioPersonal:audio';

/** Chave estável de uma faixa (id do Drive ou nome do arquivo local). */
export function chaveFaixa(f) {
  const slug = (f.nome || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return f.id ? `id:${f.id}` : `nome:${slug}`;
}

function reqDe(f) {
  return new Request(`https://offline.radio-p/track/${encodeURIComponent(chaveFaixa(f))}`);
}

/** A faixa já está no cache offline? */
export async function estaOffline(f) {
  if (!('caches' in window)) return false;
  try {
    const c = await caches.open(CACHE_AUDIO);
    const hit = await c.match(reqDe(f));
    return Boolean(hit);
  } catch { return false; }
}

/** Lista de chaves já baixadas. */
export async function listaOffline() {
  if (!('caches' in window)) return [];
  try {
    const c = await caches.open(CACHE_AUDIO);
    return [...(await c.keys())].map((r) => decodeURIComponent(r.url.split('/track/')[1] || ''));
  } catch { return []; }
}

/** Quantidade de faixas baixadas + tamanho estimado em MB. */
export async function estatisticasOffline() {
  if (!('caches' in window)) return { n: 0, mb: 0 };
  try {
    const c = await caches.open(CACHE_AUDIO);
    const resps = await Promise.all([...(await c.keys())].map((k) => c.match(k)));
    let bytes = 0;
    for (const r of resps) if (r) {
      const len = r.headers.get('content-length');
      bytes += len ? Number(len) : 0;
    }
    return { n: resps.filter(Boolean).length, mb: Math.round(bytes / 1048576) };
  } catch { return { n: 0, mb: 0 }; }
}

/** Baixa uma faixa para o cache (usa a URL de stream). */
export async function baixarFaixa(f, url) {
  const c = await caches.open(CACHE_AUDIO);
  const req = reqDe(f);
  const hit = await c.match(req);
  if (hit) return hit;
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`Falha ao baixar "${f.nome}" (${resp.status}).`);
  await c.put(req, resp.clone());
  return resp;
}

/** Remove uma faixa do cache ou limpa tudo quando `todas` = true. */
export async function removerOffline(f) {
  const c = await caches.open(CACHE_AUDIO);
  if (f) return c.delete(reqDe(f));
  return c.keys().then((ks) => Promise.all(ks.map((k) => c.delete(k))));
}

/**
 * Resolve a URL que deve ir para o <audio>: cache offline primeiro.
 * @returns {Promise<string|null>} blob URL do cache, ou null (usar a rede)
 */
export async function resolverOffline(f) {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open(CACHE_AUDIO);
    const hit = await c.match(reqDe(f));
    if (hit) {
      const blob = await hit.blob();
      return URL.createObjectURL(blob);
    }
  } catch { /* sem cache */ }
  return null;
}
