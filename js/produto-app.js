/* MR4 Catálogo — página individual do produto (e fallback do 404.html).
 * O HTML estático já traz nome, código, marca, categoria, foto e descrição (para crawlers e sem JS);
 * aqui entram preço e estoque (do JSON atual), quantidade/Adicionar (estado compartilhado com o pedido), WhatsApp,
 * compartilhar, copiar código/link e relacionados. */
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
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ───────── ambiente de compartilhamento/cópia (injetado no núcleo, testável) ───────── */
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

  /* ───────── bloco de compra ───────── */
  function htmlCompra(it) {
    const p = it.p;
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 10 ? `${p.stock} em estoque` : p.stock > 0 ? `Últimas ${p.stock} unid.` : 'Sem estoque';
    return `<div class="preco-linha">
        <div><div class="preco-lbl">Preço unitário (atacado)</div><div class="preco-grande">${esc(p.price)}</div></div>
        <span class="estoque-chip ${sc}">${sl}</span>
      </div>
      ${C.htmlAcao(p, Cesta.qtdDe(p.id), 'acao--grande')}
      <p class="resumo-pedido" id="pResumo" aria-live="polite"></p>
      <div class="acoes-sec3">
        <button type="button" class="btn-interesse" id="pInteresse">${Cesta.ZAP} Tenho interesse neste produto</button>
        <button type="button" class="btn-sec" id="pShare">Compartilhar produto</button>
        <button type="button" class="btn-sec" id="pCopy">Copiar link</button>
      </div>
      <div class="copia-manual" id="pManual"><input id="pManualUrl" readonly aria-label="Link do produto" value=""></div>`;
  }
  function pintarResumo(it) {
    const el = $('pResumo'); if (!el) return;
    const n = Cesta.qtdDe(it.p.id);
    if (!n) { el.innerHTML = ''; return; }
    const cent = C.precoCentavos(it.p.price);
    el.innerHTML = `No pedido: <strong>${n} un.</strong>${cent == null ? '' : ' · ' + C.formatarCentavos(cent * n)} <button type="button" class="ver-pedido" id="pVerPedido">Ver pedido</button>`;
    $('pVerPedido').addEventListener('click', () => Cesta.abrirPedido());
  }
  const qtdEscolhida = () => C.normalizarQtd((($('pCompra') || document).querySelector('.qi') || {}).value);

  function ligarCompra(it, origem) {
    const url = origem + it.url;
    pintarResumo(it);
    $('pInteresse').addEventListener('click', () => {
      Cesta.abrirVendedores(encodeURIComponent(C.mensagemWhatsProduto(it.p, qtdEscolhida(), url)), 'produto_interesse', String(it.p.ref));
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
    const cod = $('pCopiarCod');
    if (cod) cod.addEventListener('click', async () => {
      const r = await C.copiarLink(ambienteCompartilhar(), String(it.p.ref));
      const antes = 'Copiar código';
      cod.textContent = r.ok ? 'Código copiado ✓' : 'Copie manualmente';
      aviso(r.ok ? 'Código copiado' : 'Não foi possível copiar: selecione o código');
      setTimeout(() => { cod.textContent = antes; }, 1800);
    });
  }

  /* ───────── relacionados (mesma regra; mesmo componente de compra) ───────── */
  function htmlRelacionados(lista) {
    if (!lista.length) return '';
    return `<section class="relacionados" aria-labelledby="relTit"><h2 id="relTit">Produtos relacionados</h2><div class="rel-grid">` +
      lista.map(e => C.htmlCard(e, { qtd: Cesta.qtdDe(e.p.id) })).join('') + `</div></section>`;
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
    $('pFalar').addEventListener('click', () => Cesta.abrirVendedores(null, 'produto_indisponivel'));
    const bc = $('bc'); if (bc) bc.hidden = true;
  }
  function falhaDados() {
    const c = $('pCompra');
    if (c) c.innerHTML = `<p class="produto-carregando">Não foi possível carregar preço e estoque agora.</p><div class="produto-acoes"><button type="button" class="btn-modal-cart" id="pRetry">Tentar novamente</button><button type="button" class="btn-interesse" id="pFalar">Falar com vendedor</button></div>`;
    else indisponivel('', '', false);
    const r = $('pRetry'); if (r) r.addEventListener('click', () => location.reload());
    const f = $('pFalar'); if (f) f.addEventListener('click', () => Cesta.abrirVendedores(null, 'produto_indisponivel'));
  }

  /* ───────── principal ───────── */
  async function principal() {
    document.body.classList.add('pagina-produto');
    Cesta.iniciar();
    const ph = $('searchInput'); if (ph && window.matchMedia('(max-width:640px)').matches) ph.placeholder = 'Buscar produto…';
    const bt = $('btnContato'); if (bt) bt.addEventListener('click', () => Cesta.abrirVendedores(null, 'header'));
    const ra = $('rodapeAtend'); if (ra) ra.addEventListener('click', () => Cesta.abrirVendedores(null, 'rodape'));
    const codigoUrl = (location.pathname.match(/\/produto\/([^/]+)/i) || [])[1];
    const codigo = codigoUrl ? decodeURIComponent(codigoUrl).split('--').pop() : '';
    const nomeEstatico = ($('pNome') || {}).textContent || '';
    const refEstatica = ($('pRef') || {}).textContent || '';
    let itens;
    try {
      const res = await fetch('/data/produtos.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('http ' + res.status);
      const dados = await res.json();
      itens = C.prepararCatalogo(dados.produtos || []);
      const sb = $('syncBadge');
      if (sb && dados.atualizado) sb.textContent = 'Preços e estoque atualizados em ' + new Date(dados.atualizado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
    } catch (e) { falhaDados(); return; }
    Cesta.definirCatalogo(itens);                                   // preço/estoque do pedido vêm deste JSON

    const r = C.resolverProduto(itens, location.pathname);
    if (!r) { indisponivel(ehPagina404 ? '' : nomeEstatico, refEstatica || codigo, !!codigoUrl); return; }
    const it = r.item;
    if (ehPagina404) { location.replace(it.url + location.search + location.hash); return; }
    if (!r.canonico) history.replaceState(null, '', it.url + location.search + location.hash);

    document.title = C.tituloProduto(it, itens);
    const bc = $('bc'); if (bc) bc.outerHTML = C.htmlBreadcrumb(it).replace('<nav ', '<nav id="bc" ');
    $('produtoArtigo').innerHTML = C.htmlProdutoInfo(it, true);
    $('pCompra').outerHTML = `<div class="produto-compra" id="pCompra" data-estado="pronto">${htmlCompra(it)}</div>`;
    ligarCompra(it, location.origin);
    Cesta.delegarAcao($('pCompra'), () => it.p, 'produto');
    try { const ia = C.itemAnalytics(it); if (window.Medicao && ia) window.Medicao.track('view_item', { currency: 'BRL', value: ia.price, items: [ia] }); } catch (e) {}
    const rel = $('relacionados');
    if (rel) {
      rel.innerHTML = htmlRelacionados(C.relacionados(itens, it, 4));
      const porId = new Map(itens.map(e => [String(e.p.id), e.p]));
      Cesta.delegarAcao(rel, id => porId.get(String(id)), 'relacionados');
    }
    Cesta.aoMudar(id => { Cesta.pintar(id); pintarResumo(it); });   // card ↔ pedido ↔ página: um só estado
  }
  principal();
})();
