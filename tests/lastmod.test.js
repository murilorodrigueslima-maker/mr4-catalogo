'use strict';
// lastmod semântico: representa mudança REAL e RELEVANTE da URL (conteúdo), não do build nem de navegação compartilhada
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../scripts/gerar-paginas.js');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const mk = (id, o) => Object.assign({ id: String(id), ref: 'R' + id, name: 'Produto ' + id, category: 'Cat A', brand: 'Marca A', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {});
const gerar = (brutos, estado, dataGeracao) => G.planejar(brutos, TPL, null, { shell: SHELL, estado: estado || null, atualizado: '2026-10-01T08:00:00Z', dataGeracao, existente: () => null });
const lm = r => { const o = {}; [...r.arquivos['sitemap.xml'].matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].forEach(m => { o[m[1].replace('https://catalogo.mr4distribuidora.com.br', '')] = m[2] || null; }); return o; };
const comHistorico = (r, d) => { const e = JSON.parse(JSON.stringify(r.estado)); Object.keys(e.lastmod).forEach(u => { e.lastmod[u].d = d; }); return e; };
const base = Array.from({ length: 12 }, (_, i) => mk(i + 1));
const r0 = gerar(base);
const H = comHistorico(r0, '2026-01-01');                       // todas as URLs com histórico (data antiga)

