/* MR4 Catálogo — interface (usa window.CatalogoCore). Sem dependências. */
(function () {
  'use strict';
  const C = window.CatalogoCore;
  const Cesta = window.Cesta;
  const $ = id => document.getElementById(id);

  /* ───────── utilidades ───────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const mobile = () => window.matchMedia('(max-width:640px)').matches;
  const tamanhoPagina = () => (mobile() ? 24 : 36);

  /* ───────── estado ───────── */
  let itens = [];                       // catálogo preparado (CatalogoCore.prepararCatalogo)
  let porId = new Map();                // id → item (lookup; nada de JSON embutido no DOM)
  let destaqueIds = new Set();
  const estado = { q: '', cat: '', marca: '', sort: 'padrao' };
  let resultado = { lista: [], total: 0 };
  let visiveis = 0;
  let buscaTimer = null;
  let minVisiveis = 0;

  /* ───────── carregamento + cache do JSON ─────────
   * fetch com cache:'no-cache' = revalida a cada abertura com o ETag do GitHub Pages:
   * se o sync (≈30 min) não mudou o arquivo, a resposta é 304 (sem corpo); se mudou, baixa só o novo.
   * Sem ?v=Date.now() (que forçava download completo em toda visita) e sem ficar defasado.
   */
  async function inicializar() {
    renderSkeleton();
    try {
      const [resProd, resDest] = await Promise.all([
        fetch('./data/produtos.json', { cache: 'no-cache' }),
        fetch('./data/destaques.json', { cache: 'no-cache' }).catch(() => null)
      ]);
      if (!resProd.ok) throw new Error('Erro ao carregar produtos');
      const data = await resProd.json();
      itens = C.prepararCatalogo(data.produtos || []);
      porId = new Map(itens.map(e => [String(e.p.id), e]));
      if (data.atualizado) {
        const d = new Date(data.atualizado);
        const fmt = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
        const el = $('syncBadge');
        if (el) { el.textContent = '🔄 ' + fmt; el.classList.add('visible'); }
      }
      if (resDest && resDest.ok) {
        const dest = await resDest.json();
        (dest.ids || []).forEach(id => destaqueIds.add(String(id)));
      }
      $('totalProdutos').textContent = itens.length.toLocaleString('pt-BR') + '+';
      montarFiltros();
      const ini = estadoInicial();
      if (ini.cat && !itens.some(e => e.catChave === ini.cat)) ini.cat = '';
      if (ini.marca && !itens.some(e => e.marca === ini.marca)) ini.marca = '';
      Object.assign(estado, { q: ini.q, cat: ini.cat, marca: ini.marca, sort: ini.sort });
      $('searchInput').value = estado.q;
      minVisiveis = ini.visiveis;
      atualizar();
      if (ini.scroll) requestAnimationFrame(() => window.scrollTo(0, ini.scroll));
    } catch (err) {
      renderErro(err.message);
    }
  }

  /* ───────── filtros (categoria / marca) ───────── */
  function montarFiltros() {
    const cats = C.ordenarCategorias(itens.map(e => e.catChave));
    const contagem = {};
    itens.forEach(e => { contagem[e.catChave] = (contagem[e.catChave] || 0) + 1; });
    // pills (desktop)
    let html = `<button type="button" class="cat-pill" data-cat="" aria-pressed="true">Todas</button>`;
    cats.comerciais.forEach(c => { html += `<button type="button" class="cat-pill" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`; });
    cats.semGrupo.forEach(c => { html += `<button type="button" class="cat-pill sem-cat" data-cat="${esc(c)}" aria-pressed="false" title="Produtos ainda sem categoria no cadastro">${esc(C.rotuloCategoria(c))} (${contagem[c]})</button>`; });
    $('catPills').innerHTML = html;
    // select (mobile)
    let opt = `<option value="">Categoria: todas</option>`;
    cats.comerciais.forEach(c => { opt += `<option value="${esc(c)}">${esc(c)} (${contagem[c]})</option>`; });
    if (cats.semGrupo.length) {
      opt += `<optgroup label="Outros">` + cats.semGrupo.map(c => `<option value="${esc(c)}">${esc(C.rotuloCategoria(c))} (${contagem[c]})</option>`).join('') + `</optgroup>`;
    }
    $('catSelect').innerHTML = opt;
    // marcas
    $('brandSelect').innerHTML = `<option value="">Marca: todas</option>` +
      C.opcoesMarca(itens).map(o => `<option value="${esc(o.marca)}">${esc(o.marca)} (${o.n})</option>`).join('');
  }

  function sincronizarControles() {
    $('catSelect').value = estado.cat;
    $('brandSelect').value = estado.marca;
    $('sortSelect').value = estado.sort;
    document.querySelectorAll('.cat-pill').forEach(p => {
      const ativo = p.dataset.cat === estado.cat;
      p.classList.toggle('active', ativo);
      p.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    $('searchClear').hidden = !estado.q;
  }

  /* ───────── consulta + renderização incremental ───────── */
  function atualizar() {
    resultado = C.consultar(itens, estado, destaqueIds);
    visiveis = 0;
    sincronizarControles();
    renderInfo();
    $('countDisplay').textContent = resultado.total.toLocaleString('pt-BR');
    renderGrid(true);
    salvarEstado();
  }

  function renderInfo() {
    const el = $('resultInfo');
    const partes = [];
    const chips = [];
    if (estado.cat) chips.push(['cat', 'Categoria: ' + C.rotuloCategoria(estado.cat)]);
    if (estado.marca) chips.push(['marca', 'Marca: ' + estado.marca]);
    const n = resultado.total;
    const plural = n === 1 ? 'produto' : 'produtos';
    if (resultado.comBusca) {
      if (resultado.corrigido) {
        partes.push(`Nenhum resultado exato para “${esc(estado.q.trim())}”. Mostrando ${n} ${plural} para “${esc(resultado.corrigido)}”.`);
      } else {
        partes.push(`<strong>${n}</strong> ${n === 1 ? 'produto encontrado' : 'produtos encontrados'} para “${esc(estado.q.trim())}”`);
      }
    } else if (chips.length) {
      partes.push(`<strong>${n}</strong> ${plural}`);
    }
    if (!partes.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = partes.join(' ') +
      chips.map(c => `<span class="chip">${esc(c[1])}<button type="button" data-rm="${c[0]}" aria-label="Remover filtro ${esc(c[1])}">✕</button></span>`).join('') +
      `<button type="button" class="link-btn" data-limpar-tudo>Limpar ${resultado.comBusca && chips.length ? 'tudo' : (resultado.comBusca ? 'busca' : 'filtros')}</button>`;
  }

  function cardHTML(e) {
    const p = e.p;
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 10 ? `${p.stock} em estoque` : p.stock > 0 ? `Últimas ${p.stock} unid.` : 'Sem estoque';
    const isDestaque = destaqueIds.has(String(p.id));
    const id = esc(p.id);
    const naCesta = Cesta.qtdDe(p.id) > 0;
    return `<article class="product-card${isDestaque ? ' destaque-card' : ''}" data-id="${id}">
      ${isDestaque ? `<div class="destaque-badge">🔥 Destaque</div>` : ''}
      ${p.img ? `<div class="card-img"><img src="${esc(p.img)}" alt="" loading="lazy" decoding="async"></div>`
        : `<div class="img-placeholder" aria-hidden="true">${C.PLACEHOLDER_SVG}</div>`}
      <div class="card-body">
        <div class="card-top"><div class="card-ref">${esc(p.ref)}</div>${e.marca ? `<div class="card-brand-pill">${esc(e.marca)}</div>` : ''}</div>
        <h3 class="card-name"><a class="card-open" href="${esc(e.url)}" data-produto="${id}">${esc(p.name)}</a></h3>
        <div class="card-stock ${sc}">${sl}</div>
        <div class="card-footer">
          <div><span class="card-price-label">Preço unit.</span><span class="card-price">${esc(p.price)}</span></div>
          <button type="button" class="btn-add-cart${naCesta ? ' added' : ''}" data-add="${id}" aria-label="${naCesta ? 'Adicionado ao pedido: ' : 'Adicionar ao pedido: '}${esc(p.name)}">${naCesta ? '✓ Adicionado' : '+ Pedido'}</button>
        </div>
      </div>
    </article>`;
  }

  /* botões dos cards acompanham o pedido (em qualquer lugar que ele mude) */
  function marcarBotoes(id) {
    const naCesta = Cesta.qtdDe(id) > 0;
    document.querySelectorAll('[data-add]').forEach(b => {
      if (b.dataset.add !== String(id)) return;
      const nome = (porId.get(String(id)) || { p: { name: '' } }).p.name;
      b.classList.toggle('added', naCesta);
      b.textContent = naCesta ? '✓ Adicionado' : '+ Pedido';
      b.setAttribute('aria-label', (naCesta ? 'Adicionado ao pedido: ' : 'Adicionar ao pedido: ') + nome);
    });
  }

  /* ───────── estado da navegação (voltar da página do produto sem perder busca/filtros) ───────── */
  const CHAVE_ESTADO = 'mr4_estado_catalogo';
  function salvarEstado() {
    try { sessionStorage.setItem(CHAVE_ESTADO, JSON.stringify({ q: estado.q, cat: estado.cat, marca: estado.marca, sort: estado.sort, visiveis, scroll: Math.round(window.scrollY) })); } catch (e) {}
  }
  function lerEstadoSalvo() { try { return JSON.parse(sessionStorage.getItem(CHAVE_ESTADO) || 'null'); } catch (e) { return null; } }
  function tipoNavegacao() { try { return (performance.getEntriesByType('navigation')[0] || {}).type; } catch (e) { return ''; } }
  /** parâmetros da URL (?q= ?cat= ?marca=) e restauração (?r=1 ou botão voltar do navegador) */
  function estadoInicial() {
    const u = new URLSearchParams(location.search);
    const salvo = lerEstadoSalvo();
    if (salvo && (u.get('r') === '1' || tipoNavegacao() === 'back_forward')) {
      return { q: salvo.q || '', cat: salvo.cat || '', marca: salvo.marca || '', sort: salvo.sort || 'padrao', visiveis: salvo.visiveis || 0, scroll: salvo.scroll || 0 };
    }
    return { q: u.get('q') || '', cat: u.get('cat') || '', marca: u.get('marca') || '', sort: 'padrao', visiveis: 0, scroll: 0 };
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
    const html = resultado.lista.slice(reiniciar ? 0 : visiveis, ate).map(cardHTML).join('');
    if (reiniciar) grid.innerHTML = html; else grid.insertAdjacentHTML('beforeend', html);
    visiveis = ate;
    const resta = resultado.total - visiveis;
    $('loadMore').hidden = resta <= 0;
    $('moreInfo').textContent = `Mostrando ${visiveis.toLocaleString('pt-BR')} de ${resultado.total.toLocaleString('pt-BR')}`;
    $('btnMore').textContent = `Mostrar mais ${Math.min(passo, resta)} produtos`;
  }
  function mostrarMais() { if (visiveis < resultado.total) renderGrid(false); }

  function renderSkeleton() {
    $('grid').innerHTML = Array.from({ length: 8 }, () => `<div class="skeleton-card"><div class="skel skel-img"></div><div class="skel-body"><div class="skel skel-ref"></div><div class="skel skel-name"></div><div class="skel skel-name2"></div><div class="skel skel-price"></div></div></div>`).join('');
    $('loadMore').hidden = true;
  }
  function renderErro(msg) {
    $('grid').setAttribute('aria-busy', 'false');
    $('grid').innerHTML = `<div class="state-box"><h3>Erro ao carregar</h3><p>${esc(msg)}</p><button type="button" class="btn-retry" data-retry>Tentar novamente</button></div>`;
  }

  /* ───────── eventos (delegação — sem onclick inline) ───────── */
  function limparTudo() {
    estado.q = ''; estado.cat = ''; estado.marca = '';
    $('searchInput').value = '';
    atualizar();
  }
  function ligarEventos() {
    $('searchInput').addEventListener('input', e => {
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => { estado.q = e.target.value; atualizar(); }, 150);
      $('searchClear').hidden = !e.target.value;
    });
    $('searchInput').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.target.value = ''; estado.q = ''; atualizar(); } });
    $('searchClear').addEventListener('click', () => { $('searchInput').value = ''; estado.q = ''; atualizar(); $('searchInput').focus(); });
    $('catSelect').addEventListener('change', e => { estado.cat = e.target.value; atualizar(); });
    $('brandSelect').addEventListener('change', e => { estado.marca = e.target.value; atualizar(); });
    $('sortSelect').addEventListener('change', e => { estado.sort = e.target.value; atualizar(); });
    $('catPills').addEventListener('click', e => {
      const b = e.target.closest('.cat-pill'); if (!b) return;
      estado.cat = b.dataset.cat; atualizar();
    });
    $('resultInfo').addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { estado[rm.dataset.rm === 'cat' ? 'cat' : 'marca'] = ''; atualizar(); return; }
      if (e.target.closest('[data-limpar-tudo]')) {
        if (resultado.comBusca && !estado.cat && !estado.marca) { estado.q = ''; $('searchInput').value = ''; atualizar(); }
        else limparTudo();
      }
    });
    $('grid').addEventListener('click', e => {
      if (e.target.closest('[data-limpar-tudo]')) { limparTudo(); return; }
      if (e.target.closest('[data-retry]')) { inicializar(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { const it = porId.get(add.dataset.add); if (it) { Cesta.add(it.p, 1); } return; }
      if (e.target.closest('.card-open')) salvarEstado();          // vai para a página do produto: guarda busca/filtros/posição
    });
    window.addEventListener('pagehide', salvarEstado);
    $('btnMore').addEventListener('click', mostrarMais);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) mostrarMais(); }, { rootMargin: '600px 0px' }).observe($('loadMore'));
    }
    $('logoTopo').addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('btnContato').addEventListener('click', () => Cesta.abrirVendedores());
    Cesta.aoMudar(marcarBotoes);
  }

  Cesta.iniciar();
  ligarEventos();
  inicializar();
})();
