/**
 * app.js — Inicialização, navegação, renderização da UI e colagem entre
 * módulos (settings + drive + ai + player).
 */
import { getConfig, salvarConfig, extrairDriveId } from './settings.js';
import { listarFaixasDrive, getAcervo } from './drive.js';
import { gerarProgramacao, testarIA, iaDisponivel, setAcervoProvider } from './ai.js';
import { extrairPaleta, aplicarTema, redimensionarImagem } from './theme.js';
import * as player from './player.js';
import * as playlists from './playlists.js';
import * as offline from './offline.js';
import * as scheduler from './scheduler.js';
import { setEq, iniciarVisualizador, aplicarValores as eqAplicar } from './audiofx.js';
import { listarVozes } from './tts.js';
import * as wakelock from './wakelock.js';
import * as yt from './youtube.js';
import * as sync from './sync.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  configurarTabs();
  aplicarIdentidade();
  preencherFormConfig();
  vincularEventos();
  vincularPlayer();
  setAcervoProvider(getAcervo);
  aplicarTemaSalvo();
  atualizarAvisos();
  atualizarSeloDrive();
  atualizarUIExtra();          // playlists, TTS, EQ, offline
  renderizarProgramacoesSalvas();
  scheduler.iniciar(getAcervo, player.setFila, player.tocar); // grade horária automática
  renderizarStatusPassos();
});

/** Popula e vincula os controles novos: playlists, TTS, equalizador, offline. */
function atualizarUIExtra() {
  atualizarSelectPlaylists();
  // TTS: vozes do dispositivo → <select>
  const selVoz = $('#cfg-tts-voz');
  const cfg = getConfig();
  setTimeout(() => {
    selVoz.innerHTML = '<option value="">Padrão do dispositivo (PT-BR)</option>' +
      listarVozes().map((v) => `<option value="${v.uri}">${v.nome} (${v.lang})</option>`).join('');
  }, 300); // vozes carregam async no Chrome
  $('#cfg-tts-ativo').checked = Boolean(cfg.tts?.ativo);
  $('#cfg-tts-voz').value = cfg.tts?.voz ?? '';
  $('#cfg-tts-estilo').value = cfg.tts?.estilo ?? 'padrao';
  $('#cfg-tts-velocidade').value = cfg.tts?.velocidade ?? 1;
  $('#cfg-tts-vel-valor').textContent = `${(Number(cfg.tts?.velocidade) || 1).toFixed(1)}×`;
  $('#eq-bass').value = cfg.eq?.bass ?? 0;
  $('#eq-mid').value = cfg.eq?.mid ?? 0;
  $('#eq-treble').value = cfg.eq?.treble ?? 0;  atualizarOfflineInfo();
  iniciarVisualizador();
  // ==== Wake Lock (Modo Rádio) ====
  $('#cfg-wakelock').checked = Boolean(cfg.wakelock?.ativo);
  $('#cfg-aviso-bateria').checked = Boolean(cfg.wakelock?.avisos?.bateria);
  $('#cfg-aviso-chrome').checked = Boolean(cfg.wakelock?.avisos?.chrome);
  if (!$('#cfg-wakelock').disabled) $('#cfg-wakelock').disabled = !wakelock.suportado();
  atualizarWakelockStatus('inativo');
  wakelock.instalarVigilancia(player.estaTocando);
  atualizarListaCanais();
  vincularYouTube();
  vincularLinksChave();
  vincularPix();
  vincularGerenciarPlaylists();
  autoCarregarPlaylistsDoDrive();
}

/** Modo ouvinte: importar playlists publicadas em pasta compartilhada sem login. */
async function autoCarregarPlaylistsDoDrive() {
  try {
    if (playlists.getPlaylists().length > 0) return; // quem gerencia localmente não é sobrescrito
    const json = await sync.restaurarPublico();
    if (json?.playlists?.length) {
      playlists.importarDoDrive(json.playlists, json.favoritos);
      atualizarSelectPlaylists();
      renderFila();
      feedbackAviso(`✔ ${json.playlists.length} playlist(s) recebidas do Drive.`);
    }
  } catch { /* silencioso */ }
}

/** Botões de link para gerar chaves + destaque no provedor ativo. */
function vincularLinksChave() {
  const destacar = () => {
    const p = $('#cfg-provedor').value;
    document.querySelectorAll('[data-link-ia]').forEach((a) => {
      const ativo = a.dataset.linkIa === p;
      a.classList.toggle('btn-ciano', ativo);
      a.classList.toggle('cor-acento-borda-bor', ativo);
      a.style.fontWeight = ativo ? '600' : '';
    });
  };
  destacar();
  $('#cfg-provedor')?.addEventListener('change', destacar);
  // "Usar a mesma chave da IA" → copia a chave dos campos acima para o YouTube
  document.querySelector('[data-usar-chave-ia]')?.addEventListener('click', () => {
    const k = $('#cfg-apikey').value.trim();
    $('#cfg-ytkey').value = k;
    mostrarFeedback('✔ Mesma chave da IA copiada para o campo do YouTube. Salve as configurações.', 'cor-acento-texto');
  });
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function configurarTabs() {
  $$('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-tab]').forEach((b) => b.classList.toggle('ativo', b.dataset.tab === btn.dataset.tab));
      $$('[data-scroll-to]').forEach((b) => b.classList.remove('ativo'));
      $$('[data-page]').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== btn.dataset.tab));
    });
  });
  $$('[data-scroll-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.sidebar-link').forEach((link) => link.classList.remove('ativo'));
      btn.classList.add('ativo');
      document.getElementById(btn.dataset.scrollTo)?.scrollIntoView({ block: 'start' });
    });
  });
  $$('[data-tab="player"]').forEach((btn) => btn.classList.add('ativo'));
  $$('[data-ir-config]').forEach((el) => el.addEventListener('click', () =>
    document.querySelector('[data-tab="config"]')?.click()));
}

