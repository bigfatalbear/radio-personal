/**
 * player.js — Motor de reprodução (HTMLAudioElement) e fila de execução.
 * Controles: play/pause, próxima, anterior, barra de progresso, volume,
 * shuffle. Todos os eventos expostos via callbacks para renderização na UI.
 */
import { urlStream } from './drive.js';
import { resolverOffline } from './offline.js';
import { ttsAtivo, anunciarFaixa, parar as pararTTS } from './tts.js';
import { conectar as conectarFX, instalarAbafar } from './audiofx.js';

const audio = new Audio();
audio.preload = 'metadata';

// ===== MediaSession: controles na tela de bloqueio + áudio garantido desligado =====
const mediaSession = navigator.mediaSession;
mediaSession?.setActionHandler?.('play', () => playPause());
mediaSession?.setActionHandler?.('pause', () => playPause());
mediaSession?.setActionHandler?.('previoustrack', () => anterior());
mediaSession?.setActionHandler?.('nexttrack', () => proxima());
mediaSession?.setActionHandler?.('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
mediaSession?.setActionHandler?.('seekforward', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

// ===== Estado =====
let fila = [];        // [{origem: 'drive'|'local', id?: string, url?: string, nome: string}]
let indiceAtual = -1;
let shuffle = false;
let filaBase = [];    // ordem original (para restaurar ao desligar shuffle)

// ===== Callbacks registrados por app.js =====
export const callbacks = {
  onRender: () => {},           // setFila/index mudou
  onStatus: () => {},           // play/pause/loading
  onProgresso: () => {},        // timeupdate
};

// ===== Filas =====
export function getFila() { return fila; }
export function getIndice() { return indiceAtual; }
export function getAtual() { return fila[indiceAtual] ?? null; }
export function isShuffle() { return shuffle; }

/**
 * Define a playlist. `faixas` pode conter itens do Drive ({id, nome}) ou
 * locais ({url, nome}).
 */
export function setFila(faixas) {
  filaBase = faixas.map(normalizar);
  fila = shuffle ? [...filaBase].sort(() => Math.random() - 0.5) : [...filaBase];
  callbacks.onRender();
}

/** Adiciona faixas ao fim da fila atual (arquivos locais via <input type=file>) */
export function adicionarLocais(arquivos) {
  const novos = [...arquivos]
    .filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|wav)$/i.test(f.name))
    .map((f) => ({ origem: 'local', url: URL.createObjectURL(f), nome: f.name.replace(/\.[^.]+$/, '') }));
  if (novos.length === 0) return 0;
  filaBase = [...filaBase, ...novos];
  fila = shuffle ? [...filaBase].sort(() => Math.random() - 0.5) : filaBase;
  callbacks.onRender();
  return novos.length;
}

/** Alterna shuffle (reembaralha a fila, preservando a atual no início) */
export function toggleShuffle() {
  shuffle = !shuffle;
  if (shuffle) {
    const atual = getAtual();
    fila = filaBase
      .filter((f) => f !== atual)
      .sort(() => Math.random() - 0.5);
    if (atual) fila.unshift(atual);
    indiceAtual = atual ? 0 : -1;
  } else {
    fila = [...filaBase];
    if (indiceAtual >= 0 && getAtual()) indiceAtual = filaBase.indexOf(getAtual());
  }
  callbacks.onRender();
  return shuffle;
}

function normalizar(f) {
  if (f.url) return { ...f, origem: f.origem ?? 'local' };
  return { ...f, origem: f.origem ?? 'drive', url: urlStream(f.id) };
}
function normalizarFaixa(f) { return normalizar(f); } // alias de compatibilidade

// ===== Controles =====
export async function tocar(indice = null) {
  if (indice !== null) indiceAtual = indice;
  const faixa = getAtual();
  if (!faixa) return;
  normalizarFaixa(faixa);

  // 1) Cache offline primeiro (sem rede); 2) stream normal como fallback
  let url = await resolverOffline(faixa);
  if (!url) url = faixa.url;

  if (!document.getElementById('audio-eq-conectado')) {
    conectarFX(audio);              // equalizador (conecta na 1ª go — gesto já houve)
    instalarAbafar(audio);
    document.body.appendChild(Object.assign(document.createElement('span'), { id: 'audio-eq-conectado', hidden: '' }));
  }

  audio.src = url;
  audio.load();
  // Metadados para a tela de bloqueio/notificação (capa = logo da rádio, se houver)
  if (mediaSession) {
    mediaSession.metadata = new MediaMetadata({
      title: faixa.nome,
      artist: nomeRadio,
      album: 'Rádio Personal',
      artwork: window.__radioLogoUrl ? [{ src: window.__radioLogoUrl, sizes: '256x256', type: 'image/png' }] : [],
    });
    mediaSession.playbackState = 'playing';
  }
  try {
    await audio.play();
    callbacks.onStatus('tocando');
  } catch (e) {
    // Falhas do Drive (arquivo privado / CORS) geram erro no elemento <audio>
    callbacks.onStatus('erro');
  }
}

export function playPause() {
  if (indiceAtual === -1 && fila.length) return tocar(0);
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  callbacks.onStatus(audio.paused ? 'pausado' : 'tocando');
}

export function proxima() {
  if (indiceAtual < fila.length - 1) return tocar(indiceAtual + 1);
  // Fim da fila: reinicia do começo (streaming contínuo de rádio)
  if (fila.length) tocar(0);
}

export function anterior() {
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  if (indiceAtual > 0) tocar(indiceAtual - 1);
}

export function setVolume(v) { audio.volume = Math.min(1, Math.max(0, v / 100)); }

export function seek(fraction) {
  if (audio.duration && isFinite(audio.duration)) audio.currentTime = fraction * audio.duration;
}

// ===== Eventos do <audio> =====
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  callbacks.onProgresso({
    atual: audio.currentTime,
    duracao: d,
    frac: d ? audio.currentTime / d : 0,
  });
});
audio.addEventListener('ended', async () => {
  // Locução TTS entre faixas: anuncia a próxima antes de tocá-la
  const proximaFaixa = fila[indiceAtual + 1] ?? (fila.length ? fila[0] : null);
  if (ttsAtivo() && proximaFaixa) {
    callbacks.onStatus('pausado');
    await anunciarFaixa(proximaFaixa, obterNomeRadio());
    tocar(indiceAtual + 1 < fila.length ? indiceAtual + 1 : 0);
    return;
  }
  proxima();
});
audio.addEventListener('play', () => { callbacks.onStatus('tocando'); mediaSession && (mediaSession.playbackState = 'playing'); });
audio.addEventListener('pause', () => { pararTTS(); mediaSession && (mediaSession.playbackState = 'paused'); callbacks.onStatus('pausado'); });
audio.addEventListener('error', () => {
  // Arquivo do Drive indisponível (privado/CORS)? Pula para a próxima.
  pararTTS();
  if (fila.length) proxima();
});

/** Nome da rádio injetado por app.js (usado na locução TTS). */
let nomeRadio = 'Rádio Personal';
export function setNomeRadio(n) { nomeRadio = n || nomeRadio; }
function obterNomeRadio() { return nomeRadio; }

/** Formata segundos em mm:ss */
export function mmss(seg) {
  if (!isFinite(seg)) return '0:00';
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
