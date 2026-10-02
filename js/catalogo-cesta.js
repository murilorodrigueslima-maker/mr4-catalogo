/* MR4 Catálogo — pedido (carrinho), escolha de vendedor e diálogos. Compartilhado pelo catálogo e pelas páginas de produto.
 * Formato do localStorage preservado: chave `mr4_carrinho` = { [id]: { produto: {...}, qty } }.  Sem dependências. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // números mantidos exatamente como estavam (confirmação humana pendente sobre o do Ademir)
  const VENDEDORES = [
    { id: 'linkAdemir', nome: 'Ademir', num: '558596098520' },
    { id: 'linkFabiana', nome: 'Fabiana', num: '558591194961' }
  ];
  const ZAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  const MARKUP = `
<button class="cart-fab" type="button" id="cartFab" aria-label="Abrir meu pedido (0 itens)">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  Pedido
  <span class="cart-fab-badge" id="cartBadge" aria-hidden="true">0</span>
</button>
<div class="cart-overlay" id="cartOverlay"></div>
<div class="cart-sidebar" id="cartSidebar" role="dialog" aria-modal="true" aria-labelledby="cartTitle" aria-hidden="true">
  <div class="cart-head">
    <span class="cart-head-title" id="cartTitle">🛒 Meu Pedido</span>
    <button class="cart-head-close" type="button" id="cartClose" aria-label="Fechar meu pedido">✕</button>
  </div>
  <div class="cart-body" id="cartBody"></div>
  <div class="cart-foot" id="cartFoot" style="display:none">
    <label class="sr-only" for="clienteNome">Seu nome ou empresa</label>
    <input class="cart-input" id="clienteNome" placeholder="Seu nome ou empresa..." autocomplete="organization" />
    <button class="btn-send-whats" type="button" id="btnEnviarPedido">${ZAP} Enviar pedido pelo WhatsApp</button>
  </div>
</div>
<div class="vendedor-modal" id="vendedorModal">
  <div class="vendedor-box" role="dialog" aria-modal="true" aria-labelledby="vendedorTitulo">
    <h3 id="vendedorTitulo">Falar com vendedor</h3>
    <a class="vendedor-btn" id="linkAdemir" href="#" target="_blank" rel="noopener noreferrer">
      <div class="vendedor-avatar" aria-hidden="true">AD</div>
      <div class="vendedor-info"><div class="vendedor-nome">Ademir</div><div class="vendedor-num">(85) 96098-520</div></div>
    </a>
    <a class="vendedor-btn" id="linkFabiana" href="#" target="_blank" rel="noopener noreferrer">
      <div class="vendedor-avatar" aria-hidden="true">FA</div>
      <div class="vendedor-info"><div class="vendedor-nome">Fabiana</div><div class="vendedor-num">(85) 91194-961</div></div>
    </a>
    <button class="vendedor-fechar" type="button" id="vendedorFechar">Fechar</button>
  </div>
</div>`;

  let carrinho = {};
  let ultimoFoco = null;
  const ouvintes = [];

  function salvar() { try { localStorage.setItem('mr4_carrinho', JSON.stringify(carrinho)); } catch (e) {} }
  function carregar() {
    try {
      const s = localStorage.getItem('mr4_carrinho');
      if (s) { const c = JSON.parse(s); if (c && typeof c === 'object') carrinho = c; }
    } catch (e) {}
  }
  function avisar(id) { ouvintes.forEach(f => { try { f(id); } catch (e) {} }); }

  /* ───────── operações do pedido ───────── */
  function add(p, qtd) {
    qtd = Math.max(1, parseInt(qtd, 10) || 1);
    if (!carrinho[p.id]) carrinho[p.id] = { produto: p, qty: qtd }; else carrinho[p.id].qty += qtd;
    salvar(); desenhar(); avisar(p.id);
  }
  function changeQty(id, delta) {
    if (!carrinho[id]) return;
    carrinho[id].qty += delta;
    if (carrinho[id].qty <= 0) delete carrinho[id];
    salvar(); desenhar(); avisar(id);
  }
  function setQty(id, val) {
    const n = parseInt(val, 10);
    if (!carrinho[id]) return;
    if (isNaN(n) || n <= 0) delete carrinho[id]; else carrinho[id].qty = n;
    salvar(); desenhar(); avisar(id);
  }
  function remove(id) { delete carrinho[id]; salvar(); desenhar(); avisar(id); }
  const qtdDe = id => (carrinho[id] ? carrinho[id].qty : 0);

  function desenhar() {
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

  /* ───────── diálogos ───────── */
  const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  function abrirDialogo(foco) {
    ultimoFoco = document.activeElement;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { if (foco) foco.focus(); }, 30);
  }
  function fecharDialogo(devolverFoco) {
    document.body.style.overflow = '';
    if (devolverFoco !== false && ultimoFoco && document.contains(ultimoFoco)) { try { ultimoFoco.focus(); } catch (e) {} }
  }
  function abrirCarrinho() {
    $('cartSidebar').classList.add('open'); $('cartOverlay').classList.add('open');
    $('cartSidebar').setAttribute('aria-hidden', 'false');
    abrirDialogo($('cartClose'));
  }
  function fecharCarrinho(semFoco) {
    $('cartSidebar').classList.remove('open'); $('cartOverlay').classList.remove('open');
    $('cartSidebar').setAttribute('aria-hidden', 'true');
    fecharDialogo(!semFoco);
  }
  function abrirVendedores(mensagemCodificada) {
    const msg = mensagemCodificada || encodeURIComponent('Olá, MR4 Distribuidora! Gostaria de informações sobre o catálogo.');
    VENDEDORES.forEach(v => {
      const el = $(v.id);
      el.href = `https://wa.me/${v.num}?text=${msg}`;
      el.target = '_blank'; el.rel = 'noopener noreferrer';
    });
    $('vendedorModal').classList.add('open');
    abrirDialogo($('linkAdemir'));
  }
  function fecharVendedores() { $('vendedorModal').classList.remove('open'); fecharDialogo(); }
  function dialogoAberto() {
    if ($('vendedorModal').classList.contains('open')) return $('vendedorModal');
    if ($('cartSidebar').classList.contains('open')) return $('cartSidebar');
    return outroDialogo && outroDialogo.aberto() ? outroDialogo.raiz() : null;
  }
  let outroDialogo = null;     // gancho para diálogos extras da página (não usado hoje)

  function enviarPedido() {
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
        abrirVendedores('');
      }, 300);
    } else {
      setTimeout(() => abrirVendedores(encoded), 300);
    }
  }

  function iniciar() {
    if (!$('cartFab')) document.body.insertAdjacentHTML('beforeend', MARKUP);
    carregar();
    desenhar();
    $('cartFab').addEventListener('click', () => ($('cartSidebar').classList.contains('open') ? fecharCarrinho() : abrirCarrinho()));
    $('cartClose').addEventListener('click', () => fecharCarrinho());
    $('cartOverlay').addEventListener('click', () => fecharCarrinho());
    $('btnEnviarPedido').addEventListener('click', enviarPedido);
    $('cartBody').addEventListener('click', e => {
      const q = e.target.closest('[data-qty]'); if (q) { changeQty(q.dataset.id, parseInt(q.dataset.qty, 10)); return; }
      const r = e.target.closest('[data-rm-item]'); if (r) remove(r.dataset.rmItem);
    });
    $('cartBody').addEventListener('change', e => { if (e.target.dataset.setqty) setQty(e.target.dataset.setqty, e.target.value); });
    $('vendedorFechar').addEventListener('click', fecharVendedores);
    $('vendedorModal').addEventListener('click', e => { if (e.target === $('vendedorModal')) fecharVendedores(); });
    document.addEventListener('keydown', e => {
      const d = dialogoAberto();
      if (!d) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (d === $('vendedorModal')) fecharVendedores(); else fecharCarrinho();
        return;
      }
      if (e.key === 'Tab') {
        const f = [...d.querySelectorAll(FOCAVEIS)].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const primeiro = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    });
  }

  window.Cesta = {
    iniciar, add, changeQty, setQty, remove, qtdDe,
    abrirCarrinho, abrirVendedores, fecharCarrinho,
    aoMudar: f => ouvintes.push(f),
    ZAP, esc
  };
})();
