/**
 * theme.js — Tema personalizável a partir de uma imagem.
 *
 * Fluxo: o usuário envia uma imagem (logo/capa) → extraímos a cor de
 * destaque via <canvas> (quantização por buckets + escolha da tonalidade
 * mais vívida frequente) → normalizamos (HSL clamped para contraste em
 * fundo escuro) → injetamos como variáveis CSS no :root.
 * A paleta extraída é salva no localStorage junto das configurações.
 */

/** Aplica a paleta no documento (variáveis CSS usadas por styles.css) */
export function aplicarTema({ acento }) {
  if (!acento) return;
  const { h, s, l } = rgbToHsl(...hexToRgb(acento));

  // Acento principal: saturação viva, luminância entre 45–72% (contraste no dark)
  const vivid = hslToHex(h, Math.min(92, Math.max(55, s)), Math.min(72, Math.max(45, l)));
  // Variantes derivadas
  const suave = hslToHex(h, Math.min(92, Math.max(55, s)), 65) + '26'; // ~15% alpha (fundo do badge AO VIVO)
  const borda = hslToHex(h, Math.min(92, Math.max(55, s)), 65) + '55';
  const base = Math.min(80, Math.max(55, l));
  const hover = hslToHex(h, Math.min(95, Math.max(60, s)), Math.min(80, base + 10));
  const escuro = hslToHex(h, Math.min(80, s), 14); // faixa "tocando"

  const r = document.documentElement.style;
  r.setProperty('--rp-acento', vivid);
  r.setProperty('--rp-acento-hover', hover);
  r.setProperty('--rp-acento-suave', suave);
  r.setProperty('--rp-acento-borda', borda);
  r.setProperty('--rp-acento-escuro', escuro);

  // Cor do tema no navegador (barra do Chrome/Android etc.)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#09090b';

  return { acento: vivid, suave, borda, hover, escuro };
}

/**
 * Extrai a paleta de destaque de uma imagem (dataURL ou URL).
 * Faz downscale para 48px, quantiza cores em buckets de 5 bits e
 * elege a cor mais frequente que tenha saturação significativa.
 */
export async function extrairPaleta(src) {
  const img = await carregarImagem(src);
  const cv = document.createElement('canvas');
  const ESCALA = 48;
  const propor = Math.min(ESCALA / img.width, ESCALA / img.height);
  cv.width = Math.max(1, Math.round(img.width * propor));
  cv.height = Math.max(1, Math.round(img.height * propor));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const dados = ctx.getImageData(0, 0, cv.width, cv.height).data;

  // Contagem por bucket (quantização a 3 bits por canal + bits de saturação implícitos)
  const buckets = new Map();
  for (let i = 0; i < dados.length; i += 4) {
    const alpha = dados[i + 3];
    if (alpha < 128) continue;
    const r8 = dados[i], g8 = dados[i + 1], b8 = dados[i + 2];

    // Descarta quase-preto/quase-branco/cinza puro (fundo/contorno)
    const { h, s, l } = rgbToHsl(r8, g8, b8);
    if (s < 0.18 || l < 0.08 || l > 0.92) continue;

    const chave = `${r8 >> 3}_${g8 >> 3}_${b8 >> 3}`; // 32 níveis por canal
    const atual = buckets.get(chave);
    if (atual) { atual.n++; atual.r += r8; atual.g += g8; atual.b += b8; }
    else buckets.set(chave, { n: 1, r: r8, g: g8, b: b8, h, s, l });
  }

  if (buckets.size === 0) {
    throw new Error('Não foi possível extrair cores dessa imagem (muito escura/clara/sem saturação).');
  }

  // Prefere a cor mais frequente; em caso de empate, a mais saturada
  let melhor = null, melhorScore = -1;
  for (const b of buckets.values()) {
    const rAvg = b.r / b.n, gAvg = b.g / b.n, bAvg = b.b / b.n;
    const { h, s } = rgbToHsl(rAvg, gAvg, bAvg);
    // score = frequência × saturação (prêmia cores vivas predominantes)
    const score = Math.log(b.n + 1) * (0.35 + s);
    if (score > melhorScore) { melhorScore = score; melhor = hslToHex(h, Math.min(95, Math.max(50, s * 100)), 58); }
  }

  return { acento: melhor };
}

/** Redimensiona a imagem para dataURL leve (adequado ao localStorage). */
export async function redimensionarImagem(src, tamanho = 256, qualidade = 0.82) {
  const img = await carregarImagem(src);
  const propor = Math.min(tamanho / img.width, tamanho / img.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * propor));
  cv.height = Math.max(1, Math.round(img.height * propor));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', qualidade);
}

// ============================================================
// Utilidades de conversão
// ============================================================
function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem. Use um arquivo local ou uma URL acessível (CORS liberado).'));
    img.src = src;
  });
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const cor = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
    return Math.round(255 * cor).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