// ============================================================
// EVENTOS GERAIS
// ============================================================
function vincularEventos() {
  $('#form-config')?.addEventListener('submit', aoSalvarConfig);
  $('#btn-testar-ia')?.addEventListener('click', aoTestarIA);
  $('#form-programacao')?.addEventListener('submit', aoGerarProgramacao);
  $('#btn-carregar-drive')?.addEventListener('click', aoCarregarDrive);
  $('#btn-shuffle')?.addEventListener('click', () => {
    player.toggleShuffle();
    $('#btn-shuffle').classList.toggle('ativo', player.isShuffle());
  });
  $('#input-arquivos-local')?.addEventListener('change', (e) => {
    const n = player.adicionarLocais(e.target.files);
    if (n) feedbackAviso(`${n} arquivo(s) local(is) adicionados à fila. Use "Enviar locais para o Drive" para deixá-los permanentes.`);
    e.target.value = '';
  });
  $('#btn-enviar-locais')?.addEventListener('click', aoEnviarLocaisDrive);
  $('#cfg-entrar-google')?.addEventListener('click', aoEntrarGoogle);
  $('#input-logo')?.addEventListener('change', aoEnviarImagemTema);
  $('#btn-onboarding-fechar')?.addEventListener('click', () => {
    $('#onboarding').remove();
    localStorage.setItem('radioPersonal:onboarding', 'visto');
  });
  $$('[data-ir-ajuda]').forEach((el) => el.addEventListener('click', () =>
    document.querySelector('[data-tab="ajuda"]')?.click()));

  // ===== Playlists / favoritos / offline =====
  $('#btn-carregar-playlist')?.addEventListener('click', () => {
    const id = $('#sel-playlist').value;
    if (!id) return;
    try {
      player.setFila(playlists.carregarPlaylist(id));
      player.tocar(0);
      feedbackAviso('Playlist carregada e tocando.');
    } catch (err) { feedbackAviso('✖ ' + err.message); }
  });
  $('#btn-salvar-playlist')?.addEventListener('click', () => {
    const nome = prompt('Nome da playlist (a fila atual será salva):');
    if (nome === null) return;
    try {
      playlists.salvarPlaylist(nome, player.getFila());
      atualizarSelectPlaylists(nome.trim());
      feedbackAviso('✔ Playlist "' + nome.trim() + '" salva.');
    } catch (err) { feedbackAviso('✖ ' + err.message); }
  });
  $('#btn-baixar-tudo')?.addEventListener('click', baixarFilaOffline);

  // ===== Equalizador =====
  ['eq-bass', 'eq-mid', 'eq-treble'].forEach((id) => {
    $(`#${id}`)?.addEventListener('input', () => setEq({
      bass: $('#eq-bass').value, mid: $('#eq-mid').value, treble: $('#eq-treble').value,
    }));
  });
  // ===== TTS (instantâneo) =====
  $('#cfg-tts-ativo')?.addEventListener('change', (e) => salvarConfig({ tts: { ativo: e.target.checked } }));
  $('#cfg-tts-voz')?.addEventListener('change', (e) => salvarConfig({ tts: { voz: e.target.value } }));
  $('#cfg-tts-estilo')?.addEventListener('change', (e) => salvarConfig({ tts: { estilo: e.target.value } }));
  $('#cfg-tts-velocidade')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#cfg-tts-vel-valor').textContent = `${v.toFixed(1)}×`;
    salvarConfig({ tts: { velocidade: v } });
  });
  // ===== Modo Rádio (Wake Lock) + ajustes do dispositivo =====
  $('#cfg-wakelock')?.addEventListener('change', async (e) => {
    if (e.target.disabled) return e.preventDefault();
    await wakelock.alternarPreferencia(e.target.checked);
    atualizarWakelockStatus(e.target.checked ? 'aguardando' : 'inativo');
  });
  $('#cfg-aviso-bateria')?.addEventListener('change', (e) =>
    salvarConfig({ wakelock: { avisos: { bateria: e.target.checked } } }));
  $('#cfg-aviso-chrome')?.addEventListener('change', (e) =>
    salvarConfig({ wakelock: { avisos: { chrome: e.target.checked } } }));

  // Some o onboarding se o usuário já viu ou já configurou a IA
  if (localStorage.getItem('radioPersonal:onboarding') || getConfig().apiKey) {
    $('#onboarding')?.remove();
  }
  renderizarStatusPassos();
}

/** Marca na aba Ajuda quais passos já estão concluídos. */
function renderizarStatusPassos() {
  const cfg = getConfig();
  const feito = (n) => n === 1 ? Boolean(cfg.rádio?.tema || cfg.rádio?.logo)
    : n === 2 ? Boolean(cfg.apiKey)
    : n === 3 ? Boolean(extrairDriveId(cfg.driveFonte))
    : true;
  document.querySelectorAll('[data-status-passo]').forEach((el) => {
    el.textContent = feito(Number(el.dataset.statusPasso)) ? '✔ concluído' : 'pendente';
    el.className = feito(Number(el.dataset.statusPasso))
      ? 'ml-auto text-xs font-semibold cor-acento-texto'
      : 'ml-auto text-xs text-zinc-500';
  });
}

// ============================================================
// TEMA GERADO A PARTIR DA IMAGEM (upload do usuário)
// ============================================================
async function aoEnviarImagemTema(e) {
  const arquivo = e.target.files?.[0];
  e.target.value = '';
  if (!arquivo) return;

  const aviso = $('#config-feedback');
  aviso.className = 'text-sm text-zinc-400';
  aviso.textContent = 'Analisando cores da imagem…';

  try {
    const url = URL.createObjectURL(arquivo);
    // 1) Redimensiona para um base64 leve (compatível com localStorage)
    const miniatura = await redimensionarImagem(url, 256, 0.82);
    // 2) Extrai a paleta via canvas
    const paleta = await extrairPaleta(miniatura);
    // 3) Aplica na UI (variáveis CSS)
    const temaAplicada = aplicarTema(paleta);
    // 4) Persistindo logo + tema
    salvarConfig({
      rádio: { logo: miniatura, tema: temaAplicada ?? { acento: paleta.acento } },
    });

    // Preview + swatches
    const prev = $('#logo-preview');
    prev.style.backgroundImage = `url(${miniatura})`;
    prev.style.backgroundSize = 'cover';
    prev.classList.remove('hidden');
    renderSwatches(temaAplicada);

    $('#cfg-logo').value = ''; // anula URL manual (imagem local prevalece)
    aplicarIdentidade();
    renderizarStatusPassos();
    mostrarFeedback('✔ Imagem aplicada: logo atualizado e tema de cores gerado com sucesso!', 'cor-acento-texto');
  } catch (err) {
    mostrarFeedback('✖ ' + err.message, 'text-red-400');
  }
}

/** Reaplica o tema salvo no localStorage (ao carregar a página). */
function aplicarTemaSalvo() {
  const cfg = getConfig();
  const tema = cfg.rádio?.tema;
  if (tema?.acento ?? tema) {
    aplicarTema(tema);
  }
  // Preview do logo salvo (local ou URL)
  const logo = cfg.rádio?.logo;
  if (logo) {
    const prev = $('#logo-preview');
    prev.style.backgroundImage = `url(${logo})`;
    prev.style.backgroundSize = 'cover';
    prev.classList.remove('hidden');
    extrairPaleta(logo).catch(() => {}).then((p) => p && renderSwatches(p));
  }
}

