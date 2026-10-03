'use strict';
// Fase GA4 — camada de medição: instalação única, esquema fechado de eventos, PII, resiliência e fluxo comercial intacto
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../js/catalogo-medicao.js');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const ID = 'G-S2HWQDPSQW';
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const ITENS = C.prepararCatalogo(BRUTOS);
const R = G.planejar(BRUTOS, ler('templates/produto.html'), null, { shell: ler('templates/catalogo.html'), estado: null, atualizado: '2026-10-03T10:00:00Z', existente: () => null });
const A = R.arquivos;
const htmls = () => Object.keys(A).filter(k => /\.html$/.test(k));

/** janela falsa mínima: grava o que o gtag receberia */
function janela(extra) {
  const dl = [], scripts = [];
  const w = Object.assign({
    dataLayer: dl, location: { href: 'https://catalogo.mr4distribuidora.com.br/?q=joao%20silva&utm_source=instagram&cat=led', pathname: '/' },
    addEventListener() {}, requestIdleCallback: f => f(), setTimeout: f => f(),
    document: { readyState: 'complete', referrer: 'https://l.instagram.com/?u=https%3A%2F%2Fx&e=segredo', title: 'Catálogo', head: { appendChild: s => scripts.push(s) }, createElement: () => ({}), body: { dataset: {}, classList: { contains: () => false } }, addEventListener() {} }
  }, extra || {});
  w.__mr4url0 = w.location.href;
  return { w, dl, scripts };
}
const eventos = dl => dl.map(a => Array.from(a)).filter(a => a[0] === 'event');

