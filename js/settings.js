/**
 * settings.js — Persistência das configurações via localStorage.
 * Escopo: chaves de IA, fonte do Drive e metadados da rádio.
 * Nada aqui sai do navegador do usuário.
 */
const STORAGE_KEY = 'radioPersonal:config';

// Estrutura padrão (mesclada com o que já estiver salvo)
export const CONFIG_PADRAO = {
  provedor: 'gemini',        // 'gemini' | 'openai' | 'groq'
  apiKey: 'AIzaSyA3JvUFthh4AWBfIHeiOhCPvKvaBRTL1Uk',
  driveFonte: 'https://drive.google.com/drive/folders/1IWWm2UM0U9yc6Dnf65KOfqCt4ySKSYc_?usp=drive_link', // link público da pasta de músicas
  rádio: {
    nome: 'Rádio Personal',
    slogan: 'Sua rádio, seu estilo',
    logo: '',
  },
  tts: { ativo: false, voz: '', velocidade: 1, estilo: 'padrao' }, // locução automática
  eq: { bass: 0, mid: 0, treble: 0, visualizador: true },          // equalizador
  programacoes: [],           // grade horária automática (scheduler.js)
  wakelock: { ativo: true, avisos: { bateria: false, chrome: false } }, // modo rádio (tela acordada)
};

let cache = null;

function eObjetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function mesclarObjetos(base, parcial) {
  const resultado = { ...base };
  for (const [chave, valor] of Object.entries(parcial ?? {})) {
    if (eObjetoSimples(valor) && eObjetoSimples(resultado[chave])) {
      resultado[chave] = mesclarObjetos(resultado[chave], valor);
      continue;
    }
    resultado[chave] = valor;
  }
  return resultado;
}

/** Lê as configurações (cache em memória) */
export function getConfig() {
  if (cache) return cache;
  try {
    cache = mesclarObjetos(CONFIG_PADRAO, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    cache = { ...CONFIG_PADRAO };
  }
  return cache;
}

/** Salva (merge) e atualiza o cache em memória */
export function salvarConfig(parcial) {
  const atual = getConfig();
  cache = mesclarObjetos(atual, parcial ?? {});
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  return cache;
}

/** Extrai o ID de pasta do Drive de um link ou aceita o ID direto. */
export function extrairDriveId(texto = '') {
  const t = texto.trim();
  if (!t) return '';
  // https://drive.google.com/drive/folders/ID?usp=sharing
  const m1 = t.match(/drive\.google\.com\/(?:drive|file)\/[^/]*folders\/([-\w]{10,})/);
  const m2 = t.match(/folders\/([-\w]{10,})/);
  const m3 = t.match(/id=([-\w]{10,})/);
  if (m1) return m1[1];
  if (m2) return m2[1];
  if (m3) return m3[1];
  // Parece um ID puro? (20+ chars, sem barras/espaços)
  if (/^[-\w]{20,}$/.test(t)) return t;
  return '';
}