/** Mostra as cores extraídas como samples visuais */
function renderSwatches(paleta) {
  if (!paleta) return;
  const cores = [paleta.acento, paleta.hover, paleta.escuro].filter(Boolean);
  $('#paleta-swatches').innerHTML = cores.map((c) => `
    <span class="inline-block w-6 h-6 rounded-md border border-zinc-700" style="background:${c}" title="${c}"></span>`).join('');
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================
function preencherFormConfig() {
  const cfg = getConfig();
  $('#cfg-nome').value = cfg.rádio.nome || '';
  $('#cfg-slogan').value = cfg.rádio.slogan || '';
  $('#cfg-logo').value = cfg.rádio.logo || '';
  $('#cfg-provedor').value = cfg.provedor || 'gemini';
  $('#cfg-apikey').value = cfg.apiKey || '';
  $('#cfg-ytkey').value = cfg.youtubeApiKey || '';
  $('#cfg-drive').value = cfg.driveFonte || '';
}

function aoSalvarConfig(e) {
  e.preventDefault();
  const cfgAntiga = getConfig();
  salvarConfig({
    provedor: $('#cfg-provedor').value,
    apiKey: $('#cfg-apikey').value.trim(),
    youtubeApiKey: $('#cfg-ytkey').value.trim(),
    driveFonte: $('#cfg-drive').value.trim(),
    rádio: {
      nome: $('#cfg-nome').value.trim() || 'Rádio Personal',
      slogan: $('#cfg-slogan').value.trim(),
      logo: $('#cfg-logo').value.trim() || cfgAntiga.rádio?.logo || '',
    },
  });
  const cfg = getConfig();
  aplicarIdentidade();

  // Se o logo é uma URL (sem tema salvo ou logo mudou), tenta gerar o tema dela
  const logoMudou = cfg.rádio.logo && cfg.rádio.logo !== cfgAntiga.rádio?.logo;
  if (logoMudou && !cfg.rádio.logo.startsWith('data:')) {
    extrairPaleta(cfg.rádio.logo)
      .then((p) => salvarConfig({ rádio: { tema: aplicarTema(p) ?? { acento: p.acento } } }))
      .catch(() => {/* URL externa sem CORS: mantém tema padrão */});
  }

  atualizarAvisos();
  atualizarSeloDrive();
  renderizarStatusPassos();
  mostrarFeedback('✔ Configurações salvas neste navegador.', 'cor-acento-texto');
}

async function aoTestarIA() {
  const alvo = $('#config-feedback');
  try {
    alvo.className = 'text-sm text-zinc-400';
    alvo.textContent = 'Testando conexão…';
    const msg = await testarIA();
    mostrarFeedback('✔ ' + msg, 'cor-acento-texto');
  } catch (err) {
    mostrarFeedback('✖ ' + err.message, 'text-red-400');
  }
}

function aplicarIdentidade() {
  const { rádio } = getConfig();
  $('#hdr-nome').textContent = rádio.nome || 'Rádio Personal';
  $('#hdr-slogan').textContent = rádio.slogan || '';
  const logo = $('#hdr-logo');
  if (rádio.logo) {
    logo.src = rádio.logo;
    logo.classList.remove('hidden');
    logo.onerror = () => logo.classList.add('hidden');
  } else {
    logo.classList.add('hidden');
  }
  document.title = `${rádio.nome || 'Rádio Personal'} — Sua rádio no ar`;
  player.setNomeRadio(rádio.nome); // usado na locução TTS
  // Logo como capa da música na tela de bloqueio (MediaSession)
  window.__radioLogoUrl = rádio.logo?.startsWith('data:image/png') ? rádio.logo
    : rádio.logo?.startsWith('data:image') ? rádio.logo : rádio.logo || '';
}

function mostrarFeedback(msg, cor = 'cor-acento-texto') {
  const el = $('#config-feedback');
  el.className = `text-sm ${cor}`;
  el.textContent = msg;
}

function feedbackAviso(msg) {
  const el = $('#aviso-player');
  if (!el) return;
  el.querySelector('span').textContent = '✔ ' + msg;
  setTimeout(atualizarAvisos, 6000);
}

function atualizarAvisos() {
  $('#aviso-sem-key')?.classList.toggle('hidden', iaDisponivel());
}

function atualizarSeloDrive() {
  const id = extrairDriveId(getConfig().driveFonte);
  const selo = $('#selo-drive');
  selo.classList.remove('hidden');
  $('#selo-drive-txt').textContent = id ? `Drive: ${id.slice(0, 8)}…` : 'Drive não configurado';
}

// ============================================================
// DRIVE → FILA
// ============================================================
async function aoCarregarDrive() {
  const btn = $('#btn-carregar-drive');
  btn.disabled = true;
  try {
    const faixas = await listarFaixasDrive();
    player.setFila(faixas);
    renderizarStatusPassos();
    feedbackAviso(`${faixas.length} faixas carregadas do Google Drive.`);
  } catch (err) {
    feedbackAviso('✖ ' + err.message);
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// PLAYER — RENDERIZAÇÃO
// ============================================================
function vincularPlayer() {
  $('#btn-play').addEventListener('click', () => player.playPause());
  $('#btn-proxima').addEventListener('click', () => player.proxima());
  $('#btn-anterior').addEventListener('click', () => player.anterior());
  $('#ctrl-volume').addEventListener('input', (e) => player.setVolume(e.target.value));
  const btnTelaCheia = $('#btn-tela-cheia');
  const statusTelaCheia = $('#tela-cheia-status');
  if (!document.documentElement.requestFullscreen || !document.exitFullscreen) {
    btnTelaCheia.disabled = true;
    btnTelaCheia.title = 'Tela cheia não suportada neste navegador';
  } else {
    btnTelaCheia.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (err) {
        statusTelaCheia.textContent = `Não foi possível alternar para tela cheia: ${err.message}`;
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const ativo = Boolean(document.fullscreenElement);
      btnTelaCheia.setAttribute('aria-label', ativo ? 'Sair da tela cheia' : 'Ativar tela cheia');
      btnTelaCheia.title = ativo ? 'Sair da tela cheia' : 'Ativar tela cheia';
      btnTelaCheia.innerHTML = `<i data-lucide="${ativo ? 'minimize' : 'maximize'}" class="w-4 h-4"></i>`;
      statusTelaCheia.textContent = ativo ? 'Tela cheia ativada.' : 'Tela cheia desativada.';
      if (window.lucide) lucide.createIcons();
    });
  }
  const barra = $('#progresso-barra');
  barra.parentElement.addEventListener('click', (e) => {
    const rect = barra.parentElement.getBoundingClientRect();
    player.seek((e.clientX - rect.left) / rect.width);
  });

  player.callbacks.onRender = renderFila;
  player.callbacks.onStatus = renderStatus;
  player.callbacks.onProgresso = renderProgresso;
  player.setVolume($('#ctrl-volume').value);
}

function renderFila() {
  const lista = $('#lista-fila');
  const fila = player.getFila();
  $('#aviso-player')?.classList.toggle('hidden', fila.length > 0);

  lista.innerHTML = fila.map((f, i) => {
    const fav = playlists.ehFavorito(f.nome);
    return `
    <li class="faixa-item flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${i === player.getIndice() ? 'tocando' : ''}"
        data-indice="${i}">
      <span class="w-6 text-center text-xs font-mono ${i === player.getIndice() ? 'cor-acento-texto' : 'text-zinc-500'}">
        ${i === player.getIndice() ? '▶' : i + 1}
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium truncate">${f.nome}</p>
        <p class="text-xs text-zinc-500">${f.origem === 'drive' ? 'Google Drive' : f.origem === 'youtube' ? `YouTube · ${f.canal ?? ''}` : 'Arquivo local'}</p>
      </div>
      <button data-fav="${i}" class="shrink-0 ${fav ? 'text-pink-400' : 'text-zinc-600 hover:text-pink-300'} transition"
              title="${fav ? 'Remover dos favoritos' : 'Favoritar'}">
        <i data-lucide="${fav ? 'heart' : 'heart'}" class="w-4 h-4 ${fav ? 'fill-current' : ''}"></i>
      </button>
    </li>`;
  }).join('');

  lista.querySelectorAll('[data-indice]').forEach((li) => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav]')) return;
      player.tocar(Number(li.dataset.indice));
    });
  });
  lista.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      playlists.alternarFavorito(player.getFila()[Number(btn.dataset.fav)].nome);
      renderFila();
      if (window.lucide) lucide.createIcons();
    });
  });
  $('#tocando-titulo').textContent = fila.length
    ? `${fila.length} faixas na fila`
    : 'Minhas músicas';
}