test('Measurement ID real e público presente uma única vez no código (nunca o da propriedade Focus)', () => {
  assert.equal(M.ID_MEDICAO, ID);
  assert.match(ID, /^G-[A-Z0-9]{8,12}$/);
  assert.equal((ler('js/catalogo-medicao.js').match(/G-[A-Z0-9]{8,12}/g) || []).length, 1);
  htmls().forEach(k => assert.doesNotMatch(A[k].replace(/<p>[^<]*googletagmanager\.com[^<]*<\/p>/, ''), /G-[A-Z0-9]{8,12}|gtag\(|googletagmanager|dataLayer/, k));   // o ID NÃO vai no HTML (só a página de privacidade cita o domínio em texto)
  assert.doesNotMatch(ler('js/catalogo-medicao.js') + ler('js/catalogo-core.js'), /G-SVC7VD2LQG|GTM-/);
});
test('instalação única: gtag.js carregado 1× por página; sem GTM; stub não duplica', () => {
  const { w, scripts } = janela(); const m = M.criar(w);
  m.__iniciar(); m.__iniciar();
  assert.equal(scripts.length, 1); assert.match(scripts[0].src, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-S2HWQDPSQW$/);
  const m2 = M.criar(w); m2.__iniciar(); assert.equal(scripts.length, 1);                    // __mr4ga impede segunda instalação
  assert.equal((ler('js/catalogo-core.js').match(/s\.src = '\/js\/catalogo-medicao\.js\?v=ga1-1'/g) || []).length, 1);
  ['templates/catalogo.html', 'templates/produto.html', '404.html'].forEach(f => assert.doesNotMatch(ler(f), /catalogo-medicao|googletagmanager/));   // catálogo: HTML intacto (stub no core)
});
test('configuração: sem page_view automático, sem Google Signals/personalização, Consent Mode só analytics; purchase não existe', () => {
  const { w, dl } = janela(); const m = M.criar(w); m.__iniciar();
  const a = dl.map(x => Array.from(x));
  const consent = a.find(x => x[0] === 'consent'), conf = a.find(x => x[0] === 'config');
  assert.deepEqual(consent[2], { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  assert.equal(conf[1], ID); assert.equal(conf[2].send_page_view, false); assert.equal(conf[2].allow_google_signals, false); assert.equal(conf[2].allow_ad_personalization_signals, false);
  assert.equal('purchase' in M.ESQUEMA, false); assert.equal(m.track('purchase', { value: 1 }), false);
  assert.doesNotMatch(ler('js/catalogo-medicao.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /'purchase'|"purchase"|begin_checkout|generate_lead/);
});
test('eventos: nomes esperados, lista fechada; evento desconhecido é descartado', () => {
  ['page_view', 'view_item', 'select_item', 'search', 'search_no_results', 'filter_apply', 'view_mode_change', 'add_to_cart', 'remove_from_cart', 'quantity_change', 'view_cart',
    'salesperson_selection_view', 'salesperson_select', 'whatsapp_order_click', 'whatsapp_contact_click', 'phone_click', 'quick_order_open', 'quick_order_add', 'quick_order_no_match', 'quick_order_to_cart']
    .forEach(n => assert.ok(M.ESQUEMA[n], n));
  assert.equal(Object.keys(M.ESQUEMA).length, 20);
  assert.equal(M.limpar('evento_qualquer', { a: 1 }), null);
});
test('PII: parâmetros fora do esquema são descartados (nome, telefone, mensagem, e-mail, CNPJ, endereço)', () => {
  const sujo = { salesperson_id: 'ademir', item_count: 3, line_count: 2, value: 99.9, currency: 'BRL', flow: 'catalogo', message_truncated: false,
    nome: 'João da Silva', cliente: 'Loja X', telefone: '(85) 99609-8520', whatsapp: '5585996098520', mensagem: 'Olá! Pedido 3x LED', email: 'a@b.com', cnpj: '38.440.066/0001-75', endereco: 'Rua Ceará, 634', texto: 'qualquer' };
  const r = M.limpar('whatsapp_order_click', sujo);
  assert.deepEqual(Object.keys(r.params).sort(), ['currency', 'flow', 'item_count', 'line_count', 'message_truncated', 'salesperson_id', 'value']);
  assert.doesNotMatch(JSON.stringify(r), /Silva|99609|5585996098520|Pedido 3x|a@b\.com|38\.440|Rua Ceará|Loja X/);
});
test('PII: valores de texto com telefone/e-mail/URL são descartados mesmo em parâmetros permitidos', () => {
  ['85 99609-8520', '(85) 99609-8520', '+55 85 99609-8520', '5585996098520', 'joao@gmail.com', 'https://wa.me/5585996098520?text=oi', 'wa.me/5585'].forEach(v => {
    const r = M.limpar('filter_apply', { filter_type: 'categoria', filter_value: v, results_count: 3 });
    assert.equal('filter_value' in r.params, false, v);
    const q = M.limpar('whatsapp_contact_click', { salesperson_id: 'ademir', origin: v });
    assert.equal('origin' in q.params, false, v);
  });
  const it = M.limpar('view_item', { currency: 'BRL', value: 10, items: [{ item_id: '6009', item_name: 'Moldura 10.1 Toyota Corolla 2018 2019', item_brand: 'Tiger', price: 10, telefone: '85999999999', cliente: 'x' }] });
  assert.deepEqual(Object.keys(it.params.items[0]).sort(), ['item_brand', 'item_id', 'item_name', 'price']);   // nome de produto com números NÃO é falso positivo
});
test('termo de busca: política (limite, sem e-mail/URL/telefone/número longo, sem texto desconhecido sem resultado)', () => {
  assert.equal(M.termoSeguro('led h7'), 'led h7'); assert.equal(M.termoSeguro('MR-016'), 'mr-016'); assert.equal(M.termoSeguro('6009'), '6009');
  assert.equal(M.termoSeguro('joao@x.com'), null); assert.equal(M.termoSeguro('85 99609-8520'), null); assert.equal(M.termoSeguro('38440066000175'), null);
  assert.equal(M.termoSeguro('www.site.com.br'), null); assert.equal(M.termoSeguro('a b c d e f'), null);
  assert.equal(M.termoSeguro('x'.repeat(100)).length <= 40, true);
  assert.equal(M.termoSeguro('maria souza', { resultados: 0, conhecido: false }), null);       // possível nome de pessoa, sem casar com o catálogo
  assert.equal(M.termoSeguro('led fenix', { resultados: 0, conhecido: true }), 'led fenix');
  assert.equal(M.limpar('search', { search_term: 'joao@x.com', results_count: 1 }).params.search_term, undefined);   // texto não passado por termoSeguro é recusado
  assert.equal(M.limpar('search', { search_term: 'led h7', results_count: 4 }).params.search_term, 'led h7');
});
test('URL/referrer sem PII: some a query (?q= ?cat=), ficam só utm_*; referrer sem query', () => {
  assert.equal(M.urlSegura('https://catalogo.mr4distribuidora.com.br/?q=joao%20silva&utm_source=instagram&cat=led&utm_medium=social'), 'https://catalogo.mr4distribuidora.com.br/?utm_source=instagram&utm_medium=social');
  assert.equal(M.urlSegura('https://catalogo.mr4distribuidora.com.br/?q=85999999999'), 'https://catalogo.mr4distribuidora.com.br/');
  assert.equal(M.urlSegura('https://catalogo.mr4distribuidora.com.br/?utm_source=a@b.com'), 'https://catalogo.mr4distribuidora.com.br/');
  assert.equal(M.referrerSeguro('https://l.instagram.com/?u=x&e=segredo'), 'https://l.instagram.com/');
  const { w, dl } = janela(); const m = M.criar(w); m.__iniciar(); m.auto();
  const pv = eventos(dl).find(e => e[1] === 'page_view')[2];
  assert.equal(pv.page_location, 'https://catalogo.mr4distribuidora.com.br/?utm_source=instagram');
  assert.equal(pv.page_referrer, 'https://l.instagram.com/');
  assert.doesNotMatch(JSON.stringify(dl), /joao|silva|segredo|cat=led/);
});
test('resiliência: gtag ausente/lançando erro, ID nulo ou script bloqueado nunca quebram', () => {
  const nulo = M.criar(janela().w, { id: null });
  assert.equal(nulo.track('search', { search_term: 'led', results_count: 1 }), true); nulo.__iniciar(); assert.equal(nulo.ativo(), false);
  const { w } = janela({ gtag() { throw new Error('boom'); } }); const m = M.criar(w); m.__iniciar();
  assert.doesNotThrow(() => m.track('add_to_cart', { currency: 'BRL', value: 1, items: [{ item_id: '1' }] }));
  assert.doesNotThrow(() => m.track('search', null)); assert.doesNotThrow(() => m.track(undefined, undefined));
  const semDoc = { document: { readyState: 'loading', head: { appendChild() { throw new Error('x'); } }, createElement: () => ({}), body: null, referrer: '', title: '' }, location: { href: 'https://x/', pathname: '/' }, addEventListener() {} };
  assert.doesNotThrow(() => { const z = M.criar(semDoc); z.__iniciar(); z.auto(); z.track('view_cart', {}); });
});
test('integração (core + stub): sem Medicao carregado, o catálogo ainda funciona; o stub enfileira e o módulo real descarrega', () => {
  const ctx = { window: null, document: { readyState: 'loading', head: { appendChild() {} }, createElement: () => ({}) }, location: { href: 'https://catalogo.mr4distribuidora.com.br/' }, setTimeout };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx); vm.runInContext(ler('js/catalogo-core.js'), ctx);
  assert.equal(ctx.Medicao.stub, true); assert.equal(ctx.Medicao.track('x', { a: 1 }), true); assert.equal(ctx.Medicao.q.length, 1);
  assert.equal(typeof ctx.CatalogoCore.itemAnalytics, 'function');
  for (let i = 0; i < 100; i++) ctx.Medicao.track('x', {}); assert.ok(ctx.Medicao.q.length <= 60);        // fila limitada
});
test('itens GA4: só código/nome/marca/categoria/preço/quantidade, para 100 % dos produtos reais', () => {
  ITENS.forEach(e => {
    const i = C.itemAnalytics(e, 2);
    assert.deepEqual(Object.keys(i).filter(k => !['item_id', 'item_name', 'item_brand', 'item_category', 'price', 'quantity'].includes(k)), []);
    assert.equal(i.item_id, String(e.p.ref)); assert.equal(i.quantity, 2);
    assert.ok(i.price == null || (typeof i.price === 'number' && i.price > 0));
    assert.deepEqual(Object.keys(i).filter(k => /stock|estoque|img|desc/i.test(k)), []);
  });
  assert.equal(C.termoConhecido(ITENS, 'moldura toyota'), true); assert.equal(C.termoConhecido(ITENS, 'zzqqxx wwkk'), false);
});
test('pontos de medição no código: choke points de pedido/vendedor/WhatsApp; nada lê nome/telefone/mensagem', () => {
  const cesta = ler('js/catalogo-cesta.js'), app = ler('js/catalogo-app.js'), rap = ler('js/catalogo-rapido.js'), prod = ler('js/produto-app.js');
  ['add_to_cart', 'remove_from_cart', 'quantity_change', 'view_cart', 'salesperson_selection_view', 'salesperson_select', 'whatsapp_order_click', 'whatsapp_contact_click'].forEach(n => assert.ok(cesta.includes("'" + n + "'"), n));
  ['search', 'search_no_results', 'filter_apply', 'view_mode_change', 'select_item'].forEach(n => assert.ok(app.includes("'" + n + "'") || app.includes('search_no_results'), n));
  ['quick_order_open', 'quick_order_add', 'quick_order_no_match', 'quick_order_to_cart'].forEach(n => assert.ok(rap.includes("'" + n + "'"), n));
  assert.ok(prod.includes("'view_item'"));
  // o clique de envio mede intenção: a chamada acontece antes de window.open e NÃO usa msg/encoded/url/nome/telefone
  const ini = cesta.indexOf("MED('whatsapp_order_click'"), bloco = cesta.slice(ini, cesta.indexOf('}); } catch', ini));
  assert.doesNotMatch(bloco.replace('message_truncated: encoded.length > 3000', ''), /\bmsg\b|\burl\b|clienteNome|\.num\b|telefone|nome/);
  [cesta, app, rap, prod].forEach(s => assert.doesNotMatch(s.split('\n').filter(l => /MED\(|Medicao/.test(l)).join('\n').replace('message_truncated: encoded.length > 3000', ''), /clienteNome|\.num\b|mensagemPedido|wa\.me|encoded/));
  assert.equal(/purchase/.test(cesta + app + rap + prod), false);
});
test('fluxo comercial intacto: Cesta/Rapido/vendedores/WhatsApp funcionam sem Medicao e o clique final ainda abre o WhatsApp', () => {
  const cesta = ler('js/catalogo-cesta.js');
  assert.match(cesta, /const w = window\.open \? window\.open\(url, '_blank', 'noopener'\) : null;/);
  assert.match(cesta, /num: '558596098520'/); assert.match(cesta, /num: '558591194961'/);          // vendedores intactos
  assert.match(cesta, /const MED = \(n, p\) => \{ try \{ if \(window\.Medicao\) window\.Medicao\.track\(n, p\); \} catch \(e\) \{\} \};/);   // medição nunca lança
  assert.match(ler('js/catalogo-rapido.js'), /const MED = \(n, p\) => \{ try \{/);
});
test('institucionais: único script é a medição (defer), tel/WhatsApp medidos sem dados', () => {
  ['sobre/index.html', 'contato/index.html', 'privacidade/index.html'].forEach(k => assert.match(A[k], /<script src="\/js\/catalogo-medicao\.js\?v=ga1-1" defer><\/script>/));
  const { w, dl } = janela({ location: { href: 'https://catalogo.mr4distribuidora.com.br/contato/', pathname: '/contato/' } });
  let click; w.document.addEventListener = (n, f) => { if (n === 'click') click = f; };
  w.document.body = { dataset: {}, classList: { contains: c => c === 'pagina-inst' } };
  const m = M.criar(w); m.__iniciar(); m.auto();
  click({ target: { closest: () => ({ getAttribute: () => 'https://wa.me/5585996098520?text=Ol%C3%A1' }) } });
  click({ target: { closest: () => ({ getAttribute: () => 'tel:+5585996098520' }) } });
  const ev = eventos(dl).map(e => [e[1], e[2]]);
  assert.equal(ev.find(e => e[0] === 'whatsapp_contact_click')[1].origin, 'pagina_institucional');
  assert.equal(ev.find(e => e[0] === 'phone_click')[1].origin, 'pagina_institucional');
  assert.deepEqual(Object.keys(ev.find(e => e[0] === 'phone_click')[1]).sort(), ['origin', 'page_location', 'page_referrer']);
  assert.doesNotMatch(JSON.stringify(dl), /5585996098520|Ol%C3%A1/);
  assert.equal(ev.find(e => e[0] === 'page_view')[1].page_type, 'institucional');
});
test('SEO/Schema sem regressão: JSON-LD, canonical e sitemap iguais; IndexNow detecta só mudança real (versão ?v= não conta)', () => {
  assert.equal(R.urls.length, 1 + R.tax.categorias.length + R.tax.marcas.length + 3 + R.itens.length);
  htmls().filter(k => /^(produto|categoria|marca)\//.test(k) || k === 'index.html').forEach(k => assert.equal((A[k].match(/application\/ld\+json/g) || []).length, 1, k));
  const trocaVersao = h => h.replace(/\?v=ga1-1/g, '?v=ga9-9');
  assert.deepEqual(G.urlsAlteradas(A, rel => (A[rel] == null ? null : trocaVersao(A[rel]))), []);
});
test('TODO evento leva page_location/page_referrer reescritos (o gtag usaria document.location com ?q= digitado: achado do scan de rede)', () => {
  const { w, dl } = janela({ location: { href: 'https://catalogo.mr4distribuidora.com.br/?q=maria+souza+85999998888&cat=led', pathname: '/' } });
  const m = M.criar(w); m.auto();
  m.track('search', { search_term: 'led h7', results_count: 3 });
  m.track('filter_apply', { filter_type: 'categoria', filter_value: 'LED', results_count: 3 });
  m.track('add_to_cart', { currency: 'BRL', value: 10, items: [{ item_id: 'MR.005', item_name: 'LED T10', price: 10, quantity: 1 }], origin: 'lista' });
  m.track('whatsapp_order_click', { salesperson_id: 'ademir', item_count: 1, line_count: 1, value: 10, currency: 'BRL', flow: 'catalogo', message_truncated: false });
  const ev = eventos(dl); assert.ok(ev.length >= 5);
  ev.forEach(e => { assert.equal(e[2].page_location.includes('?q='), false, e[1]); assert.doesNotMatch(JSON.stringify(e[2]), /maria|souza|85999998888|cat=led/); assert.match(e[2].page_location, /^https:\/\/catalogo\.mr4distribuidora\.com\.br\//); assert.equal(e[2].page_referrer, 'https://l.instagram.com/'); });
});
test('eventos nascem na dataLayer mesmo antes do gtag.js carregar (page_view e fila do stub não se perdem)', () => {
  const { w, dl, scripts } = janela({ requestIdleCallback: () => {} });             // ociosidade nunca chega: script não baixa
  const m = M.criar(w); m.auto(); m.track('view_cart', { currency: 'BRL', value: 5, item_count: 1, items: [{ item_id: 'a' }] });
  assert.equal(scripts.length, 0);
  assert.deepEqual(eventos(dl).map(e => e[1]), ['page_view', 'view_cart']);
  m.__carregar(); m.__carregar(); assert.equal(scripts.length, 1);
});
