/**
 * ai.js — Integração com as APIs de IA (Gemini ou OpenAI).
 * Gera a programação da rádio a partir de um prompt estruturado
 * e do acervo de músicas carregado do Drive.
 */
import { getConfig } from './settings.js';

/** Configuração dos provedores de IA suportados (todos OpenAI-compatíveis, exceto Gemini). */
export const PROVEDORES_IA = {
  groq: {
    nome: 'Groq (Llama — gratuito e ultra-rápido)',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelo: 'llama-3.3-70b-versatile',
    site: 'https://console.groq.com/keys',
  },
  gemini: {
    nome: 'Google Gemini (gratuito)',
  },
  openai: {
    nome: 'OpenAI (pago)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    modelo: 'gpt-4o-mini',
    site: 'https://platform.openai.com/api-keys',
  },
};

/** Verifica se a chave de IA está configurada */
export function iaDisponivel() {
  return Boolean(getConfig().apiKey);
}

/** Erro de chave ausente — mensagem clara exibida na UI */
export function erroChaveAusente() {
  return new Error('Chave da API de IA ausente. Configure em Configurações antes de gerar uma programação.');
}

/**
 * Monta o prompt estruturado, incluindo o acervo disponível para que
 * a IA escolha títulos reais entre as músicas do Drive.
 */
function montarPrompt({ descricao, horas, estilo, acervo }) {
  const listaAcervo = acervo.length
    ? acervo.map((f, i) => `${i + 1}. ${f.nome}`).join('\n')
    : '(acervo não carregado — sugira nomes genéricos de faixas)';

  return `Você é um programador musical especialista em rádios FM e rádios web.

TAREFA: montar a programação de ${horas}h para a rádio a partir da descrição do usuário.

DESCRIÇÃO DO USUÁRIO: """${descricao}"""
ESTILO / PERSONA DO LOCUTOR: ${estilo}
ACERVO DISPONÍVEL NO GOOGLE DRIVE (escolha títulos reais desta lista, respeitando a ordem quando houver afinidade temática):
${listaAcervo}

RETORNE EXCLUSIVAMENTE um JSON válido (sem markdown, sem comentários) com o formato:
{
  "nomeBloco": "string (nome do programa/bloco, ex.: 'Flashback 80 — Hora da Saudade')",
  "grade": ["string (faixa horária + atividade, ex.: '14:00–15:00 — Bloco Flashback')"],
  "locucao": "string (texto curto de locução de abertura do bloco, no estilo/persona pedida)",
  "ordemReproducao": ["string (títulos de músicas do acervo, na ordem sugerida; use nomes EXATOS da lista acima)"]
}`;
}

/**
 * Chama a API de IA configurada e devolve o objeto de programação.
 * @returns {Promise<{nomeBloco, grade, locucao, ordemReproducao}>}
 */
export async function gerarProgramacao({ descricao, horas = 2, estilo = 'descontraido' }) {
  const cfg = getConfig();
  if (!cfg.apiKey) throw erroChaveAusente();

  const prompt = montarPrompt({ descricao, horas, estilo, acervo: acervoRef?.() ?? [] });

  if (cfg.provedor === 'gemini') return chamarGemini(prompt, cfg.apiKey);
  // Groq e OpenAI falam o mesmo protocolo OpenAI-compatible
  return chamarOpenAICompativel(prompt, cfg.apiKey, cfg.provedor);
}

/** Referência ao acervo injetada por app.js (evita import circular). */
let acervoRef = () => [];
export function setAcervoProvider(fn) { acervoRef = fn; }

/** Converte o texto de resposta em JSON tolerante a cercas de código. */
function parseJSON(texto) {
  const limpo = texto.replace(/```json|```/g, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim === -1) throw new Error('A IA retornou um formato inesperado. Tente novamente.');
  return JSON.parse(limpo.slice(inicio, fim + 1));
}

/** Gemini API (generateContent) */
async function chamarGemini(prompt, key) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
    }),
  });
  if (resp.status === 401 || resp.status === 400) throw new Error('Chave da API Gemini inválida ou malformada. Verifique no painel do Google AI Studio.');
  if (resp.status === 429) throw new Error('Limite de uso da API Gemini atingido (429). Tente novamente em instantes.');
  if (!resp.ok) throw new Error(`Erro da API Gemini (${resp.status}).`);
  const json = await resp.json();
  const texto = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseJSON(texto);
}

/** OpenAI API (chat completions) — também usada pelo Groq (protocolo idêntico) */
async function chamarOpenAICompativel(prompt, key, provedor) {
  const p = PROVEDORES_IA[provedor] ?? PROVEDORES_IA.openai;
  const resp = await fetch(p.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.modelo,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Você responde SEMPRE com JSON válido, sem markdown.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (resp.status === 401) throw new Error(`Chave da API ${provedor} inválida. Gere uma nova em ${p.site}`);
  if (resp.status === 429) throw new Error(`Limite de uso da API ${provedor} atingido (429).`);
  if (!resp.ok) {
    let detalhe = '';
    try { detalhe = ' — ' + (((await resp.json())?.error?.message) ?? ''); } catch { /* ignore */ }
    throw new Error(`Erro da API ${provedor} (${resp.status})${detalhe}`);
  }
  const json = await resp.json();
  return parseJSON(json.choices?.[0]?.message?.content ?? '');
}

/** Teste rápido de conectividade com a IA configurada */
export async function testarIA() {
  const cfg = getConfig();
  if (!cfg.apiKey) throw erroChaveAusente();
  const pingPrompt = 'Responda apenas: OK';
  if (cfg.provedor === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + cfg.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: pingPrompt }] }] }),
    });
    if (!r.ok) throw new Error(`Gemini respondeu ${r.status} — verifique a chave.`);
    return 'Conexão com Gemini OK ✔';
  }
  const p = PROVEDORES_IA[cfg.provedor] ?? PROVEDORES_IA.openai;
  const r = await fetch(p.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: p.modelo, messages: [{ role: 'user', content: pingPrompt }] }),
  });
  if (!r.ok) throw new Error(`${cfg.provedor} respondeu ${r.status} — verifique a chave em ${p.site}.`);
  return `Conexão com ${cfg.provedor === 'groq' ? 'Groq' : 'OpenAI'} OK ✔`;
}