function renderStatus(status) {
  const iconePa = $('#icone-play');
  const badge = $('#badge-ao-vivo');

  // Wake Lock acompanha a reprodução (Modo Rádio)
  wakelock.aplicarPeloEstado(status).then(() => {
    if (status === 'tocando') atualizarWakelockStatus(wakelock.estaAtivo() ? 'ativo' : 'aguardando');
    else atualizarWakelockStatus('inativo');
  });

  // Troca o ícone play/pause
  const usarPause = status === 'tocando';
  iconePa.outerHTML = `<i data-lucide="${usarPause ? 'pause' : 'play'}" id="icone-play" class="w-5 h-5 fill-current"></i>`;
  if (window.lucide) lucide.createIcons();

  badge.classList.toggle('hidden', status !== 'tocando');
  badge.classList.toggle('flex', status === 'tocando');
  $('#player-bar').classList.toggle('tocando', status === 'tocando');

  const f = player.getAtual();
  $('#tocando-titulo').textContent = f ? f.nome : 'Minhas músicas';
  $('#tocando-info').textContent =
    status === 'tocando' ? 'Tocando agora' :
    status === 'pausado' ? 'Pausado' :
    status === 'erro' ? 'Erro ao tocar — pulando…' : 'Pronto';
}

function renderProgresso({ atual, duracao, frac }) {
  $('#progresso-barra').style.width = `${frac * 100}%`;
  $('#tempo-atual').textContent = player.mmss(atual);
  $('#tempo-total').textContent = player.mmss(duracao);
}

