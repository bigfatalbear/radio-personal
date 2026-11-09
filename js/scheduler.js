/**
 * scheduler.js — Grade horária automática.
 * Guarda programações da IA com horário de início ("08:00") e, chegando a hora,
 * monta a fila com as faixas salvas e começa a tocar sozinho (também fala a locução).
 */
import { getConfig, salvarConfig } from './settings.js';
import { falarLocucao } from './tts.js';

let timer = null;

/** Salva uma programação com início agendado. */
export function agendarProgramacao({ nomeBloco, grade, locucao, ordem, inicio }) {
  const cfg = getConfig();
  const lista = [...(cfg.programacoes ?? [])];
  const nova = {
    id: `sch-${Date.now()}`,
    nomeBloco,
    grade,
    locucao,
    inicio: String(inicio ?? '').trim(), // "HH:MM"
    faixas: ordem.map((f) => ({ id: f.id, nome: f.nome, origem: f.origem ?? 'drive', videoId: f.videoId, canal: f.canal, thumb: f.thumb })),
  };
  lista.push(nova);
  salvarConfig({ programacoes: lista });
  return nova;
}

/** Remove uma programação agendada. */
export function removerProgramacao(id) {
  salvarConfig({ programacoes: (getConfig().programacoes ?? []).filter((p) => p.id !== id) });
}

/** Lista das programações agendadas. */
export function getProgramacoes() { return getConfig().programacoes ?? []; }

/**
 * Verifica se uma programação deve disparar agora.
 * @returns {{prog, agora}} ou null
 */
function partidaPendente(prog, agora) {
  const [h, m] = prog.inicio.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const marca = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const agoraStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  // Dispara quando agora === marca e ainda não rodou neste minuto
  return marca === agoraStr && localStorage.getItem(`radioPersonal:ult-disparo:${prog.id}`) !== agoraStr
    ? { prog, agora: agoraStr } : null;
}

/**
 * Inicia o relógio. A cada minuto confere as partidas; quando bate,
 * resolve as faixas (contra o acervo recebido em setProvedorFila) e toca.
 */
export function iniciar(getAcervoFn, setFilaFn, tocarFn) {
  parar();
  timer = setInterval(async () => {
    const agora = new Date();
    for (const prog of getProgramacoes()) {
      const gatilho = partidaPendente(prog, agora);
      if (!gatilho) continue;
      try {
        localStorage.setItem(`radioPersonal:ult-disparo:${prog.id}`, gatilho.agora);
        const acervo = getAcervoFn() ?? [];
        const mapa = new Map(acervo.map((f) => [f.id, f]));
        const filaResolvida = prog.faixas
          .map((f) => mapa.get(f.id) ?? acervo.find((x) => x.nome === f.nome) ?? (f.origem === 'youtube' ? f : null))
          .filter(Boolean);
        if (!filaResolvida.length) continue;
        setFilaFn(filaResolvida);
        await tocarFn(0);
        await falarLocucao(prog.locucao);
        window.dispatchEvent(new CustomEvent('radioPersonal:disparou', { detail: prog }));
      } catch { /* evita rejeição não tratada no interval */ }
    }
  }, 20_000); // verifica a cada 20s (precisão suficiente p/ minuto)
}

export function parar() {
  if (timer) { clearInterval(timer); timer = null; }
}
