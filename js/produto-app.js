/* MR4 Catálogo — página individual do produto (e fallback do 404.html).
 * O HTML estático já traz nome, código, marca, categoria, foto e descrição (para crawlers e sem JS);
 * aqui entram os dados que mudam a cada sync (preço e estoque, do JSON atual), pedido, WhatsApp, compartilhar e relacionados. */
(function () {
  'use strict';
  const C = window.CatalogoCore, Cesta = window.Cesta;
  const $ = id => document.getElementById(id);
  const esc = C.esc;
  const ehPagina404 = document.body.dataset.pagina === '404';
  let toastTimer = null;

  function aviso(texto) {
    const el = $('aviso'); if (!el) return;
    el.textContent = texto; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /* ───────── ambiente de compartilhamento (injetado no núcleo testável) ───────── */
  function ambienteCompartilhar() {
    return {
      share: typeof navigator.share === 'function' ? d => navigator.share(d) : null,
      clipboard: navigator.clipboard && navigator.clipboard.writeText ? t => navigator.clipboard.writeText(t) : null,
      exec: t => {
        const ta = document.createElement('textarea');
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta); return ok;
      }
    };
  }

  /* ───────── bloco de compra (preço, estoque, quantidade, ações) ───────── */
  function htmlCompra(it) {
    const p = it.p;
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 10 ? `${p.stock} em estoque` : p.stock > 0 ? `Últimas ${p.stock} unid.` : 'Sem estoque';
    return `<div class="preco-bloco">
        <div><div class="modal-price-lbl">Preço unitário (atacado)</div><div class="modal-price-val">${esc(p.price)}</div></div>
        <span class="modal-stock-badge ${sc}">${sl}</span>
      </div>
      <div class="produto-acoes">
        <div class="linha-add">
          <div class="compra-qtd">
            <label for="pQtd">Quantidade</label>
            <button type="button" class="qty-btn" id="pMenos" aria-label="Diminuir quantidade">−</button>
            <input class="qty-val" id="pQtd" type="number" min="1" value="1" inputmode="numeric">
            <button type="button" class="qty-btn" id="pMais" aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="btn-modal-cart" id="pAdd"></button>
        </div>
        <button type="button" class="btn-interesse" id="pInteresse">${Cesta.ZAP} Tenho interesse neste produto</button>
        <div class="acoes-sec">
          <button type="button" class="btn-sec" id="pShare">Compartilhar produto</button>
          <button type="button" class="btn-sec" id="pCopy">Copiar link</button>
        </div>
        <div class="copia-manual" id="pManual"><input id="pManualUrl" readonly aria-label="Link do produto" value=""></div>
        <button type="button" class="ver-pedido" id="pVerPedido" hidden></button>
      </div>`;
  }
  const qtdEscolhida = () => Math.max(1, parseInt(($('pQtd') || {}).value, 10) || 1);

  function pintarAdd(it) {
    const btn = $('pAdd'); if (!btn) return;
    const n = Cesta.qtdDe(it.p.id);
    btn.className = 'btn-modal-cart' + (n ? ' added' : '');
    btn.innerHTML = n
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> No pedido (${n})<span class="t-mais"> · adicionar mais</span>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Adicionar<span class="t-mais"> ao pedido</span>`;
    const ver = $('pVerPedido');
    if (ver) { ver.hidden = !n; ver.textContent = `Ver meu pedido (${n} un. deste produto)`; }
  }

  function ligarCompra(it, origem) {
    const url = origem + it.url;
    pintarAdd(it);
    Cesta.aoMudar(id => { if (String(id) === String(it.p.id)) pintarAdd(it); });
    $('pMenos').addEventListener('click', () => { $('pQtd').value = Math.max(1, qtdEscolhida() - 1); });
    $('pMais').addEventListener('click', () => { $('pQtd').value = qtdEscolhida() + 1; });
    $('pQtd').addEventListener('change', () => { $('pQtd').value = qtdEscolhida(); });
    $('pAdd').addEventListener('click', () => { const q = qtdEscolhida(); Cesta.add(it.p, q); aviso(`Adicionado ao pedido: ${q} un.`); });
    $('pVerPedido').addEventListener('click', () => Cesta.abrirCarrinho());
    $('pInteresse').addEventListener('click', () => {
      Cesta.abrirVendedores(encodeURIComponent(C.mensagemWhatsProduto(it.p, qtdEscolhida(), url)));
    });
    const manual = () => { $('pManual').classList.add('visivel'); const i = $('pManualUrl'); i.value = url; i.focus(); i.select(); };
    $('pShare').addEventListener('click', async () => {
      const r = await C.compartilhar(ambienteCompartilhar(), { title: it.p.name + ' — MR4 Distribuidora', text: `${it.p.name} (Código ${it.p.ref})`, url });
      if (r.via === 'clipboard' || r.via === 'exec') aviso('Link copiado');
      else if (r.via === 'manual') { aviso('Copie o link abaixo'); manual(); }
    });
    $('pCopy').addEventListener('click', async () => {
      const r = await C.copiarLink(ambienteCompartilhar(), url);
      if (r.ok) aviso('Link copiado'); else { aviso('Copie o link abaixo'); manual(); }
    });
  }

  /* ───────── relacionados ───────── */
  function htmlRelacionados(lista) {
    if (!lista.length) return '';
    return `<section class="relacionados" aria-labelledby="relTit"><h2 id="relTit">Produtos relacionados</h2><div class="rel-grid">` + lista.map(e => {
      const p = e.p;
      return `<article class="product-card">
        ${p.img ? `<div class="card-img"><img src="${esc(p.img)}" alt="" loading="lazy" decoding="async"></div>` : `<div class="img-placeholder" aria-hidden="true">${C.PLACEHOLDER_SVG}</div>`}
        <div class="card-body">
          <div class="card-top"><div class="card-ref">${esc(p.ref)}</div>${e.marca ? `<div class="card-brand-pill">${esc(e.marca)}</div>` : ''}</div>
          <h3 class="card-name"><a class="card-open" href="${esc(e.url)}">${esc(p.name)}</a></h3>
          <div class="card-footer"><div><span class="card-price-label">Preço unit.</span><span class="card-price">${esc(p.price)}</span></div></div>
        </div></article>`;
    }).join('') + `</div></section>`;
  }

  /* ───────── estados ───────── */
  function indisponivel(nomeConhecido, codigo, ehProduto) {
    const alvo = $('produtoArtigo');
    alvo.className = '';
    if (!ehProduto) {
      alvo.innerHTML = `<div class="indisponivel"><h1>Página não encontrada</h1><p>O endereço que você abriu não existe neste catálogo.</p><div class="acoes-sec"><a class="btn-sec" href="/">Voltar ao catálogo</a></div></div>`;
      return;
    }
    alvo.innerHTML = `<div class="indisponivel">
      <h1>Produto não disponível no catálogo no momento</h1>
      <p>${nomeConhecido ? `<strong>${esc(nomeConhecido)}</strong><br>` : ''}${codigo ? `Código ${esc(codigo)} — ` : ''}este produto não está mais listado (pode estar sem estoque). Busque outro produto ou fale com um vendedor.</p>
      <form action="/" method="get" role="search"><label class="sr-only" for="qIndisp">Buscar no catálogo</label><input id="qIndisp" type="search" name="q" value="${esc(codigo || '')}" placeholder="Buscar no catálogo"><button type="submit" class="btn-modal-cart" style="width:auto;padding:0 20px">Buscar</button></form>
      <div class="acoes-sec"><a class="btn-sec" href="/?r=1">Voltar ao catálogo</a><button type="button" class="btn-interesse" id="pFalar">Falar com vendedor</button></div>
    </div>`;
    $('pFalar').addEventListener('click', () => Cesta.abrirVendedores());
    const bc = $('bc'); if (bc) bc.hidden = true;
  }
  function falhaDados() {
    const c = $('pCompra');
    if (c) c.innerHTML = `<p class="produto-carregando">Não foi possível carregar preço e estoque agora.</p><div class="produto-acoes"><button type="button" class="btn-modal-cart" id="pRetry">Tentar novamente</button><button type="button" class="btn-interesse" id="pFalar">Falar com vendedor</button></div>`;
    else indisponivel('', '', false);
    const r = $('pRetry'); if (r) r.addEventListener('click', () => location.reload());
    const f = $('pFalar'); if (f) f.addEventListener('click', () => Cesta.abrirVendedores());
  }

  /* ───────── principal ───────── */
  async function principal() {
    Cesta.iniciar();
    const fab = $('cartFab'), hr = document.querySelector('.header-right');
    if (fab && hr) { hr.insertBefore(fab, hr.firstChild); fab.classList.add('cart-fab-inline'); }
    const bt = $('btnContato'); if (bt) bt.addEventListener('click', () => Cesta.abrirVendedores());
    const codigoUrl = (location.pathname.match(/\/produto\/([^/]+)/i) || [])[1];
    const codigo = codigoUrl ? decodeURIComponent(codigoUrl).split('--').pop() : '';
    const nomeEstatico = ($('pNome') || {}).textContent || '';
    const refEstatica = (((document.querySelector('.produto-ref') || {}).textContent) || '').replace(/^Código\s+/, '');
    let itens;
    try {
      const res = await fetch('/data/produtos.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('http ' + res.status);
      itens = C.prepararCatalogo((await res.json()).produtos || []);
    } catch (e) { falhaDados(); return; }

    const r = C.resolverProduto(itens, location.pathname);
    if (!r) { indisponivel(ehPagina404 ? '' : nomeEstatico, refEstatica || codigo, !!codigoUrl); return; }
    const it = r.item;
    if (ehPagina404) { location.replace(it.url + location.search + location.hash); return; }
    if (!r.canonico) history.replaceState(null, '', it.url + location.search + location.hash);

    document.title = it.p.name + ' — MR4 Distribuidora';
    const bc = $('bc'); if (bc) bc.outerHTML = C.htmlBreadcrumb(it).replace('<nav ', '<nav id="bc" ');
    $('produtoArtigo').innerHTML = C.htmlProdutoInfo(it);
    $('pCompra').outerHTML = `<div class="produto-compra" id="pCompra" data-estado="pronto">${htmlCompra(it)}</div>`;
    ligarCompra(it, location.origin);
    const rel = $('relacionados');
    if (rel) rel.innerHTML = htmlRelacionados(C.relacionados(itens, it, 4));
  }
  principal();
})();