// ============================================================
// PROGRAMAÇÃO COM IA
// ============================================================
async function aoGerarProgramacao(e) {
  e.preventDefault();
  const resultado = $('#ia-resultado');

  if (!iaDisponivel()) {
    atualizarAvisos();
    $('#aviso-sem-key').classList.remove('hidden');
    document.querySelector('[data-tab="config"]')?.click();
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Consultando a IA…';
  if (window.lucide) lucide.createIcons();
  resultado.innerHTML = '<div class="text-sm text-zinc-400 flex items-center gap-2"><i data-lucide="sparkles" class="w-4 h-4 animate-pulse"></i> Gerando programação…</div>';

  try {
    const prog = await gerarProgramacao({
      descricao: $('#ia-descricao').value,
      horas: Number($('#ia-horas').value) || 2,
      estilo: $('#ia-estilo').value,
    });
    renderProgramacao(prog);
  } catch (err) {
    resultado.innerHTML = `
      <div class="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 text-sm flex items-start gap-2">
        <i data-lucide="alert-triangle" class="w-4 h-4 mt-0.5 shrink-0"></i>
        <span>${err.message}</span>
      </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="wand-2" class="w-4 h-4"></i> Gerar programação com IA';
    if (window.lucide) lucide.createIcons();
  }
}

function renderProgramacao(prog) {
  const faixas = player.getFila();
  const nomesFila = new Set(faixas.map((f) => f.nome.toLowerCase()));

  // Mapeia títulos sugeridos pela IA para faixas reais da fila (quando existirem)
  const ordem = (prog.ordemReproducao ?? [])
    .map((nome) => {
      const achou = faixas.find((f) => f.nome.toLowerCase() === nome.toLowerCase());
      return achou ?? (nomesFila.size ? null : { nome, origem: 'sugestao' });
    })
    .filter(Boolean);

  $('#ia-resultado').innerHTML = `
    <article class="glass rounded-2xl p-4 space-y-3 border cor-acento-borda-bor">
      <header>
        <p class="text-xs cor-acento-texto font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Programação gerada pela IA
        </p>
        <h3 class="text-lg font-bold mt-1">${prog.nomeBloco ?? 'Bloco sem nome'}</h3>
      </header>

      <div>
        <h4 class="text-xs font-semibold text-zinc-400 uppercase mb-1">Grade horária sugerida</h4>
        <ul class="text-sm space-y-0.5 text-zinc-300">
          ${(prog.grade ?? []).map((g) => `<li class="flex gap-2"><i data-lucide="clock" class="w-3.5 h-3.5 mt-0.5 text-zinc-500 shrink-0"></i>${g}</li>`).join('')}
        </ul>
      </div>

      <div>
        <h4 class="text-xs font-semibold text-zinc-400 uppercase mb-1">Locução de abertura</h4>
        <blockquote class="text-sm text-zinc-300 border-l-2 cor-acento-borda-txt pl-3 italic">${prog.locucao ?? '—'}</blockquote>
      </div>

      <div>
        <h4 class="text-xs font-semibold text-zinc-400 uppercase mb-1">Ordem de reprodução (${ordem.length} faixas)</h4>
        <ol class="text-sm text-zinc-300 list-decimal list-inside space-y-0.5">
          ${ordem.map((f) => `<li>${f.nome}</li>`).join('') || '<li class="text-zinc-500 italic">— veja fila vazia</li>'}
        </ol>
      </div>

      <button id="btn-aplicar" class="btn-primario w-full" ${ordem.length === 0 ? 'disabled title="Carregue o acervo do Drive primeiro"' : ''}>
        <i data-lucide="list-music" class="w-4 h-4"></i> Aplicar Programação ao Player
      </button>

      <div class="flex gap-2 items-center">
        <input id="prog-inicio" type="time" class="input text-sm" title="Horário de início automático">
        <button id="btn-agendar" class="btn-secundario btn-ciano text-sm whitespace-nowrap" ${ordem.length === 0 ? 'disabled' : ''}>
          <i data-lucide="alarm-clock" class="w-4 h-4"></i> Agendar início automático
        </button>
      </div>
    </article>`;

  if (window.lucide) lucide.createIcons();

  const btnAgendar = $('#btn-agendar');
  if (btnAgendar && !btnAgendar.disabled) {
    btnAgendar.addEventListener('click', () => {
      const inicio = $('#prog-inicio').value;
      if (!inicio) return alert('Escolha o horário de início (Hora:Minuto).');
      scheduler.agendarProgramacao({
        nomeBloco: prog.nomeBloco,
        grade: prog.grade,
        locucao: prog.locucao,
        ordem: ordem.filter((f) => f.origem !== 'sugestao'),
        inicio,
      });
      renderizarProgramacoesSalvas();
      mostrarFeedback(`✔ Programação agendada para tocar automaticamente às ${inicio}.`, 'cor-acento-texto');
    });
  }

  const btnAplicar = $('#btn-aplicar');
  if (btnAplicar && ordem.length) {
    btnAplicar.addEventListener('click', () => {
      // Aplica apenas as faixas que existem de fato na fila carregada do Drive
      const aplicaveis = ordem.filter((f) => faixas.some((x) => x.nome.toLowerCase() === f.nome.toLowerCase()) || f.origem !== 'sugestao');
      const filaAplicar = aplicaveis.length ? aplicaveis : ordem.filter((f) => f.origem !== 'sugestao');
      if (!filaAplicar.length) {
        alert('Os títulos não coincidem com o acervo disponível. Carregue o Drive e gere novamente.');
        return;
      }
      player.setFila(filaAplicar);
      player.tocar(0);
      document.querySelector('[data-tab="player"]')?.click();
    });
  }
}

// ============================================================
// PLAYLISTS SALVAS (select + lista agendada)
// ============================================================
function atualizarSelectPlaylists(selecionar = '') {
  const sel = $('#sel-playlist');
  if (!sel) return;
  const listas = playlists.getPlaylists();
  sel.innerHTML = '<option value="">— Playlists salvas —</option>' +
    listas.map((p) => `<option value="${p.id}">${p.nome} (${p.faixas.length})</option>`).join('');
  if (selecionar) sel.value = listas.find((p) => p.nome === selecionar)?.id ?? '';
}

/** Lista as programações agendadas (grade horária) com botão de remover. */
function renderizarProgramacoesSalvas() {
  const cont = $('#programacoes-salvas');
  if (!cont) return;
  const lista = scheduler.getProgramacoes();
  cont.innerHTML = lista.length === 0 ? '' : `
    <div class="glass rounded-2xl p-4 space-y-2">
      <h4 class="text-xs font-semibold text-zinc-400 uppercase flex items-center gap-1.5">
        <i data-lucide="alarm-clock" class="w-3.5 h-3.5"></i> Programações agendadas
      </h4>
      ${lista.map((p) => `
        <div class="flex items-center gap-2 text-sm">
          <span class="font-mono cor-acento-texto font-bold">${p.inicio}</span>
          <span class="flex-1 truncate">${p.nomeBloco ?? 'Programação'} · ${p.faixas?.length ?? 0} faixas</span>
          <button data-rem-agend="${p.id}" class="text-zinc-500 hover:text-red-400 transition" title="Remover agendamento"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>`).join('')}
    </div>`;
  cont.querySelectorAll('[data-rem-agend]').forEach((btn) =>
    btn.addEventListener('click', () => {
      scheduler.removerProgramacao(btn.dataset.remAgend);
      renderizarProgramacoesSalvas();
    }));
  if (window.lucide) lucide.createIcons();
}

// ============================================================
// MODO OFFLINE — baixa a fila atual para o cache
// ============================================================
async function baixarFilaOffline() {
  const fila = player.getFila().filter((f) => f.origem !== 'local');
  if (!fila.length) return feedbackAviso('✖ Carregue a fila do Drive antes de baixar.');
  const btn = $('#btn-baixar-tudo');
  btn.disabled = true;
  try {
    let ok = 0;
    for (let i = 0; i < fila.length; i++) {
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> ${i + 1}/${fila.length}`;
      if (window.lucide) lucide.createIcons();
      try {
        await offline.baixarFaixa(fila[i], fila[i].url);
        ok++;
      } catch { /* continua com as próximas */ }
    }
    atualizarOfflineInfo();
    feedbackAviso(`✔ ${ok} de ${fila.length} faixas salvas para ouvir offline.`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i>';
    if (window.lucide) lucide.createIcons();
  }
}

async function atualizarOfflineInfo() {
  const el = $('#offline-info');
  if (!el || !('caches' in window)) return;
  const { n, mb } = await offline.estatisticasOffline();
  el.textContent = `${n} faixas offline${mb ? ` (~${mb} MB)` : ''}`;
}

// ============================================================
// MODO RÁDIO (WAKE LOCK) — indicador de estado
// ============================================================
let wakelockStatusTimer = null;
function atualizarWakelockStatus(estado) {
  const el = $('#wakelock-status');
  if (!el) return;
  const mapa = {
    ativo: { txt: 'Modo Rádio ativo — tela acordada', cls: 'text-emerald-400', icone: 'lock' },
    aguardando: { txt: 'Aguardando a próxima música para travar a tela', cls: 'text-amber-400', icone: 'moon' },
    inativo: { txt: 'Wake lock inativo (pausado)', cls: 'text-zinc-500', icone: 'circle' },
  };
  const m = mapa[estado] ?? mapa.inativo;
  el.className = `text-xs flex items-center gap-1.5 ${m.cls}`;
  clearTimeout(wakelockStatusTimer);
  const mudar = (e2) => {
    const n = mapa[e2] ?? mapa.inativo;
    el.innerHTML = `<i data-lucide="${n.icone}" class="w-3 h-3"></i> ${n.txt}`;
    el.className = `text-xs flex items-center gap-1.5 ${n.cls}`;
    if (window.lucide) lucide.createIcons();
  };
  mudar(estado);
  if (estado === 'aguardando') {
    wakelockStatusTimer = setTimeout(() => {
      atualizarWakelockStatus(wakelock.estaAtivo() ? 'ativo' : 'inativo');
    }, 8000);
  }
}

// ============================================================
// YOUTUBE — canais, vídeos recentes e programação
// ============================================================
let videosYT = [];          // últimos vídeos encontrados
let selecaoYT = new Set();  // videoId selecionados

function vincularYouTube() {
  $('#btn-yt-adicionar')?.addEventListener('click', aoAdicionarCanal);
  $('#yt-canal-novo')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aoAdicionarCanal(); } });
  $('#btn-yt-buscar')?.addEventListener('click', aoBuscarVideosYT);
  $('#btn-yt-tocar')?.addEventListener('click', aoTocarSelecaoYT);
  $('#btn-yt-programar')?.addEventListener('click', aoProgramarSelecaoYT);
  $('#btn-yt-esconder')?.addEventListener('click', () => alternarYTMini(false));
  $('#btn-yt-mostrar')?.addEventListener('click', () => alternarYTMini(true));
  atualizarListaCanais();
}

