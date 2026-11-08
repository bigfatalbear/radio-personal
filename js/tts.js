/**
 * tts.js — Locução automática (Web Speech API / speechSynthesis).
 * Fala anúncios entre uma faixa e outra usando as vozes do próprio dispositivo.
 * Nenhum servidor envolvido: funciona offline.
 */
import { getConfig } from './settings.js';

let pronta = false;
let vozes = [];

function atualizarVozes() {
  vozes = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
  if (!vozes.length) vozes = speechSynthesis.getVoices(); // fallback: qualquer voz
  pronta = vozes.length > 0;
}
if ('speechSynthesis' in window) {
  atualizarVozes();
  speechSynthesis.onvoiceschanged = atualizarVozes;
}

/** Lista de vozes disponíveis ({nome, lang}) para a UI de configuração. */
export function listarVozes() {
  if (!('speechSynthesis' in window)) return [];
  if (!pronta) atualizarVozes();
  return vozes.map((v) => ({ nome: v.name, lang: v.lang, uri: v.voiceURI }));
}

/** Locução ativada nas configurações? */
export function ttsAtivo() {
  const cfg = getConfig();
  return Boolean(cfg.tts?.ativo) && 'speechSynthesis' in window;
}

function escolherVoz() {
  const uri = getConfig().tts?.voz;
  if (uri) {
    const achou = vozes.find((v) => v.voiceURI === uri);
    if (achou) return achou;
  }
  return vozes.find((v) => v.lang.toLowerCase().startsWith('pt-br'))
    ?? vozes.find((v) => v.lang.toLowerCase().startsWith('pt'))
    ?? vozes[0] ?? null;
}

/**
 * Fala um texto. Resolves quando a fala termina (ou é cortada).
 * @returns {Promise<void>}
 */
export function falar(texto, velocidade = 1) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !texto?.trim()) return resolve();
    speechSynthesis.cancel(); // corta fala anterior
    const u = new SpeechSynthesisUtterance(texto);
    const v = escolherVoz();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'pt-BR';
    u.rate = velocidade;
    u.pitch = 1;
    // Redução de volume da música enquanto a locução fala
    const antes = window.__radioAbafar?.(true) ?? null; // hook do player
    u.onend = u.onerror = () => {
      window.__radioAbafar?.(false);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

/** Cancela qualquer fala em andamento. */
export function parar() {
  try { speechSynthesis?.cancel(); } catch { /* noop */ }
}

/** Fala o anúncio padrão de rádio para uma faixa ("Você está ouvindo …"). */
export async function anunciarFaixa(faixa, nomeRadio) {
  if (!ttsAtivo() || !faixa) return;
  const estilo = getConfig().tts?.estilo ?? 'padrao';
  const saudacoes = {
    padrao: (n) => `Você está ouvindo ${n}, aqui na ${nomeRadio}!`,
    formal: (n) => `Em seguida, ${n}, na programação da ${nomeRadio}.`,
    festa: (n) => `Aiii vaaai! ${n}, direto para vocês! É a ${nomeRadio} no comando!`,
  };
  const template = saudacoes[estilo] ?? saudacoes.padrao;
  await falar(template(faixa.nome), Number(getConfig().tts?.velocidade) || 1);
}

/** Fala um texto livre (ex.: locução de abertura da programação IA). */
export async function falarLocucao(texto) {
  const cfg = getConfig();
  await falar(texto ?? '', Number(cfg.tts?.velocidade) || 0.95);
}
