/* MR4 Catálogo — pedido (carrinho), quantidade nos cards, painel do pedido, vendedor e diálogos.
 * Compartilhado pelo catálogo e pelas páginas de produto.
 *
 * localStorage `mr4_carrinho` — formato PRESERVADO (compatível com carrinhos anteriores às Fases A/B):
 *     { "<id>": { "produto": { id, ref, name, price, stock, img, ... }, "qty": <inteiro ≥ 1> } }
 * O `produto` guardado é só um instantâneo (nome/código/foto/preço da hora de adicionar). O PREÇO e o ESTOQUE usados no
 * pedido vêm sempre do produtos.json atual (CatalogoCore.resolverPedido, por código). Nada é apagado por mudança de formato.
 * Outra chave: `mr4_ultimo_vendedor` (preferência de envio). */
(function () {
  'use strict';
  const C = window.CatalogoCore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // números mantidos exatamente como estavam (confirmação humana pendente sobre o do Ademir)
  const VENDEDORES = [
    { chave: 'ademir', id: 'linkAdemir', nome: 'Ademir', num: '558596098520' },
    { chave: 'fabiana', id: 'linkFabiana', nome: 'Fabiana', num: '558591194961' }
  ];
  const ZAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  const MARKUP = `
<div class="cart-overlay" id="cartOverlay"></div>
<aside class="cart-sidebar" id="cartSidebar" aria-labelledby="cartTitle" aria-hidden="true">
  <div class="cart-head">
    <h2 class="cart-head-title" id="cartTitle">Meu pedido</h2>
    <button class="cart-head-close" type="button" id="cartClose" aria-label="Fechar pedido">✕</button>
  </div>
  <div class="cart-body" id="cartBody"></div>
  <div class="cart-foot" id="cartFoot" hidden>
    <div class="cart-resumo"><span id="cartQtdItens"></span><span class="cart-total">Total estimado: <strong id="cartTotal">—</strong></span></div>
    <p class="cart-nota" id="cartNota">Valores e disponibilidade sujeitos à confirmação no atendimento.</p>
    <div class="cart-form">
      <label class="sr-only" for="clienteNome">Seu nome ou empresa</label>
      <input class="cart-input" id="clienteNome" placeholder="Seu nome ou empresa..." autocomplete="organization" />
      <label class="sr-only" for="vendedorSel">Enviar para</label>
      <select id="vendedorSel">${VENDEDORES.map(v => `<option value="${v.chave}">Para: ${v.nome}</option>`).join('')}</select>
    </div>
    <button class="btn-send-whats" type="button" id="btnEnviarPedido">${ZAP} Enviar pedido pelo WhatsApp</button>
    <p class="cart-msg" id="cartMsg" role="status" hidden></p>
    <div class="cart-sec">
      <button class="btn-continuar" type="button" id="btnContinuar">Continuar comprando</button>
      <button class="link-btn" type="button" id="btnLimpar">Limpar pedido</button>
    </div>
    <div class="cart-confirma" id="limparConfirma" hidden>
      <span id="limparTxt">Remover todos os itens do pedido?</span>
      <button class="btn-perigo" type="button" id="limparSim">Sim, limpar</button>
      <button class="btn-continuar" type="button" id="limparNao">Cancelar</button>
    </div>
  </div>
</aside>
<div class="barra-pedido" id="barraPedido" hidden>
  <button type="button" id="barraVer" aria-label="Abrir meu pedido"><span id="barraTxt">Pedido</span><span class="ver">Ver ›</span></button>
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
</div>
<div class="sr-only" id="srAviso" role="status" aria-live="polite"></div>`;

  let carrinho = {};
  let catalogo = null;                    // catálogo ATUAL (CatalogoCore.prepararCatalogo) — fonte do preço/estoque do pedido
  let ultimoFoco = null;
  const ouvintes = [];
  const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : { matches: false, addEventListener() {} });

  /* ───────── armazenamento (compatível) ───────── */
  function salvar() { try { localStorage.setItem('mr4_carrinho', JSON.stringify(carrinho)); } catch (e) {} }
  function lerArmazenado() {
    try {
      const s = localStorage.getItem('mr4_carrinho');
      if (!s) return {};
      const c = JSON.parse(s);
      return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    } catch (e) { return {}; }
  }
  function carregar() { carrinho = lerArmazenado(); }          // nunca "conserta" apagando: itens estranhos ficam como estão
  function avisar(id) { ouvintes.forEach(f => { try { f(id); } catch (e) {} }); }
  const sr = t => { const el = $('srAviso'); if (el) el.textContent = t; };

  /* ───────── medição (GA4): só código/nome/marca/categoria/preço/quantidade; nunca nome do cliente, telefone ou mensagem ───────── */
  const MED = (n, p) => { try { if (window.Medicao) window.Medicao.track(n, p); } catch (e) {} };
  let usouRapido = false, origemVend = '', itemVend = '';
  function itemMed(id, qtd) {                                  // catálogo atual (marca/categoria); senão o instantâneo do carrinho
    const e = catalogo && catalogo.find(x => String(x.p.id) === String(id));
    if (e) return C.itemAnalytics(e, qtd);
    const l = carrinho[id]; return l && l.produto ? C.itemAnalytics({ p: l.produto }, qtd) : null;
  }
  const valorMed = it => (it && it.price != null && it.quantity != null ? Math.round(it.price * it.quantity * 100) / 100 : undefined);

  /* ───────── operações do pedido ───────── */
  const qtdDe = id => (carrinho[id] ? C.normalizarQtd(carrinho[id].qty) : 0);
  function add(p, qtd, origem) {
    qtd = C.normalizarQtd(qtd == null ? 1 : qtd);
    const antes = carrinho[p.id] ? C.normalizarQtd(carrinho[p.id].qty) : 0;
    if (!carrinho[p.id]) carrinho[p.id] = { produto: p, qty: qtd };
    else carrinho[p.id].qty = Math.min(C.MAX_QTD, C.normalizarQtd(carrinho[p.id].qty) + qtd);
    if (origem === 'pedido_rapido') usouRapido = true;
    try { const q = C.normalizarQtd(carrinho[p.id].qty) - antes, it = itemMed(p.id, q); MED('add_to_cart', { currency: 'BRL', value: valorMed(it), items: it ? [it] : [], origin: origem || 'catalogo' }); } catch (e) {}
    salvar(); mudou(p.id);
    sr(`Adicionado ao pedido: ${p.name}, ${carrinho[p.id].qty} ${carrinho[p.id].qty === 1 ? 'unidade' : 'unidades'}`);
  }
  /** medição de mudança de quantidade: ≤ 0 = remoção; senão `quantity_change` (de → para) */
  function medirQtd(id, de, para, origem) {
    try {
      if (para <= 0) { const it = itemMed(id, de); MED('remove_from_cart', { currency: 'BRL', value: valorMed(it), items: it ? [it] : [], origin: origem || 'pedido' }); }
      else if (para !== de) { const it = itemMed(id, 1); MED('quantity_change', { item_id: it && it.item_id, quantity_from: de, quantity_to: para }); }
    } catch (e) {}
  }
  function changeQty(id, delta) {
    if (!carrinho[id]) return;
    const de = qtdDe(id), n = de + delta;
    medirQtd(id, de, n <= 0 ? 0 : Math.min(C.MAX_QTD, n), 'pedido');
    if (n <= 0) delete carrinho[id]; else carrinho[id].qty = Math.min(C.MAX_QTD, n);
    salvar(); mudou(id);
  }
  function setQty(id, val) {
    if (!carrinho[id]) return;
    const n = parseInt(val, 10), de = qtdDe(id);
    medirQtd(id, de, isNaN(n) || n <= 0 ? 0 : Math.min(C.MAX_QTD, n), 'pedido');
    if (isNaN(n) || n <= 0) delete carrinho[id]; else carrinho[id].qty = Math.min(C.MAX_QTD, n);
    salvar(); mudou(id);
  }
  function remove(id) { medirQtd(id, qtdDe(id), 0, 'pedido'); delete carrinho[id]; salvar(); mudou(id); }
  function limpar() {
    try {
      const its = Object.keys(carrinho).slice(0, 20).map(id => itemMed(id, qtdDe(id))).filter(Boolean);
      if (its.length) MED('remove_from_cart', { currency: 'BRL', value: Math.round(its.reduce((s, i) => s + (valorMed(i) || 0), 0) * 100) / 100, items: its, origin: 'limpar_pedido' });
    } catch (e) {}
    carrinho = {}; salvar(); mudou(null);
  }
  const resumo = () => C.resolverPedido(carrinho, catalogo);
  function definirCatalogo(itens) { catalogo = itens; desenhar(); }
  function mudou(id) { desenhar(); avisar(id); }

  /* ───────── controle de quantidade + Adicionar (cards, relacionados e página do produto) ───────── */
  function pintarAcao(el) {
    const id = el.dataset.id, n = qtdDe(id), nome = el.dataset.nome || '';
    const inp = el.querySelector('.qi'), btn = el.querySelector('[data-add]');
    el.classList.toggle('no-pedido', n > 0);
    if (n > 0 && inp && document.activeElement !== inp) inp.value = String(n);
    if (btn) {
      btn.classList.toggle('added', n > 0);
      btn.textContent = n > 0 ? '✓ No pedido' : 'Adicionar';
      if (n > 0) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
      btn.setAttribute('aria-label', (n > 0 ? `No pedido: ${n} un. de ` : 'Adicionar ao pedido: ') + nome);
    }
  }
  function pintar(id) {
    document.querySelectorAll(id == null ? '.acao' : `.acao[data-id="${String(id).replace(/"/g, '')}"]`).forEach(pintarAcao);
  }
  function delegarAcao(raiz, resolver, origem) {
    const prod = el => resolver(el.dataset.id);
    const aplicar = (acao, adicionarSeFora) => {
      const inp = acao.querySelector('.qi'), id = acao.dataset.id, p = prod(acao);
      if (!inp || !p) return;
      const n = C.normalizarQtd(inp.value);
      inp.value = String(n);
      if (qtdDe(id) > 0) setQty(id, n); else if (adicionarSeFora) add(p, n, origem);
    };
    raiz.addEventListener('click', e => {
      const acao = e.target.closest('.acao'); if (!acao) return;
      const qb = e.target.closest('.qb');
      const add_ = e.target.closest('[data-add]');
      if (!qb && !add_) return;
      e.preventDefault(); e.stopPropagation();                      // nunca abre a página do produto
      const id = acao.dataset.id, p = prod(acao), inp = acao.querySelector('.qi');
      if (!p || !inp) return;
      if (qb) {
        const d = parseInt(qb.dataset.q, 10);
        if (qtdDe(id) > 0) changeQty(id, d);                       // no pedido: altera de verdade (− no 1 remove)
        else inp.value = String(Math.max(1, Math.min(C.MAX_QTD, C.normalizarQtd(inp.value) + d)));
      } else if (qtdDe(id) === 0) add(p, C.normalizarQtd(inp.value), origem);
    });
    raiz.addEventListener('input', e => {
      const qi = e.target.closest && e.target.closest('.qi'); if (!qi) return;
      const limpo = qi.value.replace(/\D/g, '').slice(0, 4);
      if (limpo !== qi.value) qi.value = limpo;
    });
    raiz.addEventListener('change', e => { const qi = e.target.closest && e.target.closest('.qi'); if (qi) aplicar(qi.closest('.acao'), false); });
    raiz.addEventListener('keydown', e => {
      const qi = e.target.closest && e.target.closest('.qi');
      if (qi && e.key === 'Enter') { e.preventDefault(); aplicar(qi.closest('.acao'), true); }
    });
  }

  /* ───────── painel do pedido ───────── */
  function linhaHTML(l) {
    const id = esc(l.id), nome = esc(l.nome);
    const img = l.img ? `<img class="c-item-img" src="${esc(l.img)}" alt="" loading="lazy">` : `<div class="c-item-img c-item-img--vazia" aria-hidden="true">📦</div>`;
    let avisos = '', valores = '';
    if (l.estado === 'indisponivel') {
      avisos = `<div class="c-aviso c-aviso--indisp">Produto indisponível no catálogo</div>`;
      valores = `<div class="c-calc">${l.qtd} un. · Subtotal indisponível</div>`;
    } else if (l.estado === 'carregando') {
      valores = `<div class="c-calc">${l.qtd} un. · carregando preço…</div>`;
    } else {
      if (l.acimaEstoque) avisos += `<div class="c-aviso c-aviso--estoque">Quantidade acima do estoque atual (${l.estoque})</div>`;
      valores = l.precoCent == null
        ? `<div class="c-calc">${l.qtd} un. · preço sob consulta</div>`
        : `<div class="c-calc">${l.qtd} × ${C.formatarCentavos(l.precoCent)}${l.precoAtualizado ? ' <span class="c-tag">Preço atualizado</span>' : ''} = <strong>${C.formatarCentavos(l.subtotalCent)}</strong></div>`;
    }
    return `<div class="c-item${l.estado === 'indisponivel' ? ' c-item--indisp' : ''}" data-cid="${id}">
      ${img}
      <div class="c-item-info">
        <div class="c-item-name">${nome}</div>
        <div class="c-item-ref">Cód. ${esc(l.ref)}</div>
        ${avisos}
        <div class="c-item-row">
          <div class="qty-ctrl">
            <button type="button" class="qty-btn" data-qty="-1" data-id="${id}" aria-label="Diminuir quantidade de ${nome}">−</button>
            <input class="qty-val" type="text" inputmode="numeric" maxlength="4" value="${l.qtd}" data-setqty="${id}" aria-label="Quantidade de ${nome}">
            <button type="button" class="qty-btn" data-qty="1" data-id="${id}" aria-label="Aumentar quantidade de ${nome}">+</button>
          </div>
          <button type="button" class="c-item-rm" data-rm-item="${id}" aria-label="Remover ${nome} do pedido">✕ Remover</button>
        </div>
        ${valores}
      </div>
    </div>`;
  }
  function desenhar() {
    const r = resumo();
    const total = r.totalItens;
    const rotulo = `${total} ${total === 1 ? 'item' : 'itens'}`;
    $('cartBadge').textContent = total;
    $('cartFab').setAttribute('aria-label', `Abrir meu pedido (${rotulo})`);
    const body = $('cartBody'), foot = $('cartFoot');
    // barra inferior (mobile/tablet): só com itens
    const barra = $('barraPedido');
    if (barra) {
      barra.hidden = !total;
      const totTxt = r.carregado && !r.semPreco ? ' · ' + C.formatarCentavos(r.totalCent) : (r.carregado && r.totalCent ? ' · ' + C.formatarCentavos(r.totalCent) : '');
      $('barraTxt').textContent = `Pedido · ${rotulo}${totTxt}`;
      document.body.classList && document.body.classList.toggle('com-barra', !!total);
    }
    if (!r.linhas.length) {
      body.innerHTML = `<div class="cart-empty-state"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>Seu pedido está vazio.<br>Adicione produtos pelo catálogo.</p></div>`;
      foot.hidden = true;
      return;
    }
    const ativo = document.activeElement;
    const d = (ativo && ativo.dataset) || {};
    const sel = d.setqty ? `[data-setqty="${d.setqty}"]` : (d.qty && d.id ? `[data-qty="${d.qty}"][data-id="${d.id}"]` : null);   // mantém o foco ao alterar pelo teclado
    body.innerHTML = r.linhas.map(linhaHTML).join('');
    if (sel) { const el = body.querySelector(sel); if (el) { el.focus(); if (d.setqty) { try { el.select(); } catch (e) {} } } }
    foot.hidden = false;
    $('cartQtdItens').textContent = rotulo;
    $('cartTotal').textContent = r.carregado ? (r.totalCent || !r.semPreco ? C.formatarCentavos(r.totalCent) : '—') : '—';
    const notas = ['Valores e disponibilidade sujeitos à confirmação no atendimento.'];
    if (r.indisponiveis) notas.unshift(`${r.indisponiveis} ${r.indisponiveis === 1 ? 'item indisponível não entra' : 'itens indisponíveis não entram'} no total.`);
    if (r.semPreco) notas.unshift(`${r.semPreco} ${r.semPreco === 1 ? 'item sem preço fixo não entra' : 'itens sem preço fixo não entram'} no total.`);
    $('cartNota').textContent = notas.join(' ');
  }

  /* modo do painel: docado (desktop largo, não bloqueia) ou modal (tablet/celular) */
  const ehDock = () => mq('(min-width:1280px)').matches;
  const painelAberto = () => $('cartSidebar').classList.contains('open');
  function abrirPedido(comFoco) {
    const sb = $('cartSidebar'), dock = ehDock();
    sb.classList.add('open'); sb.classList.toggle('dock', dock);
    sb.setAttribute('aria-hidden', 'false');
    if (dock) {
      sb.setAttribute('role', 'complementary'); sb.removeAttribute('aria-modal');
      document.body.classList.add('pedido-docado');
      try { sessionStorage.setItem('mr4_dock', '1'); } catch (e) {}
    } else {
      sb.setAttribute('role', 'dialog'); sb.setAttribute('aria-modal', 'true');
      $('cartOverlay').classList.add('open');
      ultimoFoco = document.activeElement; document.body.style.overflow = 'hidden';
    }
    $('cartFab').setAttribute('aria-expanded', 'true');
    if (comFoco !== false) {
      setTimeout(() => $('cartClose').focus(), 30);
      try { const r = resumo();                                      // view_cart: só ao abrir de verdade (não na restauração automática do painel docado)
      if (r.totalItens) MED('view_cart', { currency: 'BRL', value: r.carregado ? Math.round(r.totalCent) / 100 : undefined, item_count: r.totalItens, items: r.linhas.slice(0, 20).map(l => itemMed(l.id, l.qtd)).filter(Boolean) }); } catch (e) {}
    }
  }
  function fecharCarrinho(semFoco) {
    const sb = $('cartSidebar'), eraDock = sb.classList.contains('dock');
    sb.classList.remove('open'); $('cartOverlay').classList.remove('open');
    sb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('pedido-docado');
    try { sessionStorage.removeItem('mr4_dock'); } catch (e) {}
    $('cartFab').setAttribute('aria-expanded', 'false');
    $('limparConfirma').hidden = true;
    if (!eraDock) { document.body.style.overflow = ''; }
    if (!semFoco) { const alvo = eraDock ? $('cartFab') : ultimoFoco; if (alvo && document.contains(alvo)) { try { alvo.focus(); } catch (e) {} } }
  }
  const alternarPedido = () => (painelAberto() ? fecharCarrinho() : abrirPedido());

  /* vendedores */
  const lerVendedor = () => { try { const v = localStorage.getItem('mr4_ultimo_vendedor'); return VENDEDORES.some(x => x.chave === v) ? v : VENDEDORES[0].chave; } catch (e) { return VENDEDORES[0].chave; } };
  const gravarVendedor = v => { try { localStorage.setItem('mr4_ultimo_vendedor', v); } catch (e) {} };
  function abrirVendedores(mensagemCodificada, origem, itemRef) {
    origemVend = origem || 'atendimento'; itemVend = itemRef || '';
    MED('salesperson_selection_view', { origin: origemVend });
    const msg = mensagemCodificada || encodeURIComponent('Olá, MR4 Distribuidora! Gostaria de informações sobre o catálogo.');
    VENDEDORES.forEach(v => {
      const el = $(v.id);
      el.href = `https://wa.me/${v.num}?text=${msg}`;
      el.target = '_blank'; el.rel = 'noopener noreferrer';
    });
    $('vendedorModal').classList.add('open');
    ultimoFoco = document.activeElement; document.body.style.overflow = 'hidden';
    setTimeout(() => $('linkAdemir').focus(), 30);
  }
  function fecharVendedores() {
    $('vendedorModal').classList.remove('open');
    document.body.style.overflow = painelAberto() && !$('cartSidebar').classList.contains('dock') ? 'hidden' : '';
    if (ultimoFoco && document.contains(ultimoFoco)) { try { ultimoFoco.focus(); } catch (e) {} }
  }

  /** mensagem do pedido: a mesma de antes (nome/código/quantidade do carrinho; sem preço) */
  function mensagemPedido(nomeCliente) {
    const items = Object.values(carrinho).filter(i => i && i.produto);
    const totalItens = items.reduce((s, i) => s + C.normalizarQtd(i.qty), 0);
    const linhas = [
      `Ola, MR4 Distribuidora!`, ``, `*${nomeCliente || 'Cliente'}* - Pedido:`, ``,
      ...items.map(i => `• ${C.normalizarQtd(i.qty)}x ${i.produto.name} (Ref: ${i.produto.ref})`),
      ``, `*Total: ${totalItens} ${totalItens === 1 ? 'item' : 'itens'}*`
    ];
    return linhas.join('\n');
  }
  function enviarPedido() {
    if (!Object.keys(carrinho).length) return;
    const v = VENDEDORES.find(x => x.chave === ($('vendedorSel').value || lerVendedor())) || VENDEDORES[0];
    gravarVendedor(v.chave);
    const msg = mensagemPedido($('clienteNome').value.trim());
    const encoded = encodeURIComponent(msg);
    const msgEl = $('cartMsg');
    let url = `https://wa.me/${v.num}?text=${encoded}`;
    if (encoded.length > 3000) {                                  // pedido muito grande: copia o texto e abre a conversa vazia
      try { navigator.clipboard.writeText(msg); } catch (e) {}
      url = `https://wa.me/${v.num}`;
      msgEl.textContent = 'Pedido grande: o texto foi copiado. Cole na conversa do WhatsApp.'; msgEl.hidden = false;
    } else { msgEl.hidden = true; }
    try { const r = resumo();                                    // intenção de envio: NÃO prova que a mensagem foi enviada/recebida/faturada
      MED('whatsapp_order_click', { salesperson_id: v.chave, item_count: r.totalItens, line_count: r.linhas.length, value: r.carregado ? Math.round(r.totalCent) / 100 : undefined, currency: 'BRL', flow: usouRapido ? 'pedido_rapido' : 'catalogo', message_truncated: encoded.length > 3000 }); } catch (e) {}
    const w = window.open ? window.open(url, '_blank', 'noopener') : null;
    if (!w && typeof location !== 'undefined') { try { location.href = url; } catch (e) {} }
    sr(`Abrindo WhatsApp de ${v.nome}`);
  }

  function iniciar() {
    if (!$('cartSidebar')) document.body.insertAdjacentHTML('beforeend', MARKUP);
    if (!$('cartFab')) document.body.insertAdjacentHTML('beforeend', '<button class="cart-fab" type="button" id="cartFab" aria-label="Abrir meu pedido (0 itens)">Pedido <span class="cart-fab-badge" id="cartBadge" aria-hidden="true">0</span></button>');
    carregar();
    $('vendedorSel').value = lerVendedor();
    desenhar();
    $('cartFab').addEventListener('click', alternarPedido);
    $('cartClose').addEventListener('click', () => fecharCarrinho());
    $('btnContinuar').addEventListener('click', () => fecharCarrinho());
    $('cartOverlay').addEventListener('click', () => fecharCarrinho());
    $('barraVer').addEventListener('click', () => abrirPedido());
    $('btnEnviarPedido').addEventListener('click', enviarPedido);
    $('vendedorSel').addEventListener('change', e => { gravarVendedor(e.target.value); MED('salesperson_select', { salesperson_id: e.target.value, context: 'pedido' }); });
    $('btnLimpar').addEventListener('click', () => { $('limparConfirma').hidden = false; $('limparSim').focus(); });
    $('limparNao').addEventListener('click', () => { $('limparConfirma').hidden = true; $('btnLimpar').focus(); });
    $('limparSim').addEventListener('click', () => { limpar(); $('limparConfirma').hidden = true; sr('Pedido limpo'); });
    $('cartBody').addEventListener('click', e => {
      const q = e.target.closest('[data-qty]'); if (q) { changeQty(q.dataset.id, parseInt(q.dataset.qty, 10)); return; }
      const r = e.target.closest('[data-rm-item]'); if (r) remove(r.dataset.rmItem);
    });
    $('cartBody').addEventListener('input', e => { const i = e.target; if (i.dataset && i.dataset.setqty) { const l = i.value.replace(/\D/g, '').slice(0, 4); if (l !== i.value) i.value = l; } });
    $('cartBody').addEventListener('change', e => { if (e.target.dataset.setqty) setQty(e.target.dataset.setqty, C.normalizarQtd(e.target.value)); });
    $('cartBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.setqty) { e.preventDefault(); setQty(e.target.dataset.setqty, C.normalizarQtd(e.target.value)); } });
    $('vendedorFechar').addEventListener('click', fecharVendedores);
    $('vendedorModal').addEventListener('click', e => {
      if (e.target === $('vendedorModal')) fecharVendedores();
      const a = e.target.closest && e.target.closest('a.vendedor-btn'); if (a) { const v = VENDEDORES.find(x => x.id === a.id); if (v) { gravarVendedor(v.chave); MED('whatsapp_contact_click', { salesperson_id: v.chave, origin: origemVend, item_id: itemVend || undefined }); } }
    });
    document.addEventListener('keydown', e => {
      const vendAberto = $('vendedorModal').classList.contains('open');
      const sb = $('cartSidebar'), aberto = sb.classList.contains('open'), dock = sb.classList.contains('dock');
      if (e.key === 'Escape') {
        if (vendAberto) { e.preventDefault(); fecharVendedores(); return; }
        if (aberto && (!dock || sb.contains(document.activeElement))) { e.preventDefault(); fecharCarrinho(); return; }
        return;
      }
      if (e.key === 'Tab' && (vendAberto || (aberto && !dock))) {        // foco preso só em diálogo modal de verdade
        const d = vendAberto ? $('vendedorModal') : sb;
        const f = [...d.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select')].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const primeiro = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    });
    // mudou em outra aba/janela → atualiza tudo
    window.addEventListener('storage', e => { if (e.key === 'mr4_carrinho' || e.key === null) { carregar(); desenhar(); avisar(null); } });
    // deixa de caber o painel docado → fecha para não ficar num modo errado
    const m = mq('(min-width:1280px)'); const aoTrocar = () => { if (painelAberto()) fecharCarrinho(true); };
    if (m.addEventListener) m.addEventListener('change', aoTrocar);
    try { if (ehDock() && sessionStorage.getItem('mr4_dock') === '1') abrirPedido(false); } catch (e) {}
  }

  window.Cesta = {
    iniciar, add, changeQty, setQty, remove, limpar, qtdDe, resumo, definirCatalogo,
    abrirPedido, abrirCarrinho: abrirPedido, abrirVendedores, fecharCarrinho,
    delegarAcao, pintar, aoMudar: f => ouvintes.push(f), mensagemPedido,
    VENDEDORES, ZAP, esc
  };
})();