async function aoAdicionarCanal() {
  const inp = $('#yt-canal-novo');
  const texto = inp.value.trim();
  if (!texto) return;
  const btn = $('#btn-yt-adicionar');
  btn.disabled = true;
  try {
    const canal = await yt.adicionarCanal(texto);
    inp.value = '';
    atualizarListaCanais();
    feedbackAviso(`✔ Canal "${canal.titulo}" cadastrado.`);
  } catch (err) {
    alert(err.message);
  } finally { btn.disabled = false; }
}

function atualizarListaCanais() {
  const ul = $('#lista-canais');
  if (!ul) return;
  const canais = yt.getCanais();
  ul.innerHTML = canais.map((c) => `
    <li class="flex items-center gap-1.5 text-xs bg-white/5 border border-white/10 rounded-full pl-3 pr-1 py-1">
      <i data-lucide="youtube" class="w-3 h-3 text-red-400"></i>
      <span class="font-medium">${c.titulo}</span>
      <button data-rem-canal="${c.id}" class="text-zinc-500 hover:text-red-400 transition p-0.5" title="Remover canal">
        <i data-lucide="x" class="w-3 h-3"></i>
      </button>
    </li>`).join('');
  ul.querySelectorAll('[data-rem-canal]').forEach((btn) =>
    btn.addEventListener('click', () => {
      yt.removerCanal(btn.dataset.remCanal);
      atualizarListaCanais();
    }));
  if (window.lucide) lucide.createIcons();
}

async function aoBuscarVideosYT() {
  const alvo = $('#yt-videos-resultado');
  const btn = $('#btn-yt-buscar');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Buscando…';
  alvo.innerHTML = '<p class="text-sm text-zinc-400 flex items-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-pulse"></i> Consultando canais no YouTube…</p>';
  try {
    videosYT = await yt.listarVideosRecentes(Number($('#yt-max-videos').value) || 5);
    selecaoYT = new Set(videosYT.slice(0, 3).map((v) => v.videoId)); // pré-seleciona os 3 mais recentes
    renderVideosYT();
    $('#yt-acoes').hidden = false;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    alvo.innerHTML = `
      <div class="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm flex items-start gap-2">
        <i data-lucide="alert-triangle" class="w-4 h-4 mt-0.5 shrink-0"></i><span>${err.message}</span>
      </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="search" class="w-4 h-4"></i> Buscar vídeos recentes';
    if (window.lucide) lucide.createIcons();
  }
}

function renderVideosYT() {
  const alvo = $('#yt-videos-resultado');
  alvo.innerHTML = videosYT.length ? videosYT.map((v) => {
    const sel = selecaoYT.has(v.videoId);
    const d = v.publicado ? new Date(v.publicado).toLocaleDateString('pt-BR') : '';
    return `
    <label class="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.03] border border-white/10 text-sm cursor-pointer hover:bg-white/[0.06] transition">
      <input type="checkbox" data-yt-sel="${v.videoId}" ${sel ? 'checked' : ''} class="w-4 h-4 accent-cyan-500 shrink-0">
      <div class="min-w-0 flex-1">
        <p class="font-medium truncate">${v.nome || '(sem título)'}</p>
        <p class="text-xs text-zinc-500 truncate">${v.canal} · ${d}</p>
      </div>
      <span class="yt-badge shrink-0">YT</span>
    </label>`;
  }).join('') : '<p class="text-sm text-zinc-500 italic">Nenhum vídeo encontrado nos canais cadastrados.</p>';
  alvo.querySelectorAll('[data-yt-sel]').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? selecaoYT.add(cb.dataset.ytSel) : selecaoYT.delete(cb.dataset.ytSel);
      $('#yt-acoes').hidden = selecaoYT.size === 0;
    }));
}

/** Faixas do YouTube prontas para o player (na ordem exibida). */
function faixasSelecionadasYT() {
  return videosYT
    .filter((v) => selecaoYT.has(v.videoId))
    .map((v) => ({ origem: 'youtube', videoId: v.videoId, nome: v.nome, canal: v.canal, thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` }));
}

function aoTocarSelecaoYT() {
  const faixas = faixasSelecionadasYT();
  if (!faixas.length) return alert('Selecione ao menos um vídeo.');
  player.setFila(faixas);
  player.tocar(0);
  mostrarMiniYT();
  document.querySelector('[data-tab="player"]')?.click();
}

async function aoProgramarSelecaoYT() {
  if (!iaDisponivel()) {
    atualizarAvisos();
    $('#aviso-sem-key').classList.remove('hidden');
    document.querySelector('[data-tab="config"]')?.click();
    return;
  }
  const acervoVideos = videosYT.filter((v) => selecaoYT.has(v.videoId));
  if (!acervoVideos.length) return alert('Selecione ao menos um vídeo.');
  const btn = $('#btn-yt-programar');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> IA montando…';
  try {
    const prog = await gerarProgramacao({
      descricao: $('#ia-descricao').value || 'Programação de rádio com os vídeos mais recentes dos canais cadastrados',
      horas: Number($('#ia-horas').value) || 1,
      estilo: $('#ia-estilo').value,
    }, acervoVideos); // ← acervo = títulos reais dos vídeos ({nome})
    // Ordena a seleção conforme a sugestão da IA (títulos que a IA citou primeiro)
    const ordemIA = [...(prog.ordemReproducao ?? []).map((n) => acervoVideos.find((v) => v.nome === n))].filter(Boolean);
    const restantes = acervoVideos.filter((v) => !ordemIA.includes(v));
    const faixasOrdem = [...ordemIA, ...restantes].map((v) => ({
      origem: 'youtube', videoId: v.videoId, nome: v.nome, canal: v.canal,
      thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    }));
    player.setFila(faixasOrdem);
    player.tocar(0);
    mostrarMiniYT();
    feedbackAviso('✔ Programação do YouTube montada pela IA e tocando.');
    document.querySelector('[data-tab="player"]')?.click();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="wand-2" class="w-4 h-4"></i> Criar programação com IA';
  }
}

