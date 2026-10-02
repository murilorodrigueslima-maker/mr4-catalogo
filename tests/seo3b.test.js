'use strict';
// SEO Fase 3B — Product Offer (estratégia C: Offer estático, regenerado só quando preço/disponibilidade semântica mudam)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');
const LD = require('../scripts/jsonld.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const ITENS = C.prepararCatalogo(BRUTOS);
const ORI = 'https://catalogo.mr4distribuidora.com.br';
const gerar = (b, estado, atualizado, man) => G.planejar(b, TPL, man || null, { shell: SHELL, estado: estado || null, atualizado: atualizado || '2026-10-02T10:00:00Z', existente: () => null });
const R = gerar(BRUTOS), A = R.arquivos;
const rel = e => 'produto/' + e.url.replace('/produto/', '') + 'index.html';
const scripts = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
const produto = h => { const s = scripts(h); assert.equal(s.length, 1); return JSON.parse(s[0])['@graph'].find(n => n['@type'] === 'Product'); };
const mk = (n, o) => Array.from({ length: n }, (_, i) => Object.assign({ id: String(i + 1), ref: 'R' + (i + 1), name: 'Produto ' + (i + 1), category: 'Cat A', brand: 'Marca A', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o && o(i)));

test('fonte única do preço: card, página, Pedido Rápido e pedido leem p.price do produtos.json; o Offer usa a mesma função do pedido', () => {
  assert.match(ler('js/catalogo-core.js'), /<span class="card-preco">\$\{esc\(p\.price\)\}/);
  assert.match(ler('js/produto-app.js'), /preco-grande">\$\{esc\(p\.price\)\}/);
  assert.match(ler('js/catalogo-rapido.js'), /rq-preco">\$\{esc\(p\.price\)\}/);
  assert.match(ler('js/catalogo-core.js'), /const precoCent = precoCentavos\(atual\.p\.price\)/);          // pedido: preço ATUAL do feed
  const jl = ler('scripts/jsonld.js');
  assert.match(jl, /Core\.precoCentavos\(p && p\.price\)/);
  assert.doesNotMatch(jl, /carrinho|localStorage|mr4_/);                                                 // nunca o preço salvo no carrinho
  assert.doesNotMatch(ler('scripts/gerar-paginas.js'), /parseFloat|Number\(.*price|toFixed/);            // sem 2ª regra de preço nem ponto flutuante
});
test('auditoria do feed: preços válidos, estoque > 0, sem zero/ausente/inválido hoje', () => {
  assert.ok(BRUTOS.every(p => p.stock > 0));                                                              // o sync só grava estoque > 0
  assert.match(ler('scripts/sync-produtos.js'), /todos\.filter\(p => p\.stock > 0\)/);
  const cls = BRUTOS.map(p => C.precoCentavos(p.price));
  assert.equal(cls.filter(c => c == null).length, 0); assert.equal(cls.filter(c => c === 0).length, 0);
  assert.match(ler('scripts/sync-produtos.js'), /return 'Sob consulta'/);                                // zero/ausente vira "Sob consulta" (sem preço)
});
test('conversão de preço: centavos inteiros → string decimal exata', () => {
  const casos = [['R$ 149,90', '149.90'], ['R$ 100,00', '100.00'], ['R$ 0,01', '0.01'], ['R$ 0,50', '0.50'], ['R$ 10,5', '10.50'], ['R$ 1.234,56', '1234.56'], ['R$ 2,00', '2.00'], ['2,5', '2.50'], ['R$ 1.450,00', '1450.00'], ['R$ 19,99', '19.99'], ['R$ 0,10', '0.10']];
  casos.forEach(([ent, sai]) => { const c = LD.precoCentavosValido({ price: ent }); assert.equal(LD.precoDecimal(c), sai, ent); });
  assert.equal(LD.precoDecimal(14990), '149.90'); assert.equal(LD.precoDecimal(1), '0.01');
  BRUTOS.forEach(p => { const c = C.precoCentavos(p.price); assert.equal(LD.precoDecimal(c), (c / 100).toFixed(2), p.price); assert.match(LD.precoDecimal(c), /^\d+\.\d{2}$/); });   // sem erro de ponto flutuante em nenhum preço real
});
test('preço zero, ausente, "Sob consulta" ou inválido: sem Offer (Product permanece)', () => {
  ['R$ 0,00', '0', '', null, undefined, 'Sob consulta', 'abc', 'R$ -5,00', '1,2,3', 'R$', 'R$ 1.23,4', '12,345'].forEach(pr => assert.equal(LD.precoCentavosValido({ price: pr }), null, String(pr)));
  const b = mk(4, i => ({ price: ['R$ 0,00', '', 'Sob consulta', 'R$ 5,00'][i] }));
  const it = C.prepararCatalogo(b), r = gerar(b).arquivos;
  [0, 1, 2].forEach(i => { const p = produto(r[rel(it[i])]); assert.equal('offers' in p, false); assert.equal(p['@type'], 'Product'); });
  assert.equal(produto(r[rel(it[3])]).offers.price, '5.00');
  assert.doesNotMatch(Object.keys(r).filter(k => /^produto\//.test(k)).map(k => r[k]).filter(h => /"name":"Produto [123]"/.test(h)).join(''), /"price"/);
});
test('Offer: forma exata, BRL, URL canônica, seller por @id; sem validade/condição/frete/devolução', () => {
  let com = 0, sem = 0;
  ITENS.forEach(e => {
    const p = produto(A[rel(e)]);
    if (!p.offers) { sem++; return; }
    com++;
    assert.deepEqual(Object.keys(p.offers), ['@type', 'url', 'priceCurrency', 'price', 'availability', 'seller']);
    assert.equal(p.offers['@type'], 'Offer'); assert.equal(p.offers.priceCurrency, 'BRL');
    assert.equal(p.offers.url, ORI + e.url); assert.doesNotMatch(p.offers.url, /[?#]/);
    assert.deepEqual(p.offers.seller, { '@type': 'Organization', '@id': ORI + '/#organization', name: 'MR4 Distribuidora' });
    assert.equal(typeof p.offers.price, 'string');
  });
  assert.equal(com, ITENS.filter(e => LD.precoCentavosValido(e.p)).length); assert.equal(sem, ITENS.length - com);
  const txt = ITENS.map(e => scripts(A[rel(e)])[0]).join('');
  assert.doesNotMatch(txt, /priceValidUntil|itemCondition|NewCondition|hasMerchantReturnPolicy|shippingDetails|PreOrder|BackOrder|LimitedAvailability|aggregateRating|"review"|gtin|mpn/);
  ITENS.forEach(e => assert.equal(scripts(A[rel(e)]).length, 1));                                         // um só script
});
test('matriz de availability: feed (estoque > 0) → InStock; 0 → OutOfStock; desconhecido → omitida', () => {
  assert.equal(LD.disponibilidade(1), 'https://schema.org/InStock'); assert.equal(LD.disponibilidade(2185), 'https://schema.org/InStock');
  assert.equal(LD.disponibilidade(0), 'https://schema.org/OutOfStock'); assert.equal(LD.disponibilidade(-3), 'https://schema.org/OutOfStock');
  [null, undefined, '', 'x', NaN].forEach(v => assert.equal(LD.disponibilidade(v), null));
  ITENS.forEach(e => assert.equal(produto(A[rel(e)]).offers.availability, 'https://schema.org/InStock'));
  const b = mk(3, i => ({ stock: [4, 0, null][i] })), it = C.prepararCatalogo(b), r = gerar(b).arquivos;
  assert.equal(produto(r[rel(it[1])]).offers.availability, 'https://schema.org/OutOfStock');            // estoque 0 no feed ≠ removido: Product e Offer ficam
  assert.equal('availability' in produto(r[rel(it[2])]).offers, false);
});
test('o NÚMERO do estoque nunca aparece no JSON-LD', () => {
  const b = mk(1, () => ({ stock: 4321, price: 'R$ 7,00' })), it = C.prepararCatalogo(b);
  assert.doesNotMatch(gerar(b).arquivos[rel(it[0])], /4321/);
});
test('REGENERAÇÃO: preço igual NÃO reescreve; preço novo reescreve só a página do produto; estoque 10→9 não reescreve', () => {
  const base = mk(12, i => ({ price: 'R$ 149,90', stock: 10 }));
  const r0 = gerar(base, null, '2026-10-01T08:00:00Z'), man = JSON.parse(r0.arquivos['produto/manifest.json']);
  const it = C.prepararCatalogo(base);
  const dif = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]);
  const r1 = gerar(base, r0.estado, '2026-10-02T09:00:00Z', man);                                          // nada mudou
  assert.deepEqual(dif(r0.arquivos, r1.arquivos), []);
  const est = base.map(p => Object.assign({}, p, { stock: 9 }));                                           // 10 → 9: continua InStock
  const r2 = gerar(est, r0.estado, '2026-10-03T09:00:00Z', man);
  assert.deepEqual(dif(r0.arquivos, r2.arquivos), []);                                                     // nem sitemap, nem estado
  assert.equal(r2.arquivos['data/seo-estado.json'], r0.arquivos['data/seo-estado.json']);
  const mesmo = base.map(p => Object.assign({}, p, { price: 'R$ 149,90' }));
  assert.deepEqual(dif(r0.arquivos, gerar(mesmo, r0.estado, '2026-10-04T09:00:00Z', man).arquivos), []);   // 149,90 → 149,90
  const novo = base.map((p, i) => (i === 3 ? Object.assign({}, p, { price: 'R$ 159,90' }) : p));         // 149,90 → 159,90 em 1 produto
  const r3 = gerar(novo, r0.estado, '2026-10-05T09:00:00Z', man);
  assert.deepEqual(dif(r0.arquivos, r3.arquivos).sort(), [rel(it[3]), 'data/seo-estado.json', 'sitemap.xml'].sort());
  assert.equal(produto(r3.arquivos[rel(it[3])]).offers.price, '159.90');
  const lm = [...r3.arquivos['sitemap.xml'].matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)];
  assert.deepEqual(lm.map(m => [m[1], m[2]]), [[ORI + it[3].url, '2026-10-05']]);                          // lastmod só dessa URL, com a data do feed (nunca hora de build)
  const zero = base.map((p, i) => (i === 2 ? Object.assign({}, p, { stock: 0 }) : p));                    // 10 → 0: semântica muda (OutOfStock)
  const r4 = gerar(zero, r0.estado, '2026-10-06T09:00:00Z', man);
  assert.ok(dif(r0.arquivos, r4.arquivos).includes(rel(it[2])));
  assert.match(r4.arquivos[rel(it[2])], /OutOfStock/);
  const u1 = base.map((p, i) => (i === 5 ? Object.assign({}, p, { stock: 1 }) : p));                      // 10 → 1: ainda InStock (a página já diz "Últimas N" por JS)
  assert.deepEqual(dif(r0.arquivos, gerar(u1, r0.estado, '2026-10-07T09:00:00Z', man).arquivos), []);
});
test('regeneração em escala real: mudar estoque de TODO o feed não toca nenhum arquivo; mudar 3 preços toca só 3 páginas (+sitemap/estado)', () => {
  const r0 = gerar(BRUTOS, null, '2026-10-01T08:00:00Z'), man = JSON.parse(r0.arquivos['produto/manifest.json']);
  const est = BRUTOS.map(p => Object.assign({}, p, { stock: p.stock + 11 }));
  assert.deepEqual(Object.keys(r0.arquivos).filter(k => r0.arquivos[k] !== gerar(est, r0.estado, '2026-10-02T08:00:00Z', man).arquivos[k]), []);
  const pr = BRUTOS.map((p, i) => ([5, 50, 500].includes(i) ? Object.assign({}, p, { price: 'R$ 1.999,99' }) : p));
  const r2 = gerar(pr, r0.estado, '2026-10-03T08:00:00Z', man);
  const mud = Object.keys(r0.arquivos).filter(k => r0.arquivos[k] !== r2.arquivos[k]);
  assert.equal(mud.filter(k => /^produto\//.test(k)).length, 3); assert.deepEqual(mud.filter(k => !/^produto\//.test(k)).sort(), ['data/seo-estado.json', 'sitemap.xml']);
});
test('produto removido perde Offer/preço/estoque; ao voltar, Product e Offer voltam; sem estoque ≠ removido', () => {
  const b = mk(12, i => ({ price: 'R$ 20,00', stock: 5 })), it = C.prepararCatalogo(b);
  const r1 = gerar(b, null, '2026-10-01T10:00:00Z'), man = JSON.parse(r1.arquivos['produto/manifest.json']);
  const sem = b.filter(p => p.id !== '3');
  const r2 = G.planejar(sem, TPL, man, { shell: SHELL, estado: r1.estado, atualizado: '2026-10-02T10:00:00Z', existente: f => r1.arquivos[f] || null });
  const h = r2.arquivos[rel(it[2])];
  assert.match(h, /data-estado="indisponivel"/); assert.doesNotMatch(scripts(h)[0], /offers|"price"|Product|availability|20\.00/);
  const r3 = G.planejar(b, TPL, JSON.parse(r2.arquivos['produto/manifest.json']), { shell: SHELL, estado: r2.estado, atualizado: '2026-10-03T10:00:00Z', existente: f => r2.arquivos[f] || r1.arquivos[f] || null });
  assert.equal(produto(r3.arquivos[rel(it[2])]).offers.price, '20.00');
  assert.ok(locs(r3.arquivos['sitemap.xml']).includes(ORI + it[2].url));
  assert.doesNotMatch(r3.arquivos[rel(it[2])], /name="robots"/);
  const z = mk(12, i => ({ stock: i === 0 ? 0 : 5 })), rz = gerar(z);
  assert.doesNotMatch(rz.arquivos[rel(C.prepararCatalogo(z)[0])], /name="robots"|indisponivel/);
});
function locs(x) { return [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]); }
test('CONSISTÊNCIA: preço do Offer = preço que o runtime usa (pedido e página), 100 % dos produtos; carrinho antigo nunca é fonte', () => {
  let ok = 0;
  ITENS.forEach(e => {
    const offer = produto(A[rel(e)]).offers;
    const visivelCent = C.precoCentavos(String(e.p.price).replace(/ /g, ' '));                       // o que o usuário lê
    assert.equal(LD.precoDecimal(visivelCent), offer.price);
    assert.equal(C.formatarCentavos(visivelCent), String(e.p.price).replace(/ /g, ' '));             // texto visível ⇔ valor numérico (sem arredondamento)
    const cart = { [e.p.id]: { produto: Object.assign({}, e.p, { price: 'R$ 0,01' }), qty: 2 } };           // preço histórico DIFERENTE salvo no carrinho
    const linha = C.resolverPedido(cart, ITENS).linhas[0];
    assert.equal(LD.precoDecimal(linha.precoCent), offer.price);                                          // pedido usa o preço atual = Offer
    ok++;
  });
  assert.equal(ok, ITENS.length);
});
test('preço no JSON-LD é a única mudança de dados: título/meta/H1/breadcrumb/relacionados e UX intactos', () => {
  const e = ITENS[0], h = A[rel(e)];
  assert.match(h, /<title>[^<]+<\/title>/); assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.match(h, /Carregando preço e estoque…/);                                                         // decisão: preço visível continua por JS (sem preço velho piscando)
  assert.doesNotMatch(h, /<[^>]*class="preco-grande"/);                                                   // nenhum preço visível estático
  ['js/catalogo-app.js', 'js/catalogo-cesta.js', 'js/catalogo-rapido.js', 'js/produto-app.js', 'css/catalogo.css'].forEach(f => assert.doesNotMatch(ler(f), /"offers"|priceCurrency|ld\+json/));
});
test('segurança: preço malicioso não vira nada além de dígitos; JSON-LD continua isolado', () => {
  const b = mk(2, i => ({ price: ['R$ 5,00</script><script>alert(1)</script>', 'R$ 8,00'][i] })), it = C.prepararCatalogo(b), r = gerar(b).arquivos;
  assert.equal('offers' in produto(r[rel(it[0])]), false);                                                // inválido → sem Offer
  assert.doesNotMatch(r[rel(it[0])], /<script>alert/);
  assert.equal(produto(r[rel(it[1])]).offers.price, '8.00');
});
test('Fases anteriores: sitemap, canonical, JSON-LD parseável em todas as páginas indexáveis', () => {
  assert.equal(locs(A['sitemap.xml']).length, R.urls.length);
  ITENS.forEach(e => { const h = A[rel(e)]; assert.ok(h.includes(`rel="canonical" href="${ORI}${e.url}"`)); JSON.parse(scripts(h)[0]); assert.doesNotMatch(h, /name="robots"/); });
});
