/**
 * youtube.js — Canais do YouTube → programação da rádio.
 * 1) Cadastro de canais (link, @handle ou ID UC…)
 * 2) Busca dos vídeos mais recentes (YouTube Data API v3, chave gratuita)
 * 3) Reprodução via oficial IFrame API (mini player embutido — à prova de bloqueio)
 *
 * A chave do YouTube é a mesma Cloud key (Data API v3) — informe uma própria em
 * Configurações; em último caso reutiliza a chave Gemini (se habilitada no projeto).
 */
import { getConfig, salvarConfig } from './settings.js';

const API = 'https://www.googleapis.com/youtube/v3';

function chaveYT() {
  const cfg = getConfig();
  return (cfg.youtubeApiKey?.trim() || cfg.apiKey).trim();
}

// ============================================================
// CANAIS — cadastro e resolução de ID
// ============================================================
export function getCanais() { return getConfig().canais ?? []; }

/** Extrai vídeoId de um link do YouTube (watch, shorts, youtu.be). */
export function extrairVideoId(texto = '') {
  const t = texto.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  return t.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? '';
}

/** Extrai handle/eslide de canal de um link ou texto. */
function extrairCanal(texto = '') {
  const t = texto.trim();
  const uc = t.match(/(UC[\w-]{22})/)?.[1];
  if (uc) return { tipo: 'id', valor: uc };
  const h = t.match(/@([\w.-]+)/)?.[1];
  if (h) return { tipo: 'handle', valor: h };
  if (/^@[\w.-]+$/.test(t)) return { tipo: 'handle', valor: t.slice(1) };
  return null;
}

/** Resolve o ID do canal (UC…) e o uploads playlist (UU…). */
export async function resolverCanal(texto) {
  const alvo = extrairCanal(texto);
  if (!alvo) throw new Error('Não consegui identificar este canal. Cole o link (…/@handle ou …/channel/UC…).');
  if (alvo.tipo === 'id') {
    const uploads = 'UU' + alvo.valor.slice(2);
    return { id: alvo.valor, uploads, titulo: alvo.valor };
  }
  // handle → channels?forHandle=
  const key = chaveYT();
  if (!key) throw new Error('Chave do YouTube (Data API v3) ausente. Configure em Configurações → IA.');
  const resp = await fetch(`${API}/channels?part=snippet,contentDetails&forHandle=@${alvo.valor}&key=${key}`);
  if (resp.status === 403) throw new Error('YouTube: acesso negado (403). Verifique a chave e se a "YouTube Data API v3" está habilitada no projeto da chave.');
  if (!resp.ok) throw new Error(`YouTube respondeu ${resp.status}.`);
  const item = (await resp.json()).items?.[0];
  if (!item) throw new Error(`Canal @${alvo.valor} não encontrado.`);
  return {
    id: item.id,
    uploads: item.contentDetails?.relatedPlaylists?.uploads ?? 'UU' + item.id.slice(2),
    titulo: item.snippet?.title ?? alvo.valor,
    thumb: item.snippet?.thumbnails?.default?.url ?? '',
  };
}

/** Adiciona um canal ao cadastro (resolve ID antes). @returns {Promise<{canais, canal}>} */
export async function adicionarCanal(texto) {
  const canal = await resolverCanal(texto);
  const atuais = getCanais();
  if (atuais.some((c) => c.id === canal.id)) throw new Error(`Canal "${canal.titulo}" já está cadastrado.`);
  const novo = { id: canal.id, uploads: canal.uploads, titulo: canal.titulo, adicionado: Date.now() };
  salvarConfig({ canais: [...atuais, novo] });
  return novo;
}

/** Remove canal do cadastro. */
export function removerCanal(id) {
  salvarConfig({ canais: getCanais().filter((c) => c.id !== id) });
}

// ============================================================
// VÍDEOS RECENTES (uploads playlist de cada canal)
// ============================================================
/**
 * Lista os últimos vídeos de cada canal cadastrado (ou da lista passada).
 * @returns {Promise<Array<{videoId, nome, canal, publicado}>>} mais recentes primeiro
 */