// ============================================================
// MINI PLAYER YOUTUBE (visível/escondido)
// ============================================================
function mostrarMiniYT() {
  const mini = $('#yt-mini');
  mini?.classList.remove('hidden');
  const f = player.getAtual();
  $('#yt-mini-titulo').textContent = f?.nome ?? 'YouTube';
}

function alternarYTMini(visivel) {
  player.alternarVideoYT(visivel);
  $('#btn-yt-esconder').classList.toggle('hidden', !visivel);
  $('#btn-yt-mostrar').classList.toggle('hidden', visivel);
  const moldura = $('#yt-moldura');
  moldura.style.height = visivel ? '' : '2px';
  moldura.style.overflow = 'hidden';
  if (visivel) sanitizeMoldura(); else esconderIframe();
}

function esconderIframe() {
  // NO display:none — esconde com clamp de altura (o vídeo continua tocando)
  $('#yt-moldura').style.height = '2px';
  $('#yt-moldura').style.overflow = 'hidden';
}
function sanitizeMoldura() {
  const m = $('#yt-moldura');
  m.style.height = '144px';
  m.style.overflow = 'hidden';
}

// ============================================================
// AJUDE O DESENVOLVEDOR — PIX (copia e cola + QR)
// ============================================================
const PIX_CHAVE =
  '00020126330014br.gov.bcb.pix0111015619225015204000053039865802BR' +
  '5921FABIO SILVA DOS ANJOS6009Sao Paulo62290525REC6AF09CB01264A2203363336304C140';

function vincularPix() {
  const modal = $('#pix-modal');
  if (!modal) return;

  // Abre/fecha SEM sobrescrever classes: display:grid centraliza sempre
  const abrir = () => {
    modal.style.display = 'grid';
    $('#pix-copiado').classList.add('opacity-0');
    $('#pix-copiado').textContent = '✔ Código PIX copiado! Cole no seu app de banco.';
    $('#pix-qr').src = 'https://api.qrserver.com/v1/create-qr-code/?margin=8&size=192x192&data=' + encodeURIComponent(PIX_CHAVE);
  };
  const fechar = () => { modal.style.display = 'none'; };

  // Delegação global — funciona mesmo que o botão venha a ser recriado
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-ajude-desenvolvedor')) { abrir(); return; }
    if (e.target.closest('#pix-fechar') || e.target === modal) fechar();
    if (e.target.closest('#btn-copiar-pix')) {
      (navigator.clipboard?.writeText(PIX_CHAVE) ?? Promise.reject()).then(() => {
        $('#pix-copiado').classList.remove('opacity-0');
        setTimeout(() => $('#pix-copiado').classList.add('opacity-0'), 4000);
      }).catch(() => prompt('Copie o código PIX (selecione e Ctrl+C):', PIX_CHAVE));
      return;
    }
    if (e.target.closest('#btn-abrir-pix')) {
      navigator.clipboard?.writeText(PIX_CHAVE).catch(() => {});
      $('#pix-copiado').classList.remove('opacity-0');

      const links = [
        'pix://copiaecola?text=' + encodeURIComponent(PIX_CHAVE),
        'bank://?pix=' + encodeURIComponent(PIX_CHAVE),
      ];

      // Tenta abrir o app do banco, mas cai em fallback seguro se o deep link não for reconhecido.
      window.location.href = links[0];
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          $('#pix-copiado').textContent = '✔ Copiado! Abra seu app de banco e cole em "PIX copia e cola".';
          $('#pix-copiado').classList.remove('opacity-0');
          const fallback = window.prompt?.('Código PIX (copie e cole no seu app de banco):', PIX_CHAVE);
          if (fallback === null) {
            $('#pix-copiado').textContent = '✔ Código PIX copiado. Cole no seu app de banco.';
          }
        }
      }, 1400);
    }
  });

  modal.style.display = 'none'; // garante estado inicial
}

// ============================================================
// GERENCIAR PLAYLISTS (modal) + sincronização com o Drive
// ============================================================
function vincularGerenciarPlaylists() {
  const modal = $('#modal-playlists');
  if (!modal) return;
  const fechar = () => { modal.style.display = 'none'; };
  const abrir = () => {
    modal.style.display = 'grid';
    renderGerenciarPlaylists();
    if (window.lucide) lucide.createIcons();
  };
  // Delegação global (idêntica ao padrão da PIX modal)
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-gerenciar-playlist')) { abrir(); return; }
    if (e.target.closest('#mp-fechar') || e.target === modal) { fechar(); return; }
    const alvo = e.target.closest('[data-mp]');
    if (!alvo) return;
    const [acao, id, arg] = alvo.getAttribute('data-mp').split('|');
    
    try {
      if (acao === 'tocar') {
        player.setFila(playlists.carregarPlaylist(id));
        player.tocar(0);
        fechar();
        feedbackAviso('✔ Playlist tocando.');
      }
      if (acao === 'renomear') {
        playlists.renomearPlaylist(id, prompt('Novo nome da playlist:') || '');
        renderGerenciarPlaylists();
        atualizarSelectPlaylists();
      }
      if (acao === 'excluir') {
        if (confirm('Excluir esta playlist permanentemente?')) {
          playlists.removerPlaylist(id);
          renderGerenciarPlaylists();
          atualizarSelectPlaylists();
        }
      }
      if (acao === 'cima' || acao === 'baixo') {
        playlists.trocarFaixa(id, Number(arg), Number(arg) + (acao === 'cima' ? -1 : 1));
        renderGerenciarPlaylists();
      }
      if (acao === 'remover-faixa') {
        playlists.removerFaixa(id, Number(arg));
        renderGerenciarPlaylists();
      }
      if (acao === 'add-fila') {
        // adiciona a fila atual ao fim da playlist
        const lista = player.getFila();
        if (!lista.length) return alert('A fila está vazia — carregue o Drive ou o YouTube primeiro.');
        const atuais = playlists.getPlaylists();
        const p = atuais.find((x) => x.id === id);
        if (p) {
          p.faixas = [...p.faixas, ...lista.map(({ id: fid, nome, origem, url, videoId, canal }) =>
            (origem === 'youtube' ? { origem: 'youtube', videoId, nome, canal }
              : origem === 'local' ? { origem: 'local', nome, url }
              : { origem: 'drive', id: fid, nome }))];
          localStorage.setItem('radioPersonal:playlists', JSON.stringify(atuais));
          renderGerenciarPlaylists();
          feedbackAviso(`✔ ${lista.length} faixa(s) adicionadas à playlist.`);
        }
      }
      if (window.lucide) lucide.createIcons();
    } catch (err) { alert(err.message); }
  });

  // ===== Sincronização com o Drive =====
  $('#mp-salvar-drive')?.addEventListener('click', async () => {
    const st = $('#mp-status');
    try {
      st.textContent = 'Entrando na conta Google…';
      const r = await sync.salvarNoDrive(playlists.exportarParaDrive());
      st.textContent = r.criado ? '✔ Arquivo "radio-personal-playlists.json" criado na sua pasta do Drive!'
        : '✔ Playlists atualizadas no arquivo do Drive.';
    } catch (err) {
      st.textContent = '✖ ' + err.message;
    }
  });
  $('#mp-ler-drive')?.addEventListener('click', async () => {
    const st = $('#mp-status');
    try {
      st.textContent = 'Lendo do Drive…';
      const json = await sync.restaurarDoDrive();
      if (!json) { st.textContent = 'Nenhuma playlist salva no Drive ainda — use "Salvar no Drive" primeiro.'; return; }
      playlists.importarDoDrive(json.playlists, json.favoritos);
      renderGerenciarPlaylists();
      atualizarSelectPlaylists();
      renderFila();
      st.textContent = `✔ ${json.playlists?.length ?? 0} playlist(s) restauradas do Drive.`;
    } catch (err) {
      st.textContent = '✖ ' + err.message;
    }
  });
}

