'use strict';
// Hubs de navegação: /marcas/ e hubs de montadora das molduras (/categoria/moldura/<montadora>/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');
const H = require('../scripts/hubs.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const ED = JSON.parse(ler('data/editorial.json'));
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const ORI = 'https://catalogo.mr4distribuidora.com.br';
const gerar = (brutos, estado) => G.planejar(brutos, TPL, null, { shell: SHELL, editorial: ED, estado: estado || null, atualizado: '2026-10-04T10:00:00.000Z', existente: () => null });
const R = gerar(BRUTOS), A = R.arquivos;
const links = html => [...html.matchAll(/<a [^>]*href="([^"#]*)"/g)].map(m => m[1]);
const locs = x => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const grafo = h => JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const arquivoDe = u => u.replace(/^\//, '') + 'index.html';
const hubs = H.hubsMoldura(R.itens);
const mk = (id, o) => Object.assign({ id: String(id), ref: 'R' + id, name: 'Produto ' + id, category: 'Moldura', brand: 'Fiamon', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {});

test('/marcas/: página válida (title, H1 único, canonical, breadcrumb, Schema) e presente no sitemap', () => {
  const h = A['marcas/index.html'];
  assert.ok(h.includes(`<link rel="canonical" href="${ORI}/marcas/">`));
  assert.match(h, /<title>Marcas do catálogo B2B \| MR4 Distribuidora<\/title>/);
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.doesNotMatch(h, /name="robots"/);
  assert.match(h, /<nav class="bc"[^>]*><a href="\/">Catálogo<\/a> › <span aria-current="page">Marcas<\/span>/);
  assert.ok(locs(A['sitemap.xml']).includes(ORI + '/marcas/'));
  const g = grafo(h);
  assert.deepEqual(g.map(n => n['@type']), ['CollectionPage', 'ItemList', 'BreadcrumbList']);
  assert.equal(g[1].numberOfItems, R.tax.marcas.length); assert.equal(g[1].itemListElement.length, R.tax.marcas.length);
  assert.doesNotMatch(JSON.stringify(g), /"Product"|"Offer"|FAQPage/);
});
test('/marcas/: toda marca tem URL correta, contagem real e link; ordem determinística (mais produtos, depois nome); nenhuma marca sem página', () => {
  const h = A['marcas/index.html'];
  const li = [...h.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a> <span class="hub-n">([\d.]+) produtos?<\/span>/g)];
  assert.equal(li.length, R.tax.marcas.length);
  const ordem = H.marcasOrdenadas(R.tax);
  li.forEach((m, i) => {
    const t = ordem[i];
    assert.equal(m[1], t.url); assert.equal(m[2].replace(/&amp;/g, '&'), t.rotulo); assert.equal(Number(m[3].replace(/\./g, '')), t.itens.length);
    assert.ok(arquivoDe(t.url) in A, t.url);
    assert.ok(t.itens.length >= 1);
  });
  for (let i = 1; i < ordem.length; i++) assert.ok(ordem[i - 1].itens.length > ordem[i].itens.length || (ordem[i - 1].itens.length === ordem[i].itens.length && ordem[i - 1].rotulo.localeCompare(ordem[i].rotulo, 'pt-BR') <= 0));
  assert.equal(A['marcas/index.html'], gerar(BRUTOS).arquivos['marcas/index.html']);   // determinístico
});
test('links: nenhuma página de hub aponta para redirect; todo href interno resolve para arquivo gerado e não-redirect; /marcas/ é descoberta pelo contexto da home, categorias e marcas', () => {
  const pags = ['marcas/index.html'].concat(hubs.map(h => arquivoDe(h.url)));
  pags.forEach(f => links(A[f]).filter(l => l.startsWith('/')).forEach(l => {
    if (l === '/') return;
    const rel = arquivoDe(l); assert.ok(rel in A, f + ' → ' + l); assert.doesNotMatch(A[rel], /http-equiv="refresh"/, f + ' → redirect ' + l);
  }));
  ['index.html', 'categoria/' + R.tax.categorias[0].slug + '/index.html', R.tax.marcas[0].url.slice(1) + 'index.html'].forEach(f => assert.ok(links(A[f]).includes('/marcas/'), f));
});
test('hubs de montadora (molduras): ≥5 produtos e ≥3 modelos; montadora só por token literal no nome; nenhum hub vazio ou com produto inexistente', () => {
  assert.ok(hubs.length >= 5);
  const vivos = new Set(R.itens.map(i => i.url));
  hubs.forEach(h => {
    assert.ok(h.itens.length >= H.MIN_PRODUTOS && h.modelos >= H.MIN_MODELOS, h.url);
    h.itens.forEach(i => { assert.ok(vivos.has(i.url)); assert.ok(i.catChave === 'Moldura'); assert.ok(H.montadorasDoNome(i.p.name).includes(h.montadora), i.p.name); });
    const f = arquivoDe(h.url), html = A[f]; assert.ok(f in A);
    assert.ok(html.includes(`<link rel="canonical" href="${ORI}${h.url}">`)); assert.doesNotMatch(html, /name="robots"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    const lis = (html.match(/<li><a href="\/produto\//g) || []).length; assert.equal(lis, h.itens.length);
    const g = grafo(html); assert.deepEqual(g.map(n => n['@type']), ['CollectionPage', 'ItemList', 'BreadcrumbList']);
    assert.equal(g[1].numberOfItems, h.itens.length); assert.doesNotMatch(JSON.stringify(g), /"Product"|"Offer"|FAQPage/);
    assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /R\$|\bestoque: \d/);   // preço/estoque nunca no HTML estático
    assert.ok(locs(A['sitemap.xml']).includes(ORI + h.url));
  });
  assert.deepEqual(H.montadorasDoNome('MOLD. GOL G7/AMAROK/JETTA/TIGUAN 2 DIN'), []);            // modelo NÃO implica montadora
  assert.deepEqual(H.montadorasDoNome('MOLDURA 9 POLEGADAS COMPATIVEL COMFIAT PALIO G2'), []);   // sem inferir
  assert.deepEqual(H.montadorasDoNome('MOLDURA 2 DIN GM SPIN 18/21 - PRETA'), ['Chevrolet']);     // GM→Chevrolet (aprovado)
  assert.deepEqual(H.montadorasDoNome('MOLDURA 9 VW AMAROK 17 - PRETA'), ['Volkswagen']);
});
test('categoria Moldura aponta para os hubs; não existe /molduras/ (sem página com a mesma intenção da categoria)', () => {
  const cat = R.itens.find(i => i.catChave === 'Moldura');
  const f = arquivoDe(cat.catUrl); const l = links(A[f]);
  hubs.forEach(h => assert.ok(l.includes(h.url), h.url));
  assert.equal('molduras/index.html' in A, false);
  hubs.forEach(h => assert.ok(links(A[arquivoDe(h.url)]).includes(cat.catUrl)));          // volta para a categoria (canonical genérico)
});
test('sitemap: nenhuma URL de redirect; toda URL tem arquivo, canonical igual e 200 lógico; hubs nunca noindex', () => {
  locs(A['sitemap.xml']).forEach(u => { const rel = arquivoDe(u.replace(ORI, '')); assert.ok(rel in A, u); assert.doesNotMatch(A[rel], /http-equiv="refresh"/, u); assert.ok(A[rel].includes(`rel="canonical" href="${u}"`), u); assert.doesNotMatch(A[rel], /name="robots" content="noindex/, u); });
});
test('hub que deixa de ser candidato: continua no ar com noindex e SAI do sitemap (nunca apagado)', () => {
  const base = []; for (let i = 1; i <= 6; i++) base.push(mk(i, { name: `MOLDURA 2 DIN HONDA MODELO${'ABCDEF'[i - 1]} 15/20 - PRETA` }));
  for (let i = 7; i <= 30; i++) base.push(mk(i, { category: 'Outra', name: 'Produto ' + i }));
  const r1 = gerar(base); const url = Object.keys(r1.estado.hubs)[0];
  assert.equal(url, '/categoria/moldura/honda/'); assert.ok(locs(r1.arquivos['sitemap.xml']).includes(ORI + url));
  const r2 = gerar(base.map((p, i) => (i >= 3 && i < 6 ? Object.assign({}, p, { name: 'MOLDURA 2 DIN MODELO' + i }) : p)), r1.estado);   // 3 dos 6 deixam de citar a montadora
  assert.match(r2.arquivos[arquivoDe(url)], /name="robots" content="noindex,follow"/);
  assert.equal(locs(r2.arquivos['sitemap.xml']).includes(ORI + url), false);
  assert.ok(url in r2.estado.hubs);
});
test('camada editorial NÃO altera preço, estoque, código, ID nem imagem de nenhum produto (dados reais)', () => {
  const it = C.prepararCatalogo(BRUTOS, ED);
  const por = new Map(BRUTOS.map(p => [String(p.id), p]));
  assert.equal(it.length, BRUTOS.length);
  it.forEach(x => { const o = por.get(String(x.p.id)); ['price', 'stock', 'ref', 'id', 'img'].forEach(k => assert.equal(x.p[k], o[k], x.p.id + ' ' + k)); });
});
test('página de produto leva ao hub da montadora: só moldura que pertence a um hub; o alvo existe; demais produtos sem o bloco', () => {
  const dentro = new Set(); hubs.forEach(h => h.itens.forEach(i => dentro.add(i)));
  R.itens.forEach(it => {
    const html = A['produto/' + G.dirDe(it.url) + '/index.html'];
    const m = html.match(/<nav class="mais-hub"[^>]*>([\s\S]*?)<\/nav>/);
    if (!dentro.has(it)) { assert.equal(m, null, it.p.name); return; }
    assert.ok(m, it.p.name);
    const alvos = [...m[1].matchAll(/href="([^"]+)"/g)].map(x => x[1]);
    alvos.forEach(u => { assert.ok(hubs.some(h => h.url === u && h.itens.includes(it)), u); assert.ok(arquivoDe(u) in A); });
    assert.doesNotMatch(html, /\{\{HUBLINK\}\}/);
  });
  assert.ok(dentro.size >= 50);
});
