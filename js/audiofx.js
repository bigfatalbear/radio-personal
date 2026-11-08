/**
 * audiofx.js — Equalizador (Web Audio API) + visualizador de espectro.
 * Cadeia: <audio> → bass → mid → treble → analyser → saída.
 * Conecta na 1ª reprodução (exige gesto do usuário). Faixas remotas sem CORS
 * ficam mudas no analisador — por isso o modo visualiza respeitandoğ isso
 * com animação de contingência quando o espectro está zerado.
 */
import { getConfig, salvarConfig } from './settings.js';

let ctx = null;
let fonte = null;
let filtros = null;
let analyser = null;
let conectado = false;
let rafId = null;

const canvas = () => document.getElementById('visualizador');
const pulsos = () => [...document.querySelectorAll('.ondalink span')];

function garantirContexto() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

/** Conecta o elemento <audio> à cadeia de filtros (uma única vez). */
export function conectar(audioEl) {
  if (conectado || !audioEl) return;
  garantirContexto();
  try {
    fonte = ctx.createMediaElementSource(audioEl);
    filtros = {
      bass: ctx.createBiquadFilter(),
      mid: ctx.createBiquadFilter(),
      treble: ctx.createBiquadFilter(),
    };
    filtros.bass.type = 'lowshelf';  filtros.bass.frequency.value = 200;
    filtros.mid.type = 'peaking';    filtros.mid.frequency.value = 1200; filtros.mid.Q.value = 1;
    filtros.treble.type = 'highshelf'; filtros.treble.frequency.value = 4200;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    let visinho = fonte;
    for (const f of [filtros.bass, filtros.mid, filtros.treble, analyser]) {
      visinho.connect(f); visinho = f;
    }
    analyser.connect(ctx.destination);
    conectado = true;
    aplicarValores();
    iniciarVisualizador();
  } catch (err) {
    console.warn('Falha ao conectar o equalizador:', err);
  }
}

/** Aplica os níveis salvos nos filtros Biquad. */
export function aplicarValores() {
  if (!conectado) return;
  const eq = getConfig().eq ?? { bass: 0, mid: 0, treble: 0 };
  filtros.bass.gain.value = Number(eq.bass) || 0;
  filtros.mid.gain.value = Number(eq.mid) || 0;
  filtros.treble.gain.value = Number(eq.treble) || 0;
}

/** Salva e aplica valores do equalizador {@param níveis em dB, -10..10}. */
export function setEq({ bass, mid, treble }) {
  salvarConfig({ eq: { bass, mid, treble } });
  aplicarValores();
  if (!conectado && (bass || mid || treble)) {
    // Auto-conecta quando o usuário mexe no EQ (gesto até aqui já houve)
    conectar(document.getElementById('audio') || document.querySelector('audio'));
  }
}

/** Ativa/desativa o visualizador + quando desligado volta à animação CSS. */
export function iniciarVisualizador() {
  const cv = canvas();
  if (!cv || rafId) return;
  const c2d = cv.getContext('2d');
  const desenhar = () => {
    rafId = requestAnimationFrame(desenhar);
    const w = cv.width = cv.clientWidth;
    const h = cv.height = cv.clientHeight;
    c2d.clearRect(0, 0, w, h);
    let dados = null;
    let energiaTotal = 0;
    if (conectado && analyser && getConfig().eq?.visualizador !== false) {
      dados = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dados);
      energiaTotal = dados.reduce((s, v) => s + v, 0);
    }
    // Sem espectro real (faixa remota sem CORS) → onda sintética elegante
    const sintetica = !dados || energiaTotal === 0;
    const nBarras = 28;
    const gap = 2;
    const largura = (w - gap * (nBarras - 1)) / nBarras;
    const estilo = getComputedStyle(document.documentElement);
    const corA = estilo.getPropertyValue('--rp-ciano')?.trim() || '#22d3ee';
    const corB = estilo.getPropertyValue('--rp-acento')?.trim() || '#34d399';
    const grad = c2d.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, corA); grad.addColorStop(1, corB);
    c2d.fillStyle = grad;
    c2d.shadowColor = corB;
    c2d.shadowBlur = 6;
    const t = performance.now() / 320;
    for (let i = 0; i < nBarras; i++) {
      const valor = sintetica
        ? (Math.abs(Math.sin(t + i * 0.55)) * 0.7 + 0.15)
        : (dados[i * 4] ?? 0) / 255;
      const altura = Math.max(2, valor * h * 0.92);
      const x = i * (largura + gap);
      const y = h - altura;
      c2d.beginPath();
      c2d.roundRect?.(x, y, largura, altura, largura / 2);
      if (!c2d.roundRect) c2d.rect(x, y, largura, altura);
      c2d.fill();
    }
  };
  rafId = requestAnimationFrame(desenhar);
}

/** Abafa a música durante locução TTS (hook usado por tts.js). */
export function instalarAbafar(audioEl) {
  window.__radioAbafar = (ativar) => {
    if (!conectado) return null;
    const alvo = ativar ? 0.25 : 1.0;
    for (const f of [filtros.bass, filtros.mid, filtros.treble]) {
      const original = f.gain.value;
      f.gain.setTargetAtTime(ativar ? Math.max(-12, original - 8) : original, ctx.currentTime, 0.1);
    }
    // O abafo é feito apenas pelos filtros (−8 dB), sem mexer no volume geral
    return ativar ? 0.25 : 1.0;
  };
}