function renderGerenciarPlaylists() {
  const cont = $('#mp-lista');
  const listas = playlists.getPlaylists();
  cont.innerHTML = listas.length === 0
    ? '<p class="text-zinc-500 italic text-center py-6">Nenhuma playlist salva ainda.<br>Monte uma fila e clique no botão de salvar (💾) na aba Player.</p>'
    : listas.map((p) => `
    <details class="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
      <summary class="flex items-center gap-2 px-3 py-2.5 cursor-pointer">
        <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-500"></i>
        <span class="font-semibold flex-1 truncate">${p.nome}</span>
        <span class="text-xs text-zinc-500">${p.faixas.length} faixas</span>
        <span class="flex gap-1">
          <button data-mp="tocar|${p.id}" class="btn-secundario p-1" title="Tocar"><i data-lucide="play" class="w-3.5 h-3.5"></i></button>
          <button data-mp="renomear|${p.id}" class="btn-secundario p-1" title="Renomear"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
          <button data-mp="excluir|${p.id}" class="btn-secundario p-1 hover:text-red-400" title="Excluir"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </span>
      </summary>
      <ul class="px-3 pb-3 space-y-0.5">
        ${p.faixas.map((f, i) => `
        <li class="flex items-center gap-1.5 text-xs py-1 px-1 rounded hover:bg-white/5">
          <span class="flex-1 truncate">${f.nome}</span>
          <button data-mp="cima|${p.id}|${i}" class="p-1 text-zinc-500 hover:text-zinc-200 ${i === 0 ? 'opacity-30 pointer-events-none' : ''}" title="Mover para cima"><i data-lucide="arrow-up" class="w-3 h-3"></i></button>
          <button data-mp="baixo|${p.id}|${i}" class="p-1 text-zinc-500 hover:text-zinc-200 ${i === p.faixas.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="Mover para baixo"><i data-lucide="arrow-down" class="w-3 h-3"></i></button>
          <button data-mp="remover-faixa|${p.id}|${i}" class="p-1 text-zinc-500 hover:text-red-400" title="Remover da playlist"><i data-lucide="x" class="w-3 h-3"></i></button>
        </li>`).join('')}
      </ul>
      <div class="px-3 pb-3">
        <button data-mp="add-fila|${p.id}" class="btn-secundario text-xs py-1 w-full"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Adicionar fila atual a esta playlist</button>
      </div>
    </details>`).join('');
}

// ============================================================
// CONTA GOOGLE — login + envio de músicas locais ao Drive
// ============================================================
async function aoEntrarGoogle() {
  const st = $('#cfg-conta-status');
  const btn = $('#cfg-entrar-google');
  try {
    st.textContent = 'Abrindo login do Google…';
    await sync.entrarComGoogle();
    st.textContent = '✔ Conectado! Playlists salvas no Drive e uploads liberados.';
    btn.innerHTML = '<i data-lucide="user-check" class="w-4 h-4"></i> Conta Google conectada';
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    st.textContent = '✖ ' + err.message;
  }
}

/** Envia cada faixa local da fila para a pasta do Drive e a converte em faixa Drive. */
async function aoEnviarLocaisDrive() {
  const fila = player.getFila();
  const locais = fila.filter((f) => f.origem === 'local');
  if (!locais.length) return feedbackAviso('✖ Nenhum arquivo local na fila — adicione antes.');
  const btn = $('#btn-enviar-locais');
  btn.disabled = true;
  try {
    let ok = 0;
    for (let i = 0; i < locais.length; i++) {
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> ${i + 1}/${locais.length}`;
      if (window.lucide) lucide.createIcons();
      const f = locais[i];
      try {
        const blob = await fetch(f.url).then((r) => r.blob());
        // Convertendo blob para File com nome original para o Drive
        const ext = (f.nome.split('.').pop() || 'mp3');
        const arquivo = new File([blob], `${f.nome}.${ext}`, { type: blob.type || 'audio/mpeg' });
        const { id } = await sync.enviarArquivo(arquivo, arquivo.name, arquivo.type);
        // Substitui a faixa local pela faixa Drive (agora permanente na playlist também)
        const idx = fila.indexOf(f);
        if (idx >= 0) fila[idx] = { id, nome: f.nome, origem: 'drive', url: undefined };
        ok++;
      } catch { /* continua com as próximas */ }
    }
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="cloud-upload" class="w-4 h-4"></i> Enviar locais para o Drive';
    if (window.lucide) lucide.createIcons();
    feedbackAviso(`✔ ${ok} de ${locais.length} faixa(s) enviadas à pasta do Drive (agora permanentes).`);
    player.setFila(fila); // sincroniza filaBase (as faixas viraram de Drive)
    renderFila();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="cloud-upload" class="w-4 h-4"></i> Enviar locais para o Drive';
    feedbackAviso('✖ ' + err.message);
  }
}
