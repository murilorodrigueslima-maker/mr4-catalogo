/* MR4 Catálogo — interface (usa window.CatalogoCore e window.Cesta). Sem dependências.
 * UX B2B Fase A: busca no header, sidebar de categorias/marcas (desktop), bottom sheets (mobile), card B2B.
 * A lógica de busca/filtros/ordenação é a do núcleo (CatalogoCore.consultar) — inalterada. */
(function () {
  'use strict';
  const C = window.CatalogoCore;
  const Cesta = window.Cesta;
  const $ = id => document.getElementById(id);
  const esc = C.esc;
  const mobile = () => window.matchMedia('(max-width:640px)').matches;
  // lote da renderização incremental (mantém o DOM enxuto; o resto entra ao rolar)
  const tamanhoPagina = () => {
    if (estado.modo === 'compacto') return mobile() ? 24 : 30;           // linhas são leves, mas têm controles: lote próprio
    if (mobile()) return 20;
    const cols = (getComputedStyle($('grid')).gridTemplateColumns || '').split(' ').filter(Boolean).length || 4;
    return Math.max(20, cols * 5);
  };
  // preferência do modo: localStorage `mr4_modo_catalogo` = "visual" | "compacto" (ausente/inválido → visual)
  const CHAVE_MODO = 'mr4_modo_catalogo';
  const lerModo = () => { try { return C.normalizarModo(localStorage.getItem(CHAVE_MODO)); } catch (e) { return 'visual'; } };

  /* ───────── estado ───────── */
  let itens = [];
  let porId = new Map();
  let destaqueIds = new Set();
  const estado = { q: '', cat: '', marca: '', sort: 'padrao', modo: lerModo() };
  let resultado = { lista: [], total: 0 };
  let visiveis = 0;
  let buscaTimer = null;
  let minVisiveis = 0;
  let categorias = { comerciais: [], semGrupo: [] };
  const contagem = {};

  /* ───────── carregamento + cache do JSON (revalidação por ETag; sem ?v=Date.now()) ───────── */
  async function inicializar() {
    renderSkeleton();
    try {
      const [resProd, resDest] = await Promise.all([
        fetch('/data/produtos.json', { cache: 'no-cache' }),
        fetch('/data/destaques.json', { cache: 'no-cache' }).catch(() => null)
      ]);
      if (!resProd.ok) throw new Error('Erro ao carregar produtos');
      const data = await resProd.json();
      itens = C.prepararCatalogo(data.produtos || []);
      porId = new Map(itens.map(e => [String(e.p.id), e]));
      Cesta.definirCatalogo(itens);                                  // preço/estoque do pedido vêm deste JSON
      if (data.atualizado) {
        const d = new Date(data.atualizado);
        const fmt = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
        const el = $('syncBadge');
        if (el) el.textContent = 'Preços e estoque atualizados em ' + fmt;
      }
      if (resDest && resDest.ok) {
        const dest = await resDest.json();
        (dest.ids || []).forEach(id => destaqueIds.add(String(id)));
      }
      montarNavegacao();
      const ini = estadoInicial();
      if (ini.cat && !itens.some(e => e.catChave === ini.cat)) ini.cat = '';
      if (ini.marca && !itens.some(e => e.marca === ini.marca)) ini.marca = '';
      Object.assign(estado, { q: ini.q, cat: ini.cat, marca: ini.marca, sort: ini.sort });
      $('searchInput').value = estado.q;
      minVisiveis = ini.visiveis;
      atualizar();
      if (ini.scroll) setTimeout(() => window.scrollTo(0, ini.scroll), 60);
    } catch (err) {
      renderErro(err.message);
    }
  }

  /* ───────── navegação: categorias e marcas ───────── */
  function hrefPara(cat, marca) {
    const u = new URLSearchParams();
    if (cat) u.set('cat', cat);
    if (marca) u.set('marca', marca);
    const s = u.toString();
    return s ? '/?' + s : '/';
  }
  function montarNavegacao() {
    categorias = C.ordenarCategorias(itens.map(e => e.catChave));
    itens.forEach(e => { contagem[e.catChave] = (contagem[e.catChave] || 0) + 1; });
    let h = `<a class="cat-link" href="/" data-cat="">Todas <span class="n">${itens.length}</span></a>`;
    categorias.comerciais.forEach(c => { h += `<a class="cat-link" href="${esc(hrefPara(c, ''))}" data-cat="${esc(c)}">${esc(c)} <span class="n">${contagem[c]}</span></a>`; });
    categorias.semGrupo.forEach(c => { h += `<a class="cat-link sem-cat" href="${esc(hrefPara(c, ''))}" data-cat="${esc(c)}">${esc(C.rotuloCategoria(c))} <span class="n">${contagem[c]}</span></a>`; });
    $('catLista').innerHTML = h;
    const marcas = C.opcoesMarca(itens);
    $('marcaLista').innerHTML = `<a class="cat-link" href="/" data-marca="">Todas as marcas</a>` +
      marcas.map(o => `<a class="cat-link" href="${esc(hrefPara('', o.marca))}" data-marca="${esc(o.marca)}">${esc(o.marca)} <span class="n">${o.n}</span></a>`).join('');
  }

  function sincronizarControles() {
    document.querySelectorAll('#catLista .cat-link').forEach(a => a.setAttribute('aria-current', a.dataset.cat === estado.cat ? 'true' : 'false'));
    document.querySelectorAll('#marcaLista .cat-link').forEach(a => a.setAttribute('aria-current', a.dataset.marca === estado.marca ? 'true' : 'false'));
    $('marcaAtual').textContent = estado.marca ? '· ' + estado.marca : '';
    if (estado.marca) $('marcaDet').open = true;
    $('sortSelect').value = estado.sort;
    const rotOrd = ($('sortSelect').selectedOptions[0] || {}).textContent || 'Ordenar';
    const set = (id, ativo, texto) => { const b = $(id); b.classList.toggle('ativo', ativo); b.firstElementChild.textContent = texto; };
    set('btnCat', !!estado.cat, estado.cat ? C.rotuloCategoria(estado.cat) : 'Categorias');
    set('btnMarca', !!estado.marca, estado.marca || 'Marca');
    set('btnOrdem', estado.sort !== 'padrao', estado.sort !== 'padrao' ? rotOrd : 'Ordenar');
    $('searchClear').hidden = !estado.q;
  }

  /* ───────── consulta + renderização incremental ───────── */
  function atualizar() {
    resultado = C.consultar(itens, estado, destaqueIds);
    visiveis = 0;
    aplicarModo();
    sincronizarControles();
    renderInfo();
    renderGrid(true);
    salvarEstado();
    atualizarUrl();
  }

  function renderInfo() {
    const el = $('resultInfo');
    const n = resultado.total;
    const plural = n === 1 ? 'produto' : 'produtos';
    const chips = [];
    if (estado.cat) chips.push(['cat', C.rotuloCategoria(estado.cat)]);
    if (estado.marca) chips.push(['marca', estado.marca]);
    let texto;
    if (resultado.comBusca) {
      texto = resultado.corrigido
        ? `Nenhum resultado exato para “${esc(estado.q.trim())}”. Mostrando <strong>${n}</strong> ${plural} para “${esc(resultado.corrigido)}”.`
        : `<strong>${n}</strong> ${n === 1 ? 'produto encontrado' : 'produtos encontrados'} para “${esc(estado.q.trim())}”`;
    } else {
      texto = `<strong>${n.toLocaleString('pt-BR')}</strong> ${plural}`;
    }
    const algum = resultado.comBusca || chips.length;
    el.innerHTML = `<span>${texto}</span>` +
      chips.map(c => `<span class="chip">${esc(c[1])}<button type="button" data-rm="${c[0]}" aria-label="Remover filtro ${esc(c[1])}">✕</button></span>`).join('') +
      (algum ? `<button type="button" class="link-btn" data-limpar-tudo>${resultado.comBusca && !chips.length ? 'Limpar busca' : (chips.length && !resultado.comBusca ? 'Limpar filtros' : 'Limpar tudo')}</button>` : '');
  }

  const cardHTML = e => C.htmlCard(e, { qtd: Cesta.qtdDe(e.p.id), destaque: destaqueIds.has(String(e.p.id)) });
  const linhaHTML = e => C.htmlLinha(e, { qtd: Cesta.qtdDe(e.p.id), destaque: destaqueIds.has(String(e.p.id)) });
  /** aplica o modo ao contêiner e ao seletor (mesmos dados, outra representação) */
  function aplicarModo() {
    const g = $('grid'), compacto = estado.modo === 'compacto';
    g.className = compacto ? 'lista-compacta' : 'grade';
    if (compacto) g.setAttribute('role', 'list'); else g.removeAttribute('role');
    document.body.dataset.modo = estado.modo;
    document.querySelectorAll('.modo-btn').forEach(b => b.setAttribute('aria-pressed', b.dataset.modo === estado.modo ? 'true' : 'false'));
  }

  function renderGrid(reiniciar) {
    const grid = $('grid');
    grid.setAttribute('aria-busy', 'false');
    if (!resultado.total) {
      grid.innerHTML = `<div class="state-box"><h3>Nenhum produto encontrado</h3><p>Tente outro termo, outra marca ou categoria.</p><button type="button" class="btn-retry" data-limpar-tudo>Limpar busca e filtros</button></div>`;
      $('loadMore').hidden = true;
      return;
    }
    const passo = tamanhoPagina();
    const ate = Math.min(resultado.total, reiniciar ? Math.max(passo, minVisiveis) : visiveis + passo);
    minVisiveis = 0;
    const compacto = estado.modo === 'compacto';
    const html = resultado.lista.slice(reiniciar ? 0 : visiveis, ate).map(compacto ? linhaHTML : cardHTML).join('');
    if (reiniciar) grid.innerHTML = (compacto ? C.htmlCabecalhoLista() : '') + html; else grid.insertAdjacentHTML('beforeend', html);
    visiveis = ate;
    const resta = resultado.total - visiveis;
    $('loadMore').hidden = resta <= 0;
    $('moreInfo').textContent = `Mostrando ${visiveis.toLocaleString('pt-BR')} de ${resultado.total.toLocaleString('pt-BR')}`;
    $('btnMore').textContent = `Mostrar mais ${Math.min(passo, resta)} produtos`;
  }
  function mostrarMais() { if (visiveis < resultado.total) renderGrid(false); }

  function renderSkeleton() {
    aplicarModo();
    $('grid').innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton-card skel"></div>`).join('');
    $('loadMore').hidden = true;
  }
  function renderErro(msg) {
    $('grid').setAttribute('aria-busy', 'false');
    $('grid').innerHTML = `<div class="state-box"><h3>Erro ao carregar</h3><p>${esc(msg)}</p><button type="button" class="btn-retry" data-retry>Tentar novamente</button></div>`;
  }

  /** Visual ⇄ Compacto: mesma consulta/estado; só redesenha, mantendo o mesmo trecho da lista e a quantidade já carregada */
  function trocarModo(novo) {
    novo = C.normalizarModo(novo);
    if (novo === estado.modo) return;
    try { localStorage.setItem(CHAVE_MODO, novo); } catch (e) {}
    const alvo = [...document.querySelectorAll('[data-id]')].find(el => !el.closest('header') && el.getBoundingClientRect().bottom > 72);   // 1º item visível
    const idTopo = alvo ? alvo.dataset.id : null;
    estado.modo = novo;
    aplicarModo();
    minVisiveis = Math.max(visiveis, minVisiveis);
    renderGrid(true);
    if (idTopo) {
      const el = $('grid').querySelector(`[data-id="${idTopo.replace(/"/g, '')}"]`);
      if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 76));
    }
  }

  /* ───────── estado da navegação (voltar da página do produto sem perder busca/filtros) ───────── */
  const CHAVE_ESTADO = 'mr4_estado_catalogo';
  function salvarEstado() {
    try { sessionStorage.setItem(CHAVE_ESTADO, JSON.stringify({ q: estado.q, cat: estado.cat, marca: estado.marca, sort: estado.sort, visiveis, scroll: Math.round(window.scrollY) })); } catch (e) {}
  }
  function lerEstadoSalvo() { try { return JSON.parse(sessionStorage.getItem(CHAVE_ESTADO) || 'null'); } catch (e) { return null; } }
  function tipoNavegacao() { try { return (performance.getEntriesByType('navigation')[0] || {}).type; } catch (e) { return ''; } }
  function estadoInicial() {
    const u = new URLSearchParams(location.search);
    const salvo = lerEstadoSalvo();
    if (salvo && (u.get('r') === '1' || tipoNavegacao() === 'back_forward')) {
      return { q: salvo.q || '', cat: salvo.cat || '', marca: salvo.marca || '', sort: salvo.sort || 'padrao', visiveis: salvo.visiveis || 0, scroll: salvo.scroll || 0 };
    }
    return { q: u.get('q') || '', cat: u.get('cat') || '', marca: u.get('marca') || '', sort: 'padrao', visiveis: 0, scroll: 0 };
  }
  /** mantém ?q= ?cat= ?marca= na barra de endereço (link copiável), sem criar entradas no histórico */
  function atualizarUrl() {
    try {
      const u = new URLSearchParams();
      if (estado.q.trim()) u.set('q', estado.q.trim());
      if (estado.cat) u.set('cat', estado.cat);
      if (estado.marca) u.set('marca', estado.marca);
      const s = u.toString();
      const alvo = location.pathname + (s ? '?' + s : '');
      if (alvo !== location.pathname + location.search) history.replaceState(null, '', alvo);
    } catch (e) {}
  }

  /* ───────── bottom sheet (mobile/tablet): categorias, marca, ordenar ───────── */
  const FOCAVEIS = 'button:not([disabled]),input:not([disabled])';
  let sheetOpener = null, sheetAoEscolher = null;
  function abrirSheet(opener, titulo, grupos, atual, aoEscolher) {
    sheetOpener = opener; sheetAoEscolher = aoEscolher;
    $('sheetTit').textContent = titulo;
    $('sheetLista').innerHTML = grupos.map(g =>
      (g.rotulo ? `<div class="sheet-grupo">${esc(g.rotulo)}</div>` : '') +
      g.opcoes.map(o => `<label class="opt"><input type="radio" name="sheetOpt" value="${esc(o.v)}"${o.v === atual ? ' checked' : ''}><span>${esc(o.r)}</span>${o.n != null ? `<em>${o.n}</em>` : ''}</label>`).join('')
    ).join('');
    $('sheetBg').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const f = $('sheetLista').querySelector('input:checked') || $('sheetLista').querySelector('input'); if (f) f.focus(); }, 30);
  }
  function fecharSheet() {
    $('sheetBg').classList.remove('open');
    document.body.style.overflow = '';
    if (sheetOpener && document.contains(sheetOpener)) { try { sheetOpener.focus(); } catch (e) {} }
    sheetOpener = null; sheetAoEscolher = null;
  }
  const sheetAberto = () => $('sheetBg').classList.contains('open');
  function entradaGrupo() { return $('sheetLista').querySelector('input:checked') || $('sheetLista').querySelector('input'); }
  function sheetCategorias(opener) {
    const grupos = [{ opcoes: [{ v: '', r: 'Todas as categorias', n: itens.length }].concat(categorias.comerciais.map(c => ({ v: c, r: c, n: contagem[c] }))) }];
    if (categorias.semGrupo.length) grupos.push({ rotulo: 'Outros', opcoes: categorias.semGrupo.map(c => ({ v: c, r: C.rotuloCategoria(c), n: contagem[c] })) });
    abrirSheet(opener, 'Categorias', grupos, estado.cat, v => { estado.cat = v; atualizar(); });
  }
  function sheetMarcas(opener) {
    abrirSheet(opener, 'Marca', [{ opcoes: [{ v: '', r: 'Todas as marcas', n: null }].concat(C.opcoesMarca(itens).map(o => ({ v: o.marca, r: o.marca, n: o.n }))) }], estado.marca, v => { estado.marca = v; atualizar(); });
  }
  function sheetOrdem(opener) {
    abrirSheet(opener, 'Ordenar', [{ opcoes: [...$('sortSelect').options].map(o => ({ v: o.value, r: o.textContent, n: null })) }], estado.sort, v => { estado.sort = v; atualizar(); });
  }

  /* ───────── eventos (delegação — sem onclick inline) ───────── */
  function limparTudo() {
    estado.q = ''; estado.cat = ''; estado.marca = '';
    $('searchInput').value = '';
    atualizar();
  }
  const semModificador = e => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0);
  function ligarEventos() {
    const campo = $('searchInput');
    const ajustaPlaceholder = () => { campo.placeholder = mobile() ? 'Buscar produto…' : 'Busque produto, código, marca ou categoria'; };
    ajustaPlaceholder(); window.addEventListener('resize', ajustaPlaceholder);
    campo.addEventListener('input', e => {
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => { estado.q = e.target.value; atualizar(); }, 150);
      $('searchClear').hidden = !e.target.value;
    });
    campo.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; estado.q = ''; atualizar(); } });
    $('buscaForm').addEventListener('submit', e => { e.preventDefault(); clearTimeout(buscaTimer); estado.q = campo.value; atualizar(); campo.blur(); });
    $('searchClear').addEventListener('click', () => { campo.value = ''; estado.q = ''; atualizar(); campo.focus(); });
    document.addEventListener('keydown', e => {                // "/" foca a busca (desktop), sem atrapalhar campos nem diálogos
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, tag = (t && t.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (t && t.isContentEditable) || sheetAberto() || document.querySelector('.cart-sidebar.open,.vendedor-modal.open')) return;
      e.preventDefault(); campo.focus(); campo.select();
    });
    $('sortSelect').addEventListener('change', e => { estado.sort = e.target.value; atualizar(); });
    document.querySelectorAll('.modo-btn').forEach(b => b.addEventListener('click', () => trocarModo(b.dataset.modo)));
    $('lateral').addEventListener('click', e => {
      const a = e.target.closest('a.cat-link'); if (!a || !semModificador(e)) return;
      e.preventDefault();
      if ('cat' in a.dataset) estado.cat = a.dataset.cat; else estado.marca = a.dataset.marca;
      atualizar();
    });
    $('btnCat').addEventListener('click', e => sheetCategorias(e.currentTarget));
    $('btnMarca').addEventListener('click', e => sheetMarcas(e.currentTarget));
    $('btnOrdem').addEventListener('click', e => sheetOrdem(e.currentTarget));
    $('sheetClose').addEventListener('click', fecharSheet);
    $('sheetBg').addEventListener('click', e => { if (e.target === $('sheetBg')) fecharSheet(); });
    $('sheetLista').addEventListener('change', e => {
      if (e.target.name !== 'sheetOpt') return;
      const cb = sheetAoEscolher; const v = e.target.value;
      fecharSheet(); if (cb) cb(v);
    });
    document.addEventListener('keydown', e => {
      if (!sheetAberto()) return;
      if (e.key === 'Escape') { e.preventDefault(); fecharSheet(); return; }
      if (e.key === 'Tab') {                                   // ordem: Fechar → grupo de opções (radios) → Fechar
        const fechar = $('sheetClose'), ativo = document.activeElement, noGrupo = $('sheetLista').contains(ativo);
        if (e.shiftKey && ativo === fechar) { e.preventDefault(); const g = entradaGrupo(); if (g) g.focus(); }
        else if (!e.shiftKey && noGrupo) { e.preventDefault(); fechar.focus(); }
        else if (e.shiftKey && noGrupo) { e.preventDefault(); fechar.focus(); }
        else if (!e.shiftKey && ativo === fechar) { e.preventDefault(); const g = entradaGrupo(); if (g) g.focus(); }
      }
    });
    $('resultInfo').addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { estado[rm.dataset.rm === 'cat' ? 'cat' : 'marca'] = ''; atualizar(); return; }
      if (e.target.closest('[data-limpar-tudo]')) {
        if (resultado.comBusca && !estado.cat && !estado.marca) { estado.q = ''; campo.value = ''; atualizar(); }
        else if (!resultado.comBusca) { estado.cat = ''; estado.marca = ''; atualizar(); }
        else limparTudo();
      }
    });
    $('grid').addEventListener('click', e => {
      if (e.target.closest('[data-limpar-tudo]')) { limparTudo(); return; }
      if (e.target.closest('[data-retry]')) { inicializar(); return; }
      if (e.target.closest('.card-open, .l-link')) salvarEstado();      // vai para a página do produto: guarda busca/filtros/posição
    });
    window.addEventListener('pagehide', salvarEstado);
    $('btnMore').addEventListener('click', mostrarMais);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) mostrarMais(); }, { rootMargin: '600px 0px' }).observe($('loadMore'));
    }
    $('logoTopo').addEventListener('click', e => { if (location.pathname === '/' && !location.search) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    $('btnContato').addEventListener('click', () => Cesta.abrirVendedores());
    $('rodapeAtend').addEventListener('click', () => Cesta.abrirVendedores());
    Cesta.delegarAcao($('grid'), id => (porId.get(String(id)) || {}).p);   // stepper/Adicionar dos cards (não abre a página)
    Cesta.aoMudar(id => Cesta.pintar(id));
  }

  Cesta.iniciar();
  ligarEventos();
  inicializar();
})();
