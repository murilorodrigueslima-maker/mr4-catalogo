'use strict';
// SEO Fase 1 — rastreabilidade: robots, sitemap, home, categorias/marcas estáticas, grafo de links, parâmetros, removidos
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const APP = ler('js/catalogo-app.js');
const ATUAL = '2026-10-02T10:00:00.000Z';
const gerar = (brutos, estado, atualizado, existente) => G.planejar(brutos, TPL, null, { shell: SHELL, estado: estado || null, atualizado: atualizado || ATUAL, existente: existente || (() => null) });
const R = gerar(BRUTOS);
const A = R.arquivos;
const itens = C.prepararCatalogo(BRUTOS);
const locs = x => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const links = html => [...html.matchAll(/<a [^>]*href="([^"#]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
const mk = (id, o) => Object.assign({ id: String(id), ref: 'R' + id, name: 'Produto ' + id, category: 'Cat A', brand: 'Marca A', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {});

test('robots.txt: permite tudo e declara o sitemap exato; não bloqueia css/js/json/produto/categoria/marca', () => {
  assert.equal(A['robots.txt'], 'User-agent: *\nAllow: /\n\nSitemap: https://catalogo.mr4distribuidora.com.br/sitemap.xml\n');
  assert.doesNotMatch(A['robots.txt'], /Disallow\s*:\s*\S/i);
  assert.equal(ler('robots.txt'), A['robots.txt']);
});
test('sitemap: XML válido, URLs absolutas, sem duplicata, sem parâmetros, 605 produtos', () => {
  const x = A['sitemap.xml'];
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.match(x, /<\/urlset>\n$/);
  const l = locs(x);
  assert.equal(new Set(l).size, l.length);
  l.forEach(u => { assert.match(u, /^https:\/\/catalogo\.mr4distribuidora\.com\.br\//); assert.doesNotMatch(u, /[?#&]/); });
  assert.equal(l.filter(u => u.includes('/produto/')).length, itens.length);
  assert.equal(l.filter(u => u.includes('/categoria/')).length, R.tax.categorias.length);
  assert.equal(l.filter(u => u.includes('/marca/')).length, R.tax.marcas.length);
  assert.ok(l.includes('https://catalogo.mr4distribuidora.com.br/'));
  assert.equal((x.match(/<url>/g) || []).length, l.length);
});
test('sitemap: toda URL é canônica de si mesma, indexável e tem arquivo; nenhuma noindex', () => {
  R.urls.forEach(u => {
    const f = A[u === '/' ? 'index.html' : u.slice(1) + 'index.html'];
    assert.ok(f, u);
    assert.ok(f.includes(`<link rel="canonical" href="https://catalogo.mr4distribuidora.com.br${u}">`), 'canonical ' + u);
    assert.doesNotMatch(f, /name="robots"/, 'noindex em ' + u);
  });
});
test('home: title, description factual, canonical, H1 único e Open Graph', () => {
  const h = A['index.html'];
  assert.equal(G.TITLE_HOME, 'Catálogo B2B de acessórios automotivos | MR4 Distribuidora');
  assert.ok(G.TITLE_HOME.length <= 65);
  assert.match(h, new RegExp('<title>' + G.TITLE_HOME.replace(/[|]/g, '\\|') + '</title>'));
  assert.ok(G.DESC_HOME.length <= 200);
  assert.doesNotMatch(G.DESC_HOME, /maior|melhor|líder|anos|frete|todo o brasil|nacional|clientes/i);   // nada que não seja fato público
  assert.match(h, /<link rel="canonical" href="https:\/\/catalogo\.mr4distribuidora\.com\.br\/">/);
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  ['og:title', 'og:description', 'og:url', 'og:type', 'og:image'].forEach(p => assert.match(h, new RegExp('property="' + p + '"')));
  assert.match(h, /property="og:url" content="https:\/\/catalogo\.mr4distribuidora\.com\.br\/"/);
  assert.equal(ler('index.html'), h);                      // o index.html versionado é exatamente o gerado
});
test('home: links estáticos para TODAS as categorias e marcas; endereço institucional preservado', () => {
  const l = links(A['index.html']);
  R.tax.categorias.forEach(c => assert.ok(l.includes(c.url), c.url));
  R.tax.marcas.forEach(m => assert.ok(l.includes(m.url), m.url));
  assert.ok(A['index.html'].includes('CNPJ 38.440.066/0001-75 · Rua Ceará, 634 · Fortaleza, CE'));
  assert.equal(l.filter(u => u.startsWith('/produto/')).length, 0);        // home não carrega 605 links: o grafo passa por categorias/marcas
  assert.doesNotMatch(A['index.html'], /display:\s*none/);
});
test('home: sem hero pesado — contexto discreto e curto', () => {
  const m = A['index.html'].match(/<section class="seo-contexto"[\s\S]*?<\/section>/)[0];
  assert.match(m, /distribuidora de acessórios e peças automotivas no atacado/);
  assert.match(m, /lojistas e instaladores/);
  assert.ok((m.match(/<p>([^<]*)<\/p>/)[1]).length < 450);
});
test('categorias: uma página por categoria, HTML inicial com title/meta/canonical/H1 e links para TODOS os produtos', () => {
  assert.equal(R.tax.categorias.length, new Set(itens.map(e => e.catChave)).size);
  R.tax.categorias.forEach(c => {
    const h = A['categoria/' + c.slug + '/index.html'];
    assert.ok(h, c.slug);
    assert.match(h, /<title>[^<]+<\/title>/); assert.match(h, /<meta name="description" content="[^"]{40,}"/);
    assert.ok(h.includes(`<link rel="canonical" href="https://catalogo.mr4distribuidora.com.br/categoria/${c.slug}/">`));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    const l = new Set(links(h));
    c.itens.forEach(e => assert.ok(l.has(e.url), c.slug + ' → ' + e.url));    // cobertura 100 %, não só o primeiro lote
    assert.ok(h.includes(`data-cat="${C.esc(c.chave)}"`));
  });
  const mold = R.tax.categorias.find(c => c.slug === 'moldura');
  assert.ok(mold && mold.itens.length > 80);
});
test('marcas: uma página por marca, links para todos os produtos; sem página "sem marca"', () => {
  assert.equal(R.tax.marcas.length, new Set(itens.map(e => e.marca).filter(Boolean)).size);
  R.tax.marcas.forEach(m => {
    const h = A['marca/' + m.slug + '/index.html'];
    assert.ok(h, m.slug);
    assert.ok(h.includes(`<link rel="canonical" href="https://catalogo.mr4distribuidora.com.br/marca/${m.slug}/">`));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    const l = new Set(links(h));
    m.itens.forEach(e => assert.ok(l.has(e.url), m.slug + ' → ' + e.url));
  });
  assert.ok(!Object.keys(A).some(k => /^marca\/(sem-marca|sem|)\//.test(k)));
});
test('slugs: determinísticos, sem acento/pontuação/caixa, colisão resolvida por hash estável', () => {
  const it = C.prepararCatalogo([mk(1, { category: 'Led’s interno' }), mk(2, { category: 'Leds interno' }), mk(3, { category: 'Moldura' }), mk(4, { category: 'PRODUTOS SEM GRUPO' })]);
  const slugs = it.map(e => e.catSlug);
  assert.equal(new Set(slugs).size, 4);                                       // 4 categorias distintas (2 colidem no slug base)
  assert.match(it[0].catSlug, /^leds-interno-[0-9a-f]{4}$/); assert.match(it[1].catSlug, /^leds-interno-[0-9a-f]{4}$/);
  assert.notEqual(it[0].catSlug, it[1].catSlug);
  assert.equal(it[2].catSlug, 'moldura'); assert.equal(it[3].catSlug, 'sem-categoria');
  const it2 = C.prepararCatalogo([mk(2, { category: 'Leds interno' }), mk(1, { category: 'Led’s interno' })]);
  assert.equal(it2[1].catSlug, it[0].catSlug);                                // independe da ordem
  R.tax.categorias.concat(R.tax.marcas).forEach(t => assert.match(t.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/));
  assert.equal(new Set(R.tax.categorias.map(t => t.slug)).size, R.tax.categorias.length);
  assert.equal(new Set(R.tax.marcas.map(t => t.slug)).size, R.tax.marcas.length);
});
test('marcas inconsistentes NÃO são fundidas por suposição; normalização aprovada continua valendo', () => {
  const fx = C.prepararCatalogo(['Fitto/Joker', 'FITTO/JOKER', 'Joker', 'FITTO', 'Fiamon', 'Faimon'].map((b, i) => mk(i + 1, { brand: b })));
  const m = [...new Set(fx.map(e => e.marca))];
  assert.deepEqual(m, ['Fitto/Joker', 'Joker', 'FITTO', 'Fiamon', 'Faimon']);        // só 'Fitto/Joker' ≡ 'FITTO/JOKER' (caixa, mapa aprovado)
  assert.equal(new Set(fx.map(e => e.marcaSlug)).size, 5);
  assert.deepEqual(fx.map(e => e.marcaSlug).slice(0, 2), ['fitto-joker', 'fitto-joker']);
});
test('categorias genéricas continuam como na fonte (Diversos, Geral, Sem categoria)', () => {
  const s = R.tax.categorias.map(c => c.slug);
  ['diversos', 'geral', 'sem-categoria'].forEach(x => assert.ok(s.includes(x), x));
});
test('grafo estático: crawl só por <a href> a partir da home descobre 605/605 produtos, 0 órfãos', () => {
  const visit = new Set(['/']), fila = ['/'], prod = new Set();
  const pag = u => A[u === '/' ? 'index.html' : u.slice(1) + 'index.html'] || A['produto/' + u.replace(/^\/produto\//, '')+'index.html'];
  while (fila.length) {
    const u = fila.shift(); const h = pag(u); if (!h) continue;
    if (u.startsWith('/produto/')) prod.add(u);
    links(h).forEach(l => { if (/^\/(produto|categoria|marca)\/[^/?]+\/$/.test(l) && !visit.has(l)) { visit.add(l); fila.push(l); } });
  }
  assert.equal(prod.size, itens.length);
  assert.deepEqual(itens.filter(e => !prod.has(e.url)).map(e => e.url), []);
});
test('produto: breadcrumb com categoria limpa, link de marca limpo e 4 relacionados estáticos (mesmo algoritmo)', () => {
  const e = itens.find(x => x.marca && !x.semGrupo);
  const h = A['produto/' + e.url.replace('/produto/', '')+'index.html'];
  assert.ok(h.includes(`<li><a href="${e.catUrl}">`));
  assert.doesNotMatch(h, /\?cat=/);
  assert.ok(h.includes(`<a class="marca-link" href="${e.marcaUrl}">`));
  const esp = C.relacionados(itens, e, 4);
  assert.equal(esp.length, 4);
  const sec = h.match(/<section class="relacionados"[\s\S]*?<\/section>/)[0];
  esp.forEach(r => { assert.ok(sec.includes(`href="${r.url}"`)); assert.ok(sec.includes(C.esc(r.p.name))); });
  assert.equal((sec.match(/<li>/g) || []).length, 4);
  assert.match(h, /<link rel="canonical" href="https:\/\/catalogo\.mr4distribuidora\.com\.br\/produto\//);
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
});
test('produtos: 605 páginas 200 com canonical próprio, H1 e sem noindex', () => {
  itens.forEach(e => {
    const h = A['produto/' + e.url.replace('/produto/', '') + 'index.html'];
    assert.ok(h.includes(`rel="canonical" href="https://catalogo.mr4distribuidora.com.br${e.url}"`));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.doesNotMatch(h, /name="robots"/);
  });
});
test('parâmetros: política no app — URL limpa, canonical por estado, noindex para busca/combinação/sort/r', () => {
  assert.match(APP, /function atualizarSeoEstado/);
  assert.match(APP, /noindex,follow/);
  assert.match(APP, /!!q \|\| !!\(estado\.cat && estado\.marca\) \|\| PARAMS0\.has\('sort'\) \|\| PARAMS0\.has\('r'\)/);
  assert.match(APP, /C\.urlLimpa\(itens, estado\.cat, estado\.marca\)/);
  assert.match(APP, /can\.href = origem \+ alvo/);
  assert.equal(C.urlLimpa(itens, 'Moldura', ''), '/categoria/moldura/');
  assert.equal(C.urlLimpa(itens, '', 'Tiger'), '/marca/tiger/');
  assert.equal(C.urlLimpa(itens, 'Moldura', 'Tiger'), null);                  // combinação nunca ganha URL própria
  assert.equal(C.urlLimpa(itens, '', ''), null);
  assert.match(APP, /\?q=|set\('q'/);                                          // busca compartilhável preservada
  assert.match(APP, /atualizarSeoEstado\(\);\n  \}/);
});
test('parâmetros: HTML estático da home tem canonical "/" (consolida ?q ?sort ?r ?cat ?marca e /index.html)', () => {
  assert.match(A['index.html'], /rel="canonical" href="https:\/\/catalogo\.mr4distribuidora\.com\.br\/"/);
  assert.doesNotMatch(A['index.html'], /name="robots"/);
});
test('retorno ao catálogo e UX preservados: estado salvo, ?r=1 só no botão Voltar, modos e pedido rápido intactos', () => {
  assert.match(TPL, /href="\/\?r=1">← Voltar ao catálogo/);
  assert.match(APP, /salvoCombina/); assert.match(APP, /Rapido\.alternar/); assert.match(APP, /CHAVE_MODO/);
  ['catalogo-core.js', 'catalogo-cesta.js', 'catalogo-rapido.js', 'catalogo-app.js'].forEach(f => assert.match(A['index.html'], new RegExp(f)));
});
test('estoque zero NÃO vira noindex automaticamente (página válida preservada)', () => {
  const r = gerar([mk(1), mk(2, { stock: 0 })]);
  const h = r.arquivos['produto/' + C.prepararCatalogo([mk(2, { stock: 0 })])[0].url.replace('/produto/', '') + 'index.html'];
  assert.doesNotMatch(h, /name="robots"/);
  assert.ok(locs(r.arquivos['sitemap.xml']).some(u => u.includes('--r2/')));
});
test('produto que saiu do feed: aviso estático sem preço/estoque, fora do sitemap; noindex só após a carência', () => {
  const todos = [1, 2, 3, 4, 5, 6, 7].map(i => mk(i));
  const r1 = gerar(todos, null, '2026-10-01T10:00:00Z');
  const pg = r1.arquivos, rel = 'produto/' + C.prepararCatalogo([mk(3)])[0].url.replace('/produto/', '') + 'index.html';
  assert.ok(pg[rel]);
  const existente = f => pg[f] || null;
  const man = JSON.parse(pg['produto/manifest.json']);
  const sem3 = todos.filter(p => p.id !== '3');
  const r2 = G.planejar(sem3, TPL, man, { shell: SHELL, estado: r1.estado, atualizado: '2026-10-03T10:00:00Z', existente });
  const h2 = r2.arquivos[rel];
  assert.match(h2, /data-estado="indisponivel"/); assert.match(h2, /Produto não disponível no catálogo no momento/);
  assert.doesNotMatch(h2, /R\$|em estoque/); assert.doesNotMatch(h2, /class="relacionados"/);
  assert.doesNotMatch(h2, /name="robots"/);                                    // dentro da carência: ainda indexável
  assert.ok(!locs(r2.arquivos['sitemap.xml']).some(u => u.includes('--r3/')));
  assert.ok(r2.estado.ausentes.r3);
  const ex2 = f => r2.arquivos[f] || pg[f] || null;
  const r3 = G.planejar(sem3, TPL, JSON.parse(r2.arquivos['produto/manifest.json']), { shell: SHELL, estado: r2.estado, atualizado: '2026-10-12T10:00:00Z', existente: ex2 });
  assert.match(r3.arquivos[rel], /<meta name="robots" content="noindex,follow">/);   // 9 dias ausente ≥ 7
  assert.match(r3.arquivos[rel], /rel="canonical"/);
  const ex3 = f => r3.arquivos[f] || ex2(f);
  const r4 = G.planejar(sem3, TPL, JSON.parse(r3.arquivos['produto/manifest.json']), { shell: SHELL, estado: r3.estado, atualizado: '2026-10-12T14:00:00Z', existente: ex3 });
  assert.equal(r4.arquivos[rel], r3.arquivos[rel]);                             // idempotente
  const r5 = G.planejar(todos, TPL, JSON.parse(r3.arquivos['produto/manifest.json']), { shell: SHELL, estado: r3.estado, atualizado: '2026-10-13T10:00:00Z', existente: ex3 });
  assert.doesNotMatch(r5.arquivos[rel], /name="robots"|indisponivel/);          // voltou: reindexável
  assert.ok(!r5.estado.ausentes.r3);
});
test('falha de sync ≠ produto removido: feed com queda > 15 % ou vazio não regenera nada', () => {
  const todos = Array.from({ length: 20 }, (_, i) => mk(i + 1));
  const r1 = gerar(todos);
  const man = JSON.parse(r1.arquivos['produto/manifest.json']);
  const r2 = G.planejar(todos.slice(0, 10), TPL, man, { shell: SHELL, estado: r1.estado, atualizado: ATUAL, existente: () => null });
  assert.equal(r2.saudavel, false); assert.deepEqual(r2.arquivos, {});
  assert.equal(G.planejar([], TPL, man, { shell: SHELL, estado: r1.estado, atualizado: ATUAL, existente: () => null }).saudavel, false);
  assert.equal(G.planejar(todos.slice(0, 18), TPL, man, { shell: SHELL, estado: r1.estado, atualizado: ATUAL, existente: () => null }).saudavel, true);
});
test('categoria/marca que ficou sem produtos vira noindex (nunca é apagada) e sai do sitemap', () => {
  const todos = [mk(1, { category: 'A', brand: 'X' }), mk(2, { category: 'A', brand: 'X' }), mk(3, { category: 'B', brand: 'Y' }), mk(4, { category: 'A', brand: 'X' }), mk(5, { category: 'A', brand: 'X' }), mk(6, { category: 'A', brand: 'X' }), mk(7, { category: 'A', brand: 'X' }), mk(8, { category: 'A', brand: 'X' }), mk(9, { category: 'A', brand: 'X' }), mk(10, { category: 'A', brand: 'X' })];
  const r1 = gerar(todos); const man = JSON.parse(r1.arquivos['produto/manifest.json']);
  const r2 = G.planejar(todos.filter(p => p.id !== '3'), TPL, man, { shell: SHELL, estado: r1.estado, atualizado: ATUAL, existente: f => r1.arquivos[f] || null });
  assert.match(r2.arquivos['categoria/b/index.html'], /name="robots" content="noindex,follow"/);
  assert.match(r2.arquivos['marca/y/index.html'], /Nenhum produto disponível/);
  assert.ok(!locs(r2.arquivos['sitemap.xml']).some(u => u.includes('/categoria/b/') || u.includes('/marca/y/')));
});
test('lastmod: só muda quando o conteúdo da URL muda; sem fonte confiável é omitido; relógio não gera commit', () => {
  const todos = Array.from({ length: 12 }, (_, i) => mk(i + 1));
  const r1 = gerar(todos, null, '2026-10-01T08:00:00Z');
  assert.doesNotMatch(r1.arquivos['sitemap.xml'], /<lastmod>/);                 // 1ª geração: sem histórico → omite
  const r2 = gerar(todos, r1.estado, '2026-10-02T09:00:00Z');                   // nada mudou, outra hora/dia
  assert.equal(r2.arquivos['sitemap.xml'], r1.arquivos['sitemap.xml']);
  assert.equal(r2.arquivos['data/seo-estado.json'], r1.arquivos['data/seo-estado.json']);
  const mud = todos.map(p => (p.id === '11' ? Object.assign({}, p, { name: 'Produto 11 renomeado', desc: 'Nova descrição do produto' }) : p));
  const r3 = G.planejar(mud, TPL, JSON.parse(r1.arquivos['produto/manifest.json']), { shell: SHELL, estado: r2.estado, atualizado: '2026-10-05T09:00:00Z', existente: () => null });
  const com = [...r3.arquivos['sitemap.xml'].matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)];
  assert.ok(com.length >= 1 && com.every(m => m[2] === '2026-10-05'));
  assert.ok(com.some(m => m[1].includes('produto-11-renomeado')));
  assert.ok(!com.some(m => m[1].includes('produto-5--')));                       // produto que não mudou continua sem lastmod
  const r4 = gerar(todos, r1.estado, '2026-10-02T09:00:00Z');
  assert.equal(r4.arquivos['sitemap.xml'], r2.arquivos['sitemap.xml']);          // determinístico
  assert.doesNotMatch(r1.arquivos['sitemap.xml'], /T\d\d:\d\d/);                 // nunca data/hora de build
});
test('bump de versão de assets não altera lastmod (hash normalizado)', () => {
  const todos = Array.from({ length: 12 }, (_, i) => mk(i + 1));
  const r1 = gerar(todos, null, '2026-10-01T08:00:00Z');
  const shell2 = SHELL.replace(/\?v=seo2-1/g, '?v=seo9-9'), tpl2 = TPL.replace(/\?v=seo2-1/g, '?v=seo9-9');
  const r2 = G.planejar(todos, tpl2, JSON.parse(r1.arquivos['produto/manifest.json']), { shell: shell2, estado: r1.estado, atualizado: '2026-10-09T08:00:00Z', existente: () => null });
  assert.equal(r2.arquivos['data/seo-estado.json'], r1.arquivos['data/seo-estado.json']);
});
test('URL antiga/renomeada: página de redirecionamento com noindex + canonical + meta refresh; 404 noindex', () => {
  const r1 = gerar([mk(1)]); const man = JSON.parse(r1.arquivos['produto/manifest.json']);
  const r2 = G.planejar([mk(1, { name: 'Outro nome' })].concat(Array.from({ length: 0 })), TPL, man, { shell: SHELL, estado: null, atualizado: ATUAL, existente: () => null });
  const stubs = Object.keys(r2.arquivos).filter(k => /http-equiv="refresh"/.test(r2.arquivos[k]));
  assert.equal(stubs.length, 1);
  assert.match(r2.arquivos[stubs[0]], /name="robots" content="noindex"/); assert.match(r2.arquivos[stubs[0]], /rel="canonical"/);
  assert.match(ler('404.html'), /name="robots" content="noindex"/);
});
test('workflow de sync versiona os novos artefatos; scripts e tests ficam dentro do catálogo', () => {
  const w = ler('.github/workflows/sync-produtos.yml');
  ['data/seo-estado.json', 'categoria/', 'marca/', 'index.html', 'sitemap.xml', 'robots.txt'].forEach(x => assert.ok(w.includes(x), x));
  assert.match(w, /node scripts\/gerar-paginas\.js/);
});
test('sem schema/analytics/IndexNow/Search Console nesta fase', () => {
  const todo = [A['index.html'], APP, ler('templates/produto.html')].join('\n');
  assert.doesNotMatch(todo, /ld\+json|gtag\(|googletagmanager|GTM-|indexnow|google-site-verification|msvalidate/i);
});
test('acessibilidade dos links estáticos: visíveis, sem display:none/offscreen', () => {
  const css = ler('css/catalogo.css');
  assert.doesNotMatch(css.slice(css.indexOf('.seo-lista')), /\.seo-(lista|contexto)[^{]*\{[^}]*(display:none|left:-\d|text-indent:-)/);
  assert.match(A['index.html'], /<nav aria-label="Categorias do catálogo">/);
  assert.match(A['index.html'], /<nav aria-label="Marcas do catálogo">/);
});
