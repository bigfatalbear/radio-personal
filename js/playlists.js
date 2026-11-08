/**
 * playlists.js — Playlists salvas e favoritos (localStorage).
 * Favoritos: nomes de faixas marcados com ♥ e persistidos para sempre.
 */
const KEY_PLAYLISTS = 'radioPersonal:playlists';
const KEY_FAVORITOS = 'radioPersonal:favoritos';

function ler(key, padrao) {
  try { return JSON.parse(localStorage.getItem(key)) ?? padrao; } catch { return padrao; }
}
function gravar(key, valor) { localStorage.setItem(key, JSON.stringify(valor)); }

// ===== Favoritos =====
export function getFavoritos() { return ler(KEY_FAVORITOS, []); }
export function ehFavorito(nome) { return getFavoritos().includes(nome); }

/** Alterna o favorito de uma faixa. @returns {boolean} novo estado */
export function alternarFavorito(nome) {
  const atuais = getFavoritos();
  const i = atuais.indexOf(nome);
  if (i >= 0) atuais.splice(i, 1); else atuais.push(nome);
  gravar(KEY_FAVORITOS, atuais);
  return i < 0;
}

// ===== Playlists =====
export function getPlaylists() { return ler(KEY_PLAYLISTS, []); }

/**
 * Salva a fila atual como playlist (mantém objetos de faixa completos:
 * {id?, nome, origem?}).
 */
export function salvarPlaylist(nome, faixas) {
  if (!nome?.trim()) throw new Error('A playlist precisa de um nome.');
  if (!faixas?.length) throw new Error('A fila está vazia — nada a salvar.');
  const listas = getPlaylists();
  const existente = listas.find((p) => p.nome === nome.trim());
  if (existente) existente.faixas = faixas.map(({ id, nome: n, origem, url }) => (origem === 'local' ? { nome: n, origem, url } : { id, nome: n, origem: 'drive' }));
  else listas.push({ id: `pl-${Date.now()}`, nome: nome.trim(), criada: Date.now(), faixas: faixas.map(({ id, nome: n, origem, url }) => (origem === 'local' ? { nome: n, origem, url } : { id, nome: n, origem: 'drive' })) });
  gravar(KEY_PLAYLISTS, listas);
  return listas.length;
}

/** Remove playlist pelo id. */
export function removerPlaylist(id) {
  gravar(KEY_PLAYLISTS, getPlaylists().filter((p) => p.id !== id));
}

/** Carrega playlist: devolve suas faixas (objetos) para player.setFila(). */
export function carregarPlaylist(id) {
  const p = getPlaylists().find((x) => x.id === id);
  if (!p) throw new Error('Playlist não encontrada.');
  return p.faixas.filter((f) => f.origem !== 'local' || f.url);
}

/**
 * Adiciona a playlist. `faixas` = array de {id?, nome, origem?, videoId?}.
 */
function limparFaixa(f) {
  if (f.origem === 'youtube') return { origem: 'youtube', videoId: f.videoId, nome: f.nome, canal: f.canal };
  if (f.origem === 'local') return { origem: 'local', nome: f.nome, url: f.url };
  return { origem: 'drive', id: f.id, nome: f.nome };
}

export function renomearPlaylist(id, novoNome) {
  if (!novoNome?.trim()) throw new Error('Novo nome vazio.');
  const listas = getPlaylists();
  const p = listas.find((x) => x.id === id);
  if (!p) throw new Error('Playlist não encontrada.');
  p.nome = novoNome.trim();
  gravar(KEY_PLAYLISTS, listas);
}

/** Move (reordena) faixa dentro da playlist. */
export function trocarFaixa(id, de, para) {
  const listas = getPlaylists();
  const p = listas.find((x) => x.id === id);
  if (!p) throw new Error('Playlist não encontrada.');
  const [f] = p.faixas.splice(de, 1);
  p.faixas.splice(para, 0, f);
  gravar(KEY_PLAYLISTS, listas);
}

/** Remove faixa da playlist pelo índice. */
export function removerFaixa(id, index) {
  const listas = getPlaylists();
  const p = listas.find((x) => x.id === id);
  if (!p) throw new Error('Playlist não encontrada.');
  p.faixas.splice(index, 1);
  gravar(KEY_PLAYLISTS, listas);
}

/** Importa playlists + favoritos (JSON salvo no Drive), mesclando com as locais. */
export function importarDoDrive(listas, favoritos = []) {
  if (!Array.isArray(listas)) throw new Error('Formato de sincronização inesperado.');
  const atuais = getPlaylists();
  const mapa = new Map(atuais.map((p) => [p.id, p]));
  for (const p of listas) {
    if (!p?.id) continue;
    mapa.set(p.id, { ...mapa.get(p), ...p, faixas: (p.faixas ?? []).map(limparFaixa) });
  }
  gravar(KEY_PLAYLISTS, [...mapa.values()]);
  if (Array.isArray(favoritos) && favoritos.length) {
    gravar(KEY_FAVORITOS, [...new Set([...getFavoritos(), ...favoritos])]);
  }
}

/** JSON completo de playlists + favoritos (para salvar no Drive). */
export function exportarParaDrive() {
  return {
    playlists: getPlaylists().map((p) => ({ ...p, faixas: p.faixas.map(limparFaixa) })),
    favoritos: getFavoritos(),
    exportado: Date.now(),
  };
}
