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
  $('#eq-treble').value = cfg.eq?.treble ?? 0;
  atualizarOfflineInfo();
  iniciarVisualizador();
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function configurarTabs() {
  $$('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-tab]').forEach((b) => b.classList.toggle('ativo', b === btn));
      $$('[data-page]').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== btn.dataset.tab));
    });
  });
  const primeiraTab = document.querySelector('[data-tab="player"]');
  if (primeiraTab) primeiraTab.classList.add('ativo');
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
    if (n) feedbackAviso(`${n} arquivo(s) local(is) adicionados à fila.`);
    e.target.value = '';
  });
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
  $('#cfg-drive').value = cfg.driveFonte || '';
}

function aoSalvarConfig(e) {
  e.preventDefault();
  const cfgAntiga = getConfig();
  salvarConfig({
    provedor: $('#cfg-provedor').value,
    apiKey: $('#cfg-apikey').value.trim(),
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
        <p class="text-xs text-zinc-500">${f.origem === 'drive' ? 'Google Drive' : 'Arquivo local'}</p>
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