export async function listarVideosRecentes(maxPorCanal = 5, canais = getCanais()) {
  if (!canais.length) throw new Error('Nenhum canal cadastrado. Adicione ao menos um canal do YouTube.');
  const key = chaveYT();
  if (!key) throw new Error('Chave do YouTube ausente. Cole uma Data API v3 key em Configurações → IA.');

  const porCanal = await Promise.allSettled(
    canais.map(async (c) => {
      const resp = await fetch(
        `${API}/playlistItems?part=snippet,contentDetails&playlistId=${c.uploads}` +
        `&maxResults=${maxPorCanal}&order=date&key=${key}`);
      if (resp.status === 403) throw new Error(`403 ao consultar "${c.titulo}" — verifique chave/quota da YouTube Data API.`);
      if (!resp.ok) throw new Error(`Erro ${resp.status} em "${c.titulo}".`);
      const json = await resp.json();
      return (json.items ?? []).map((it) => {
        // Shorts/removidos podem não ter título em alguns formatos
        const sn = it.snippet ?? {};
        const nome = it.contentDetails?.title || sn.title || '';
        return {
          videoId: it.contentDetails?.videoId ?? '',
          nome,
          canal: c.titulo,
          publicado: it.contentDetails?.videoPublishedAt ?? sn.publishedAt ?? '',
        };
      }).filter((v) => v.videoId);
    })
  );
  const videos = porCanal
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.publicado) - new Date(a.publicado));
  const erros = porCanal.filter((r) => r.status === 'rejected');
  if (!videos.length && erros.length) throw erros[0].reason;
  return videos;
}

// ============================================================
// MINI PLAYER (obligato IFrame API)
// ============================================================
let ytPlayer = null;
let sdkPromise = null;

function carregarSDK() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!sdkPromise) {
    sdkPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => rej(new Error('Falha ao carregar YouTube IFrame API.'));
      document.head.appendChild(s);
      window.onYouTubeIframeAPIReady = () => res(window.YT);
    });
  }
  return sdkPromise;
}

/** Cria o player uma única vez dentro do contêiner (iframe de 1px escondido atrás do painel do app). */
export async function garantirPlayer() {
  const YT = await carregarSDK();
  if (ytPlayer) return ytPlayer;
  const div = document.createElement('div');
  div.id = 'yt-frame-alvo';
  document.getElementById('yt-moldura')?.appendChild(div);
  ytPlayer = new YT.Player(div, {
    width: 256, height: 144,
    playerVars: { autoplay: 1, playsinline: 1, modestbranding: 1, rel: 0, controls: 0, origin: location.origin },
    events: {
      onStateChange: (e) => {
        // 0 = END → devolve o fluxo ao player do app
        if (e.data === 0) window.__ytFim?.();
        else window.__ytEstado?.(e.data);
      },
      onError: () => window.__ytErro?.(),
    },
  });
  return ytPlayer;
}

/** Toca um vídeo. */
export async function tocarVideo(videoId) {
  const p = await garantirPlayer();
  p.loadVideoById(videoId);
  await definirVisivel(offscreenAtual);
}

let offscreenAtual = false;

/** Mostra/esconde o frame SEM recarregar (display:none mataria a reprodução). */
export async function definirVisivel(visivel) {
  offscreenAtual = !visivel;
  const p = await garantirPlayer();
  try {
    p.setSize(visivel ? 256 : 1, visivel ? 144 : 1);
    const f = p.getIframe?.();
    if (f) {
      f.style.position = visivel ? 'relative' : 'fixed';
      f.style.bottom = visivel ? '' : '-3px';
      f.style.right = visivel ? '' : '0';
      f.style.zIndex = visivel ? '' : '-1';
    }
  } catch { /* noop */ }
}

export function pausar() { try { ytPlayer?.pauseVideo?.(); } catch { /* noop */ } }
export function continuar() { try { ytPlayer?.playVideo?.(); } catch { /* noop */ } }
export function estaTocando() {
  const s = ytPlayer?.getPlayerState?.();
  return s === 1 || s === 3; // playing | buffering
}
export function setVolume(v) { try { ytPlayer?.setVolume?.(Math.round(v)); } catch { /* noop */ } }
export function tempoAtual() { return ytPlayer?.getCurrentTime?.() ?? 0; }
export function duracao() { return ytPlayer?.getDuration?.() ?? 0; }
export function buscarPara(frac) {
  try { ytPlayer?.seekTo?.(frac * (ytPlayer?.getDuration?.() ?? 0), true); } catch { /* noop */ }
}
export function temPlayer() { return Boolean(ytPlayer); }
