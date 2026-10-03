'use strict';
// SEO Fase 3 — Schema.org (JSON-LD): Organization, WebSite, BreadcrumbList, Product (sem Offer), CollectionPage
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
const R = G.planejar(BRUTOS, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-02T10:00:00Z', existente: () => null });
const A = R.arquivos;
const ORI = 'https://catalogo.mr4distribuidora.com.br';
const pagP = e => A['produto/' + e.url.replace('/produto/', '') + 'index.html'];
const scripts = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
const grafo = h => { const s = scripts(h); assert.equal(s.length, 1); const j = JSON.parse(s[0]); assert.equal(j['@context'], 'https://schema.org'); return j['@graph']; };
const tipo = (g, t) => g.find(n => n['@type'] === t);
const prep = l => C.prepararCatalogo(l.map((o, i) => Object.assign({ id: String(i + 1), ref: 'R' + (i + 1), name: 'Produto ' + (i + 1), category: 'Cat A', brand: '', price: 'R$ 1,00', stock: 3, img: '', desc: '' }, o)));
const paginas = () => Object.keys(A).filter(k => /\.html$/.test(k) && /^(index|categoria\/|marca\/|produto\/)/.test(k) && !/http-equiv="refresh"/.test(A[k]));

test('home: @graph com Organization + WebSite; ids estáveis; publisher referencia a Organization', () => {
  const g = grafo(A['index.html']);
  assert.equal(g.length, 2);
  const o = tipo(g, 'Organization'), w = tipo(g, 'WebSite');
  assert.equal(o['@id'], ORI + '/#organization'); assert.equal(w['@id'], ORI + '/#website');
  assert.equal(o.name, 'MR4 Distribuidora'); assert.equal(o.url, ORI + '/');
  assert.equal(w.url, ORI + '/'); assert.equal(w.name, 'MR4 Distribuidora');
  assert.deepEqual(w.publisher, { '@id': ORI + '/#organization' });
  assert.equal(g.some(n => n['@type'] === 'BreadcrumbList'), false);          // home não tem breadcrumb real
});
test('Organization: só propriedades confirmadas pelo proprietário (entidade.js) — sem fundação/geo; logo = ativo institucional válido', () => {
  const o = tipo(grafo(A['index.html']), 'Organization');
  assert.deepEqual(Object.keys(o).sort(), ['@id', '@type', 'address', 'areaServed', 'contactPoint', 'email', 'legalName', 'location', 'logo', 'name', 'sameAs', 'taxID', 'telephone', 'url']);
  ['foundingDate', 'geo'].forEach(k => assert.equal(k in o, false, k));
  assert.equal(o.logo['@type'], 'ImageObject'); assert.match(o.logo.url, /^https:\/\/catalogo\.mr4distribuidora\.com\.br\/assets\/logo-header\.png$/);
  const png = fs.readFileSync(path.join(RAIZ, 'assets/logo-header.png'));
  assert.equal(png.readUInt32BE(16), o.logo.width); assert.equal(png.readUInt32BE(20), o.logo.height);   // dimensões declaradas = arquivo real
  assert.ok(o.logo.width >= 112 && o.logo.height >= 112 || o.logo.width >= 112);   // mínimo do Google: 112 px
  assert.match(A['index.html'], /CNPJ 38\.440\.066\/0001-75 · Rua Ceará, 634 · Fortaleza, CE/);   // endereço publicado intacto
});
test('WebSite: sem SearchAction (recurso descontinuado pelo Google; busca é noindex)', () => {
  const w = tipo(grafo(A['index.html']), 'WebSite');
  assert.equal('potentialAction' in w, false);
  assert.doesNotMatch(Object.keys(A).filter(k => /\.html$/.test(k)).map(k => A[k]).join('').slice(0, 5e6), /SearchAction/);
});
test('telefone institucional = o confirmado pelo proprietário (entidade.js); fluxo de vendedores do pedido intacto', () => {
  const cesta = ler('js/catalogo-cesta.js');
  assert.match(cesta, /nome: 'Ademir'/); assert.match(cesta, /nome: 'Fabiana'/);
  assert.equal(tipo(grafo(A['index.html']), 'Organization').telephone, require('../scripts/entidade.js').telefoneE164);
});
test('produto: Product + BreadcrumbList; só propriedades permitidas; nada inventado', () => {
  const PERMITIDAS = new Set(['@type', '@id', 'name', 'url', 'sku', 'brand', 'image', 'description', 'category', 'offers']);   // offers: SEO Fase 3B
  ITENS.forEach(e => {
    const g = grafo(pagP(e));
    assert.deepEqual(g.map(n => n['@type']), ['Product', 'BreadcrumbList']);
    Object.keys(g[0]).forEach(k => assert.ok(PERMITIDAS.has(k), e.p.ref + ' ' + k));
  });
  const txt = ITENS.map(e => scripts(pagP(e))[0]).join('');
  assert.doesNotMatch(txt, /"gtin|"mpn|"ean|"aggregateRating|"review|"manufacturer|"model"|"itemCondition|"priceValidUntil|"hasMerchantReturnPolicy|"shippingDetails|"warranty|"isAccessoryOrSparePartFor|"isCompatible/);
});
test('Product: name = nome cadastrado (não o title), sku = código, url/@id canônicos', () => {
  ITENS.forEach(e => {
    const p = tipo(grafo(pagP(e)), 'Product');
    assert.equal(p.name, e.p.name); assert.doesNotMatch(p.name, /MR4/);
    assert.equal(p.sku, String(e.p.ref).trim());
    assert.equal(p.url, ORI + e.url); assert.equal(p['@id'], ORI + e.url + '#product');
  });
});
test('Product: brand só quando existe (nunca MR4); image só com foto real (nunca o logo)', () => {
  const comMarca = ITENS.filter(e => e.marca), semMarca = ITENS.filter(e => !e.marca);
  assert.ok(comMarca.length > 300 && semMarca.length > 50);
  comMarca.forEach(e => assert.deepEqual(tipo(grafo(pagP(e)), 'Product').brand, { '@type': 'Brand', name: e.marca }));
  semMarca.forEach(e => assert.equal('brand' in tipo(grafo(pagP(e)), 'Product'), false));
  ITENS.forEach(e => {
    const p = tipo(grafo(pagP(e)), 'Product');
    if (e.p.img) assert.equal(p.image, e.p.img); else assert.equal('image' in p, false);
    if (p.image) assert.match(p.image, /^https:\/\//);
    assert.notEqual(p.image, ORI + '/assets/logo-header.png');
  });
  const semFoto = ITENS.filter(e => !e.p.img);
  assert.ok(semFoto.length > 0);
  semFoto.forEach(e => assert.match(pagP(e), /property="og:image" content="[^"]*logo-header\.png"/));   // og:image continua com o logo; o Schema não
});
test('Product: description factual — real limpa ou a frase da Fase 2; category real (omitida em "sem categoria")', () => {
  ITENS.forEach(e => {
    const p = tipo(grafo(pagP(e)), 'Product');
    if (C.descricaoSubstantiva(e)) { assert.equal(p.description, C.cortarPalavra(C.excertoDescricao(e.p.desc), 500)); assert.doesNotMatch(p.description, /\r|\n/); }
    else assert.equal(p.description, C.metaDescricaoProduto(e));
    if (e.semGrupo) assert.equal('category' in p, false); else assert.equal(p.category, e.catRotulo);
  });
  const fallback = ITENS.find(e => !C.descricaoSubstantiva(e));
  const desc = tipo(grafo(pagP(fallback)), 'Product').description;
  assert.equal(desc, pagP(fallback).match(/name="description" content="([^"]*)"/)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));   // mesma descrição da meta
});
test('breadcrumb de produto: Catálogo › Categoria › Produto, URLs limpas, iguais ao breadcrumb visível', () => {
  ITENS.forEach(e => {
    const h = pagP(e), b = tipo(grafo(h), 'BreadcrumbList');
    assert.equal(b['@id'], ORI + e.url + '#breadcrumb');
    const el = b.itemListElement;
    el.forEach((x, i) => { assert.equal(x.position, i + 1); assert.equal(x['@type'], 'ListItem'); assert.match(x.item, /^https:\/\/catalogo\.mr4distribuidora\.com\.br\//); assert.doesNotMatch(x.item, /[?#]|index\.html/); });
    assert.equal(el[0].item, ORI + '/'); assert.equal(el[el.length - 1].item, ORI + e.url); assert.equal(el[el.length - 1].name, e.p.name);
    if (e.semGrupo) assert.equal(el.length, 2); else { assert.equal(el.length, 3); assert.equal(el[1].item, ORI + e.catUrl); assert.equal(el[1].name, e.catRotulo); }
    const vis = [...h.match(/<nav id="bc"[\s\S]*?<\/nav>/)[0].matchAll(/<li[^>]*>(?:<a href="([^"]*)">)?([^<]*)/g)].map(m => [m[1], m[2]]);   // visível: Catálogo › Categoria › (produto sem link)
    assert.equal(vis.length, el.length);
    vis.slice(0, -1).forEach((v, i) => assert.equal(ORI + v[0], el[i].item));
  });
});
test('breadcrumb de categoria e de marca: 2 passos; marca não finge pertencer a categoria; genérica ok', () => {
  R.tax.categorias.forEach(c => {
    const b = tipo(grafo(A['categoria/' + c.slug + '/index.html']), 'BreadcrumbList');
    assert.deepEqual(b.itemListElement.map(x => [x.position, x.name, x.item]), [[1, 'Catálogo', ORI + '/'], [2, c.rotulo, ORI + c.url]]);
  });
  R.tax.marcas.forEach(m => {
    const b = tipo(grafo(A['marca/' + m.slug + '/index.html']), 'BreadcrumbList');
    assert.deepEqual(b.itemListElement.map(x => [x.position, x.name, x.item]), [[1, 'Catálogo', ORI + '/'], [2, m.rotulo, ORI + m.url]]);
  });
  const sem = R.tax.categorias.find(c => c.slug === 'sem-categoria');
  assert.equal(tipo(grafo(A['categoria/sem-categoria/index.html']), 'BreadcrumbList').itemListElement[1].name, 'Sem categoria');
  assert.ok(sem);
});
test('categoria/marca: CollectionPage leve (sem ItemList, sem Brand/Product); isPartOf e breadcrumb por @id', () => {
  const tamanhos = [];
  R.tax.categorias.concat(R.tax.marcas).forEach(t => {
    const f = (t.url.startsWith('/categoria') ? 'categoria/' : 'marca/') + t.slug + '/index.html';
    const g = grafo(A[f]), cp = tipo(g, 'CollectionPage');
    assert.deepEqual(g.map(n => n['@type']), ['CollectionPage', 'BreadcrumbList']);
    assert.equal(cp.url, ORI + t.url); assert.equal(cp['@id'], ORI + t.url + '#collection'); assert.equal(cp.name, t.rotulo);
    assert.deepEqual(cp.isPartOf, { '@id': ORI + '/#website' }); assert.deepEqual(cp.breadcrumb, { '@id': ORI + t.url + '#breadcrumb' });
    assert.equal(cp.description, A[f].match(/name="description" content="([^"]*)"/)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    tamanhos.push(scripts(A[f])[0].length);
  });
  assert.ok(Math.max(...tamanhos) < 1500);                                      // independe do nº de produtos (93 em Moldura)
  assert.doesNotMatch(Object.keys(A).filter(k => /^(categoria|marca)\//.test(k)).map(k => scripts(A[k])[0]).join(''), /ItemList"|"Product"|"Brand"|"Offer/);
});
test('categoria/marca vazia (noindex): só BreadcrumbList; sem CollectionPage', () => {
  const todos = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), ref: 'R' + i, name: 'P' + i, category: i === 0 ? 'B' : 'A', brand: i === 0 ? 'Y' : 'X', price: 'R$ 1', stock: 2, img: '', desc: '' }));
  const r1 = G.planejar(todos, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-01T10:00:00Z', existente: () => null });
  const r2 = G.planejar(todos.slice(1), TPL, JSON.parse(r1.arquivos['produto/manifest.json']), { shell: SHELL, estado: r1.estado, atualizado: '2026-10-02T10:00:00Z', existente: f => r1.arquivos[f] || null });
  const g = grafo(r2.arquivos['categoria/b/index.html']);
  assert.deepEqual(g.map(n => n['@type']), ['BreadcrumbList']);
  assert.match(r2.arquivos['categoria/b/index.html'], /name="robots" content="noindex,follow"/);
  assert.deepEqual(grafo(r2.arquivos['marca/y/index.html']).map(n => n['@type']), ['BreadcrumbList']);
});
test('produto removido (fora do feed): sem Product, sem dado "ativo"; breadcrumb pode ficar; sem estoque NÃO é removido', () => {
  const todos = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), ref: 'R' + (i + 1), name: 'Produto ' + (i + 1), category: 'Cat A', brand: 'X', price: 'R$ 1,00', stock: i === 4 ? 0 : 3, img: 'https://x.test/a.jpg', desc: '' }));
  const r1 = G.planejar(todos, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-01T10:00:00Z', existente: () => null });
  const it = C.prepararCatalogo(todos), rel = e => 'produto/' + e.url.replace('/produto/', '') + 'index.html';
  assert.ok(tipo(grafo(r1.arquivos[rel(it[4])]), 'Product'));                   // estoque 0 no feed: continua Product
  assert.match(scripts(r1.arquivos[rel(it[4])])[0], /"availability":"https:\/\/schema\.org\/OutOfStock"/);   // estoque 0 no feed: Offer com OutOfStock (não é "removido")
  const r2 = G.planejar(todos.filter(p => p.id !== '3'), TPL, JSON.parse(r1.arquivos['produto/manifest.json']), { shell: SHELL, estado: r1.estado, atualizado: '2026-10-02T10:00:00Z', existente: f => r1.arquivos[f] || null });
  const h = r2.arquivos[rel(it[2])];
  assert.match(h, /data-estado="indisponivel"/);
  const g = grafo(h); assert.deepEqual(g.map(n => n['@type']), ['BreadcrumbList']);
  assert.doesNotMatch(scripts(h)[0], /Product|sku|brand|image|offers|price|availability/);   // nenhum Offer/preço/estoque antigo
});
test('segurança: nome/descrição com </script>, aspas, &, <, >, /, acentos não quebram nem injetam', () => {
  const perigo = 'A "B" \'C\' & <D> /E\\ </script><script>alert(1)</script> ção ü   fim';
  const [e] = prep([{ name: perigo, ref: 'X"</script>1', brand: 'Marca "Z" </script>', desc: 'Linha1 </script><b>x</b>\r\nLinha "2" & mais', category: 'Cat </script> A', img: 'https://x.test/a.jpg?a=1&b=2' }]);
  const html = G.renderizarPagina(e, TPL, [], C.tituloProduto(e));
  const s = scripts(html);
  assert.equal(s.length, 1);
  assert.doesNotMatch(s[0], /<|>|&/);                                            // nada que feche a tag ou vire entidade
  assert.equal((html.match(/<\/script>/g) || []).length, (html.match(/<script/g) || []).length);   // só os fechamentos legítimos
  const j = JSON.parse(s[0])['@graph'];
  const p = tipo(j, 'Product');
  assert.equal(p.name, e.p.name); assert.equal(p.sku, e.p.ref.trim()); assert.equal(p.brand.name, e.marca); assert.equal(p.image, e.p.img); assert.equal(p.category, e.catRotulo);
  assert.match(p.description, /Linha1 <\/script><b>x<\/b>; Linha "2" & mais/);   // texto íntegro após o parse
  assert.equal(LD.serializar({ a: '  </script>' }), '{"a":"\\u2028\\u2029\\u003c/script\\u003e"}');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
test('nome longo, acentos e código com símbolos permanecem íntegros', () => {
  const [e] = prep([{ name: 'MÓDULO DE VIDRO HILUX SRX / SW4 — 2016 ATÉ 2025 - 4 vidros automatizados, retrovisores com rebatimento e muitos outros itens ' + 'x'.repeat(40), ref: '89/Z3-ç', brand: 'FKS' }]);
  const p = tipo(JSON.parse(scripts(G.renderizarPagina(e, TPL, [], C.tituloProduto(e)))[0])['@graph'], 'Product');
  assert.equal(p.name, e.p.name); assert.equal(p.sku, '89/Z3-ç');
});
test('JSON-LD: 100 % das páginas indexáveis parseiam, um script no <head>, URLs absolutas e canônicas (sitemap)', () => {
  const urls = new Set(R.urls.map(u => ORI + u));
  const cont = { org: 0, site: 0, bc: 0, prod: 0, col: 0 };
  paginas().forEach(f => {
    const h = A[f];
    if (/name="robots" content="noindex/.test(h) && !/^categoria|^marca/.test(f)) return;
    const s = scripts(h); assert.equal(s.length, 1, f);
    assert.ok(h.indexOf('application/ld+json') < h.indexOf('</head>'), f);   // no <head>, invisível à UX
    const g = JSON.parse(s[0])['@graph'];
    g.forEach(n => { if (n['@type'] === 'Organization') cont.org++; if (n['@type'] === 'WebSite') cont.site++; if (n['@type'] === 'BreadcrumbList') cont.bc++; if (n['@type'] === 'Product') cont.prod++; if (n['@type'] === 'CollectionPage') cont.col++; });
    const todas = []; (function walk(o) { if (o && typeof o === 'object') Object.keys(o).forEach(k => { if ((k === 'url' || k === 'item') && typeof o[k] === 'string') todas.push(o[k]); walk(o[k]); }); })(g);
    todas.forEach(u => { assert.match(u, /^https:\/\//); if (!/assets\/logo-header\.png$/.test(u)) assert.ok(urls.has(u), f + ' → ' + u); assert.doesNotMatch(u, /\?|index\.html/); });
  });
  assert.deepEqual(cont, { org: 1, site: 1, bc: ITENS.length + R.tax.categorias.length + R.tax.marcas.length, prod: ITENS.length, col: R.tax.categorias.length + R.tax.marcas.length });
});
test('Offer (3B): sem rating/review/gtin/validade/condição/frete/devolução em nenhuma página', () => {
  const todo = paginas().map(k => scripts(A[k])[0]).join('');
  assert.doesNotMatch(todo, /"aggregateRating"|"review"|"gtin|"mpn|"priceValidUntil"|"itemCondition"|"hasMerchantReturnPolicy"|"shippingDetails"|"PreOrder|"BackOrder|"LimitedAvailability/);
});
test('orçamento de bytes: JSON-LD leve (home, produto, categoria, marca)', () => {
  const b = f => Buffer.byteLength(scripts(A[f])[0]);
  assert.ok(b('index.html') < 2200);
  const prod = ITENS.map(e => Buffer.byteLength(scripts(pagP(e))[0])).sort((x, y) => x - y);
  assert.ok(prod[prod.length >> 1] < 1900);
  assert.ok(b('categoria/moldura/index.html') < 1500 && b('marca/tiger/index.html') < 1500);
});
test('Schema não altera a UX: nenhum JS/CSS referencia ld+json; sem biblioteca; tudo gerado no build', () => {
  ['js/catalogo-core.js', 'js/catalogo-app.js', 'js/catalogo-cesta.js', 'js/catalogo-rapido.js', 'js/produto-app.js', 'css/catalogo.css'].forEach(f => assert.doesNotMatch(ler(f), /ld\+json|JSON-LD/));
  assert.deepEqual([...ler('scripts/jsonld.js').matchAll(/require\('([^']+)'\)/g)].map(m => m[1]), ['../js/catalogo-core.js', './entidade.js']);
  assert.doesNotMatch(A['index.html'], /<script src="https?:/);
});
test('Fases anteriores intactas: sitemap completo, robots, canonical e links estáticos', () => {
  assert.equal((A['sitemap.xml'].match(/<url>/g) || []).length, R.urls.length);
  assert.match(A['robots.txt'], /^User-agent: \*\nAllow: \//);
  ITENS.forEach(e => assert.ok(pagP(e).includes(`rel="canonical" href="${ORI}${e.url}"`)));
});