test('build sem nenhuma mudança NÃO falsifica frescor: mesmo com outra data de geração o sitemap e o estado são idênticos', () => {
  const r = gerar(base, H, '2026-10-20');
  assert.equal(r.arquivos['sitemap.xml'], gerar(base, H, '2026-12-31').arquivos['sitemap.xml']);
  Object.values(lm(r)).forEach(d => assert.equal(d, '2026-01-01'));
  assert.equal(r.arquivos['data/seo-estado.json'], gerar(base, H, '2026-10-20').arquivos['data/seo-estado.json']);
});
test('produto alterado (preço): só a página dele (e as listas que o mostram) recebem a data da geração', () => {
  const mud = base.map(p => (p.id === '3' ? Object.assign({}, p, { price: 'R$ 12,50' }) : p));
  const r = gerar(mud, H, '2026-10-20'), d = lm(r);
  const url3 = Object.keys(d).find(u => u.includes('produto-3--'));
  assert.equal(d[url3], '2026-10-20');
  const outro = Object.keys(d).find(u => u.includes('produto-8--'));
  assert.equal(d[outro], '2026-01-01');                         // outro produto: intacto
});
test('descrição alterada atualiza a data da página do produto; marca alterada atualiza produto e a lista da marca', () => {
  const r1 = gerar(base.map(p => (p.id === '4' ? Object.assign({}, p, { desc: 'Descrição factual nova com mais de quarenta caracteres.' }) : p)), H, '2026-10-21');
  const d1 = lm(r1); assert.equal(d1[Object.keys(d1).find(u => u.includes('produto-4--'))], '2026-10-21');
  const r2 = gerar(base.map(p => (p.id === '5' ? Object.assign({}, p, { brand: 'Marca B' }) : p)), H, '2026-10-22');
  const d2 = lm(r2); assert.equal(d2[Object.keys(d2).find(u => u.includes('produto-5--'))], '2026-10-22');
  assert.equal(d2['/marca/marca-b/'], '2026-10-22');           // página nova
});
test('mudança só de navegação compartilhada (marca/categoria NOVAS) não atualiza URLs sem mudança própria (home, produtos, categoria e marca existentes)', () => {
  const mais = base.concat(mk(99, { name: 'Item novo', category: 'Cat Z', brand: 'Marca Z' }));
  const r = gerar(mais, H, '2026-10-25'), d = lm(r);
  assert.equal(d['/'], '2026-01-01');
  assert.equal(d['/categoria/cat-a/'], '2026-01-01');
  assert.equal(d['/marca/marca-a/'], '2026-01-01');
  Object.keys(d).filter(u => /\/produto\/produto-\d+--/.test(u)).forEach(u => assert.equal(d[u], '2026-01-01', u));
  assert.equal(d['/categoria/cat-z/'], '2026-10-25');           // URL nova recebe a data
  assert.ok(d[Object.keys(d).find(u => u.includes('item-novo--'))] === '2026-10-25');
  // mas o HTML da home MUDOU (menu) — o IndexNow ainda detecta; só o lastmod não é falsificado
  assert.notEqual(r.arquivos['index.html'], r0.arquivos['index.html']);
});
test('só o bloco de relacionados mudou: lastmod da página mantém; a página do produto renomeado e as listas que o mostram atualizam', () => {
  const mud = base.map(p => (p.id === '3' ? Object.assign({}, p, { name: 'Produto 3 renomeado' }) : p));
  const r = gerar(mud, H, '2026-10-26'), d = lm(r);
  const mudouHtml = Object.keys(r.arquivos).filter(f => /^produto\/.+\/index\.html$/.test(f) && r0.arquivos[f] !== undefined && r0.arquivos[f] !== r.arquivos[f]);
  assert.ok(mudouHtml.length >= 2);                              // além do produto 3, vizinhos mostram o novo nome nos relacionados
  const n = mudouHtml.filter(f => d['/' + f.replace(/index\.html$/, '')] === '2026-01-01').length;
  assert.ok(n >= 1, 'ao menos uma página com HTML alterado só nos relacionados manteve o lastmod');
});
test('migração: entradas antigas sem `c` adotam o hash e MANTÊM a data (sem bump em massa); depois passam a rastrear mudanças reais', () => {
  const velho = JSON.parse(JSON.stringify(H)); Object.keys(velho.lastmod).forEach(u => { delete velho.lastmod[u].c; });
  const r = gerar(base, velho, '2026-11-01');
  Object.values(lm(r)).forEach(d => assert.equal(d, '2026-01-01'));
  Object.values(r.estado.lastmod).forEach(v => assert.ok(typeof v.c === 'string' && v.c.length === 12));
  const mud = base.map(p => (p.id === '2' ? Object.assign({}, p, { price: 'R$ 99,00' }) : p));
  const r2 = gerar(mud, r.estado, '2026-11-02'); const d2 = lm(r2);
  assert.equal(d2[Object.keys(d2).find(u => u.includes('produto-2--'))], '2026-11-02');
});
test('sitemap válido: lastmod AAAA-MM-DD, URLs únicas e sem data/hora de build; planejar() sem dataGeracao usa a data do feed (determinístico)', () => {
  const r = gerar(base.map(p => (p.id === '7' ? Object.assign({}, p, { price: 'R$ 55,00' }) : p)), H, '2026-10-30');
  const x = r.arquivos['sitemap.xml'];
  [...x.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].forEach(m => assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/));
  const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]); assert.equal(new Set(locs).size, locs.length);
  const a = gerar(base.map(p => (p.id === '7' ? Object.assign({}, p, { price: 'R$ 55,00' }) : p)), H), b = gerar(base.map(p => (p.id === '7' ? Object.assign({}, p, { price: 'R$ 55,00' }) : p)), H);
  assert.equal(a.arquivos['sitemap.xml'], b.arquivos['sitemap.xml']);
  assert.ok(Object.values(lm(a)).includes('2026-10-01'));       // data do feed quando não há dataGeracao
});
test('conteudoRelevante: ignora menus, relacionados e versões de asset; considera preço (JSON-LD), nome e lista de produtos', () => {
  const html = '<html><head><title>T</title><meta name="description" content="D"><script type="application/ld+json">{"price":"1.00"}</script></head><body><header>menu A</header><main><h1>X</h1><div id="relacionados"><ul><li>rel 1</li></ul></div><nav aria-label="Marcas do catálogo">m1 m2</nav><p>corpo</p></main></body></html>';
  const base1 = G.conteudoRelevante(html);
  assert.equal(G.conteudoRelevante(html.replace('menu A', 'menu B').replace('rel 1', 'rel 2').replace('m1 m2', 'm1 m2 m3').replace('<title>', '<!-- v -->  <title>')), base1);
  assert.notEqual(G.conteudoRelevante(html.replace('"1.00"', '"2.00"')), base1);
  assert.notEqual(G.conteudoRelevante(html.replace('<p>corpo</p>', '<p>corpo novo</p>')), base1);
});
