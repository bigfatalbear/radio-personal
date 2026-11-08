/**
 * wakelock.js — Modo Rádio: mantém a tela "acordada" enquanto toca (Screen Wake Lock API).
 * Garante que o agendador da grade horária e a fila rodem sem interrupções
 * (timers JS são adormecidos pelo sistema quando a app fica invisível).
 * Nada de permissões exoticas: apenas navigator.wakeLock, do próprio navegador.
 */
import { getConfig, salvarConfig } from './settings.js';

let lock = null;
let reinicioPendente = null;

export function suportado() { return 'wakeLock' in navigator; }

/**
 * Liga o wake lock (só funciona com o documento visível e após gesto do usuário).
 * @returns {Promise<boolean>} true se ativou
 */
export async function ativar() {
  if (!suportado()) return false;
  if (lock) return true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    return true;
  } catch {
    // AbortError (usuário/so recusou) ou NotAllowedError
    return false;
  }
}

/** Solta o wake lock. */
export function liberar() {
  try { lock?.release?.(); } catch { /* noop */ }
  lock = null;
}

/** Wake lock ativado agora? */
export function estaAtivo() { return Boolean(lock); }

/**
 * Decide pelo estado da reprodução (chamado pelo app.js a cada mudança de status):
 * tocando → ativa (se o usuário deixou habilitado); pausado/erro → solta.
 * @returns {Promise<void>}
 */
export async function aplicarPeloEstado(status) {
  const cfg = getConfig();
  if (!cfg.wakelock?.ativo) { liberar(); return; }
  if (status === 'tocando') {
    if (!(await ativar())) {
      // Falhou agora (ex.: terms visível); guarda para reacender quando voltar
      reinicioPendente = true;
    }
  } else {
    liberar();
  }
}

/** Reacende o lock quando a aba volta a ficar visível. Chamar 1x no carregamento. */
export function instalarVigilancia(estaTocando) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && (estaTocando() || reinicioPendente)) {
      reinicioPendente = null;
      if (getConfig().wakelock?.ativo) await ativar();
    }
  });
}

/** Alterna a preferência do usuário e aplica na hora. */
export async function alternarPreferencia(ativo) {
  salvarConfig({ wakelock: { ativo: Boolean(ativo) } });
  if (ativo) await ativar(); else liberar();
}
