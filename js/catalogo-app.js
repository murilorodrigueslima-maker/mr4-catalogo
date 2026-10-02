/* MR4 Catálogo — interface (usa window.CatalogoCore). Sem dependências. */
(function () {
  'use strict';
  const C = window.CatalogoCore;
  const $ = id => document.getElementById(id);

  const VENDEDORES = [
    { id: 'linkAdemir', nome: 'Ademir', num: '558596098520' },
    { id: 'linkFabiana', nome: 'Fabiana', num: '558591194961' }
  ];

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
  let carrinho = {};
  let buscaTimer = null;
  let ultimoFoco = null;

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
      atualizar();
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
    const naCesta = !!carrinho[p.id];
    return `<article class="product-card${isDestaque ? ' destaque-card' : ''}" data-id="${id}">
      ${isDestaque ? `<div class="destaque-badge">🔥 Destaque</div>` : ''}
      ${p.img ? `<div class="card-img"><img src="${esc(p.img)}" alt="" loading="lazy" decoding="async"></div>`
        : `<div class="img-placeholder" aria-hidden="true"><svg width="72" height="72" viewBox="0 0 64 64" fill="none"><path d="M10 30 C10 18 16 12 26 11 L44 11" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M10 30 L10 46" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/><path d="M10 38 L44 38" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/><line x1="10" y1="22" x2="44" y2="22" stroke="#D4D4DC" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="30" x2="44" y2="30" stroke="#D4D4DC" stroke-width="1.2" stroke-linecap="round"/></svg></div>`}
      <div class="card-body">
        <div class="card-top"><div class="card-ref">${esc(p.ref)}</div>${e.marca ? `<div class="card-brand-pill">${esc(e.marca)}</div>` : ''}</div>
        <h3 class="card-name"><button type="button" class="card-open" data-open="${id}">${esc(p.name)}</button></h3>
        <div class="card-stock ${sc}">${sl}</div>
        <div class="card-footer">
          <div><span class="card-price-label">Preço unit.</span><span class="card-price">${esc(p.price)}</span></div>
          <button type="button" class="btn-add-cart${naCesta ? ' added' : ''}" data-add="${id}" aria-label="${naCesta ? 'Adicionado ao pedido: ' : 'Adicionar ao pedido: '}${esc(p.name)}">${naCesta ? '✓ Adicionado' : '+ Pedido'}</button>
        </div>
      </div>
    </article>`;
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
    const ate = Math.min(resultado.total, (reiniciar ? 0 : visiveis) + passo);
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

  /* ───────── carrinho (formato do localStorage preservado: mr4_carrinho) ───────── */
  function salvarCarrinho() { try { localStorage.setItem('mr4_carrinho', JSON.stringify(carrinho)); } catch (e) {} }
  function carregarCarrinho() {
    try {
      const s = localStorage.getItem('mr4_carrinho');
      if (s) { const c = JSON.parse(s); if (c && typeof c === 'object') carrinho = c; }
    } catch (e) {}
  }
  function marcarBotoes(id) {
    const naCesta = !!carrinho[id];
    document.querySelectorAll('[data-add]').forEach(b => {
      if (b.dataset.add !== String(id)) return;
      const nome = (porId.get(String(id)) || { p: { name: '' } }).p.name;
      b.classList.toggle('added', naCesta);
      b.textContent = naCesta ? '✓ Adicionado' : '+ Pedido';
      b.setAttribute('aria-label', (naCesta ? 'Adicionado ao pedido: ' : 'Adicionar ao pedido: ') + nome);
    });
    if (modalAtual && String(modalAtual.p.id) === String(id)) pintarBotaoModal();
  }
  function addCarrinho(p) {
    if (!carrinho[p.id]) carrinho[p.id] = { produto: p, qty: 1 }; else carrinho[p.id].qty++;
    salvarCarrinho(); atualizarCarrinho(); marcarBotoes(p.id);
  }
  function changeQty(id, delta) {
    if (!carrinho[id]) return;
    carrinho[id].qty += delta;
    if (carrinho[id].qty <= 0) delete carrinho[id];
    salvarCarrinho(); atualizarCarrinho(); marcarBotoes(id);
  }
  function setQty(id, val) {
    const n = parseInt(val, 10);
    if (!carrinho[id]) return;
    if (isNaN(n) || n <= 0) delete carrinho[id]; else carrinho[id].qty = n;
    salvarCarrinho(); atualizarCarrinho(); marcarBotoes(id);
  }
  function removeCarrinho(id) { delete carrinho[id]; salvarCarrinho(); atualizarCarrinho(); marcarBotoes(id); }

  function atualizarCarrinho() {
    const items = Object.values(carrinho);
    const total = items.reduce((s, i) => s + i.qty, 0);
    $('cartBadge').textContent = total;
    $('cartFab').setAttribute('aria-label', `Abrir meu pedido (${total} ${total === 1 ? 'item' : 'itens'})`);
    const body = $('cartBody'), foot = $('cartFoot');
    if (!items.length) {
      body.innerHTML = `<div class="cart-empty-state"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>Seu pedido está vazio.<br>Adicione produtos pelo catálogo.</p></div>`;
      foot.style.display = 'none';
      return;
    }
    body.innerHTML = items.map(i => {
      const id = esc(i.produto.id), nome = esc(i.produto.name);
      return `<div class="c-item" data-cid="${id}">
        ${i.produto.img ? `<img class="c-item-img" src="${esc(i.produto.img)}" alt="" loading="lazy">` : `<div class="c-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem" aria-hidden="true">📦</div>`}
        <div class="c-item-info">
          <div class="c-item-name">${nome}</div>
          <div class="c-item-ref">REF: ${esc(i.produto.ref)}</div>
          <div class="c-item-row">
            <div class="qty-ctrl">
              <button type="button" class="qty-btn" data-qty="-1" data-id="${id}" aria-label="Diminuir quantidade de ${nome}">−</button>
              <input class="qty-val" type="number" min="1" inputmode="numeric" value="${i.qty}" data-setqty="${id}" aria-label="Quantidade de ${nome}">
              <button type="button" class="qty-btn" data-qty="1" data-id="${id}" aria-label="Aumentar quantidade de ${nome}">+</button>
            </div>
            <button type="button" class="c-item-rm" data-rm-item="${id}" aria-label="Remover ${nome} do pedido">✕ Remover</button>
          </div>
        </div>
      </div>`;
    }).join('');
    foot.style.display = 'block';
  }

  function enviarPedidoWhats() {
    const items = Object.values(carrinho);
    if (!items.length) return;
    const nome = $('clienteNome').value.trim() || 'Cliente';
    const totalItens = items.reduce((s, i) => s + i.qty, 0);
    const linhas = [
      `Ola, MR4 Distribuidora!`, ``, `*${nome}* - Pedido:`, ``,
      ...items.map(i => `• ${i.qty}x ${i.produto.name} (Ref: ${i.produto.ref})`),
      ``, `*Total: ${totalItens} ${totalItens === 1 ? 'item' : 'itens'}*`
    ];
    const msg = linhas.join('\n');
    const encoded = encodeURIComponent(msg);
    fecharCarrinho(true);
    if (encoded.length > 3000) {
      try { navigator.clipboard.writeText(msg); } catch (e) {}
      setTimeout(() => {
        alert('Pedido muito grande para envio automático.\n\nO texto foi copiado! Cole no WhatsApp após abrir a conversa.');
        openWhats('');
      }, 300);
    } else {
      setTimeout(() => openWhats(encoded), 300);
    }
  }

  /* ───────── diálogos: foco, Esc, trap ───────── */
  const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  function abrirDialogo(raiz, foco) {
    ultimoFoco = document.activeElement;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { (foco || raiz.querySelector(FOCAVEIS) || raiz).focus(); }, 30);
  }
  function fecharDialogo(devolverFoco) {
    document.body.style.overflow = '';
    if (devolverFoco !== false && ultimoFoco && document.contains(ultimoFoco)) { try { ultimoFoco.focus(); } catch (e) {} }
  }
  function dialogoAberto() {
    if ($('vendedorModal').classList.contains('open')) return $('vendedorModal');
    if ($('modalBg').classList.contains('open')) return $('modalBg');
    if ($('cartSidebar').classList.contains('open')) return $('cartSidebar');
    return null;
  }

  /* carrinho (painel) */
  function abrirCarrinho() {
    $('cartSidebar').classList.add('open'); $('cartOverlay').classList.add('open');
    $('cartSidebar').setAttribute('aria-hidden', 'false');
    abrirDialogo($('cartSidebar'), $('cartClose'));
  }
  function fecharCarrinho(semFoco) {
    $('cartSidebar').classList.remove('open'); $('cartOverlay').classList.remove('open');
    $('cartSidebar').setAttribute('aria-hidden', 'true');
    fecharDialogo(!semFoco);
  }
  function toggleCart() { $('cartSidebar').classList.contains('open') ? fecharCarrinho() : abrirCarrinho(); }

  /* modal do produto */
  let modalAtual = null;
  function pintarBotaoModal() {
    const btn = $('mCartBtn');
    const jaAdicionado = !!(modalAtual && carrinho[modalAtual.p.id]);
    btn.className = 'btn-modal-cart' + (jaAdicionado ? ' added' : '');
    btn.innerHTML = jaAdicionado
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Adicionado ao Pedido`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Adicionar ao Pedido`;
  }
  function openModal(item) {
    modalAtual = item;
    const p = item.p;
    $('mTitle').textContent = p.name;
    $('mRef').textContent = 'Código ' + p.ref;
    const b = $('mBrand'); b.textContent = item.marca; b.hidden = !item.marca;
    $('mCat').textContent = item.semGrupo ? '' : p.category;      // sem categoria comercial: não mostra
    const d = $('mDesc'); d.textContent = p.desc || ''; d.style.display = p.desc ? 'block' : 'none';
    $('mPrice').textContent = p.price;
    const sb = $('mStock');
    if (p.stock > 10) { sb.className = 'modal-stock-badge ok'; sb.textContent = `${p.stock} em estoque`; }
    else if (p.stock > 0) { sb.className = 'modal-stock-badge low'; sb.textContent = `Últimas ${p.stock} unid.`; }
    else { sb.className = 'modal-stock-badge out'; sb.textContent = 'Sem estoque'; }
    $('mImg').innerHTML = p.img
      ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:contain;">`
      : `<svg width="56" height="56" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M10 30 C10 18 16 12 26 11 L44 11" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M10 30 L10 46" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/><path d="M10 38 L44 38" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/></svg>`;
    pintarBotaoModal();
    $('modalBg').classList.add('open');
    abrirDialogo($('modalBg'), $('mClose'));
  }
  function closeModal() {
    $('modalBg').classList.remove('open');
    modalAtual = null;
    fecharDialogo();
  }

  /* WhatsApp: escolha de vendedor (mantida) + ação por produto */
  function openWhats(prodMsg) {
    const msg = prodMsg || encodeURIComponent('Olá, MR4 Distribuidora! Gostaria de informações sobre o catálogo.');
    VENDEDORES.forEach(v => {
      const el = $(v.id);
      el.href = `https://wa.me/${v.num}?text=${msg}`;
      el.target = '_blank'; el.rel = 'noopener noreferrer';
    });
    $('vendedorModal').classList.add('open');
    abrirDialogo($('vendedorModal'), $('linkAdemir'));
  }
  function closeVendedorModal() { $('vendedorModal').classList.remove('open'); fecharDialogo(); }
  function interesseProduto() {
    if (!modalAtual) return;
    const p = modalAtual.p;
    const qtd = carrinho[p.id] ? carrinho[p.id].qty : 0;
    const msg = C.mensagemWhatsProduto(p, qtd);
    $('modalBg').classList.remove('open'); modalAtual = null; document.body.style.overflow = '';
    openWhats(encodeURIComponent(msg));
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
      if (add) { const it = porId.get(add.dataset.add); if (it) addCarrinho(it.p); return; }
      const card = e.target.closest('.product-card');
      if (card) { const it = porId.get(card.dataset.id); if (it) openModal(it); }
    });
    $('btnMore').addEventListener('click', mostrarMais);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) mostrarMais(); }, { rootMargin: '600px 0px' }).observe($('loadMore'));
    }
    $('logoTopo').addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('btnContato').addEventListener('click', () => openWhats());
    $('cartFab').addEventListener('click', toggleCart);
    $('cartClose').addEventListener('click', () => fecharCarrinho());
    $('cartOverlay').addEventListener('click', () => fecharCarrinho());
    $('btnEnviarPedido').addEventListener('click', enviarPedidoWhats);
    $('cartBody').addEventListener('click', e => {
      const q = e.target.closest('[data-qty]'); if (q) { changeQty(q.dataset.id, parseInt(q.dataset.qty, 10)); return; }
      const r = e.target.closest('[data-rm-item]'); if (r) removeCarrinho(r.dataset.rmItem);
    });
    $('cartBody').addEventListener('change', e => { if (e.target.dataset.setqty) setQty(e.target.dataset.setqty, e.target.value); });
    $('mClose').addEventListener('click', closeModal);
    $('modalBg').addEventListener('click', e => { if (e.target === $('modalBg')) closeModal(); });
    $('mCartBtn').addEventListener('click', () => {
      if (!modalAtual) return;
      addCarrinho(modalAtual.p);
      closeModal();
    });
    $('mInteresse').addEventListener('click', interesseProduto);
    $('vendedorFechar').addEventListener('click', closeVendedorModal);
    $('vendedorModal').addEventListener('click', e => { if (e.target === $('vendedorModal')) closeVendedorModal(); });
    document.addEventListener('keydown', e => {
      const d = dialogoAberto();
      if (!d) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (d === $('vendedorModal')) closeVendedorModal(); else if (d === $('modalBg')) closeModal(); else fecharCarrinho();
        return;
      }
      if (e.key === 'Tab') {                                   // mantém o foco dentro do diálogo
        const f = [...d.querySelectorAll(FOCAVEIS)].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const primeiro = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    });
  }

  carregarCarrinho();
  ligarEventos();
  atualizarCarrinho();
  inicializar();

  // compatibilidade com possíveis chamadas externas antigas
  window.openWhats = openWhats;
})();
