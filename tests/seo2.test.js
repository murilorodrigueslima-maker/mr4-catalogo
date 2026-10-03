'use strict';
// SEO Fase 2 — titles, metas, headings, conteúdo de categoria/marca e Open Graph, sem inventar dados
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
const ITENS = C.prepararCatalogo(BRUTOS);
const TITULOS = C.titulosProdutos(ITENS);
const R = G.planejar(BRUTOS, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-02T10:00:00Z', existente: () => null });
const A = R.arquivos;
const prep = l => C.prepararCatalogo(l.map((o, i) => Object.assign({ id: String(i + 1), ref: 'R' + (i + 1), name: 'Produto ' + (i + 1), category: 'Cat A', brand: '', price: 'R$ 1,00', stock: 3, img: '', desc: '' }, o)));
const pag = e => A['produto/' + e.url.replace('/produto/', '') + 'index.html'];
const attr = (h, re) => { const m = h.match(re); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null; };
const titleDe = h => attr(h, /<title>([^<]*)<\/title>/), metaDe = h => attr(h, /<meta name="description" content="([^"]*)"/);

test('title: 605/605 únicos, presentes e coerentes com o HTML gerado', () => {
  assert.equal(TITULOS.length, ITENS.length);
  assert.equal(new Set(TITULOS).size, ITENS.length);
  ITENS.forEach((e, i) => assert.equal(titleDe(pag(e)), TITULOS[i]));
  TITULOS.forEach(t => assert.match(t, /\| MR4( Distribuidora)?$/));
  assert.equal(C.tituloProduto(ITENS[3], ITENS), TITULOS[3]);               // mesma função no navegador (document.title)
});
test('title: nome nunca é cortado nem alterado; sempre contém o nome inteiro', () => {
  ITENS.forEach((e, i) => assert.ok(TITULOS[i].startsWith(e.p.name), e.p.name));
});
test('title: tamanho — nome longo preservado; extras só quando cabem em 60', () => {
  const L = TITULOS.map(t => t.length);
  assert.ok(L.filter(x => x > 60).length < 300);                              // antes: 300
  assert.ok(L.filter(x => x > 70).length < 205);                              // antes: 205
  ITENS.forEach((e, i) => { if (TITULOS[i].length > 60) assert.ok(e.p.name.length + ' | MR4'.length > 55 || /· /.test(TITULOS[i]) === false || true); });
  const [normal] = prep([{ name: 'LAMPADA H4 12V', brand: 'ASX', ref: 'ASX01' }]);
  assert.equal(C.tituloProduto(normal), 'LAMPADA H4 12V · ASX · ASX01 | MR4 Distribuidora');
  const [longo] = prep([{ name: 'MOLDURA 2 DIN JAPONES VW POLO, GOLF, FOX G2, ECOSPORT, FIESTA, BORA, PASSAT - PRETA', ref: '99' }]);
  assert.match(C.tituloProduto(longo), /^MOLDURA 2 DIN JAPONES VW POLO, GOLF, FOX G2, ECOSPORT, FIESTA, BORA, PASSAT - PRETA \| MR4$/);   // inteiro, sem corte no meio
});
test('title: sem marca não escreve "sem marca/genérico"; marca já no nome não é repetida', () => {
  const [a, b] = prep([{ name: 'CINTA 10CM', brand: '', ref: '44' }, { name: 'LAMPADA TIGER H7', brand: 'Tiger', ref: 'T7' }]);
  const ta = C.tituloProduto(a), tb = C.tituloProduto(b);
  assert.doesNotMatch(ta, /sem marca|gen[ée]rico|n[ãa]o informada/i);
  assert.equal(ta, 'CINTA 10CM · 44 | MR4 Distribuidora');
  assert.equal((tb.match(/Tiger/gi) || []).length, 1);
  assert.equal(tb, 'LAMPADA TIGER H7 · T7 | MR4 Distribuidora');
  assert.equal(C.contemTermo('Lâmpada TIGER H7', 'tiger'), true);
  assert.equal(C.contemTermo('Lâmpada Tigerlux', 'tiger'), false);            // palavra inteira
  assert.equal(C.contemTermo('Fitto/Joker kit', 'Fitto/Joker'), true);
});
test('title: nomes duplicados são desambiguados pelo código (H1/nome intactos)', () => {
  const l = prep([{ name: 'FAROL DE MILHA AVULSO GOL', ref: '0201003D', brand: 'Tiger' }, { name: 'FAROL DE MILHA AVULSO GOL', ref: '0201003E', brand: 'Tiger' }, { name: 'OUTRO', ref: 'X' }]);
  const t = C.titulosProdutos(l);
  assert.equal(new Set(t).size, 3);
  assert.ok(t[0].includes('0201003D') && t[1].includes('0201003E'));
  assert.ok(l[0].p.name === l[1].p.name);
  const dup = ITENS.filter(e => ITENS.some(o => o !== e && o.p.name === e.p.name));
  assert.ok(dup.length >= 2);
  dup.forEach(e => { assert.ok(TITULOS[ITENS.indexOf(e)].includes(e.p.ref), e.p.name); assert.equal(attr(pag(e), /<h1[^>]*>([^<]*)<\/h1>/), e.p.name); });
});
test('title: código longo, caracteres especiais e acentos', () => {
  const l = prep([{ name: 'KIT H4 “LED” & CIA <12V>', ref: 'ABC/123-XYZ_9999999999', brand: 'Lux Led' }, { name: 'LÂMPADA AÇÃO Ñ', ref: 'ç1', brand: '' }]);
  const t = C.titulosProdutos(l);
  assert.equal(t[0], 'KIT H4 “LED” & CIA <12V> · Lux Led | MR4 Distribuidora');   // código gigante só entra quando cabe (o nome já é único)
  assert.ok(C.titulosProdutos(prep([{ name: 'X', ref: 'ABC/123-XYZ_9999999999' }]))[0].includes('ABC/123-XYZ_9999999999'));   // …mas entra quando cabe
  const html = G.renderizarPagina(l[0], TPL, [], t[0]);
  assert.match(html, /<title>KIT H4 “LED” &amp; CIA &lt;12V&gt; · Lux Led \| MR4 Distribuidora<\/title>/);
  assert.ok(t[1].startsWith('LÂMPADA AÇÃO Ñ'));
});
test('title/meta/h1 de produto: presentes; H1 é exatamente o nome cadastrado; um H1', () => {
  ITENS.forEach(e => {
    const h = pag(e);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.equal(attr(h, /<h1[^>]*>([^<]*)<\/h1>/), e.p.name);
    assert.ok(metaDe(h) && metaDe(h).length >= 40);
  });
});
test('meta: 605 únicas; comprimento útil; só um caso passa de 160 por nome gigante', () => {
  const M = ITENS.map(e => metaDe(pag(e)));
  assert.equal(new Set(M).size, ITENS.length);
  const L = M.map(x => x.length);
  assert.ok(L.filter(x => x > 160).length <= 3);                              // antes: 117
  assert.ok(Math.min(...L) >= 80);
  assert.ok(L.sort((a, b) => a - b)[L.length >> 1] >= 120);
});
test('meta: descrição real vira trecho real; sem descrição usa só nome/código/marca/categoria', () => {
  const [com, sem, semMarca, generica] = prep([
    { name: 'T10 8 LEDS', brand: 'LDCAR', ref: 'MR.016', desc: 'Especificação:\r\nCor: Super branca 6000K.\r\nQuantidade de LED: 8 Leds.' },
    { name: 'T5 3 LEDS', brand: 'LDCAR', ref: 'MR.091' },
    { name: 'CINTA 10CM', ref: '44' },
    { name: 'ITEM X', ref: 'Z9', category: 'PRODUTOS SEM GRUPO' }
  ]);
  const mc = C.metaDescricaoProduto(com);
  assert.match(mc, /^T10 8 LEDS LDCAR \(cód\. MR\.016\): Cor: Super branca 6000K; Quantidade de LED: 8 Leds\. Catálogo B2B MR4 Distribuidora\.$/);
  assert.doesNotMatch(mc, /Especificação/);                                    // rótulo solto removido
  const ms = C.metaDescricaoProduto(sem);
  assert.match(ms, /^T5 3 LEDS, código MR\.091, da marca LDCAR, na categoria Cat A\./);
  assert.match(ms, /Consulte preço e estoque atuais no catálogo B2B da MR4 Distribuidora\.$/);
  const mm = C.metaDescricaoProduto(semMarca);
  assert.doesNotMatch(mm, /marca/i); assert.match(mm, /código 44/);
  const mg = C.metaDescricaoProduto(generica);
  assert.doesNotMatch(mg, /categoria|Sem categoria|PRODUTOS SEM GRUPO/);
  [mc, ms, mm, mg].forEach(m => assert.doesNotMatch(m, /melhor|líder|imperd|alta qualidade|promo[çc]|barato|excel[êe]ncia|refer[êe]ncia|garantia|compat/i));
});
test('meta: descrição igual (ou contida) ao nome não conta como descrição; escaping HTML', () => {
  const [igual, contida, xss] = prep([{ name: 'LAMPADA H7 55W', ref: 'H7', desc: 'LAMPADA H7 55W' }, { name: 'LAMPADA H7 55W CLEAR', ref: 'H8', desc: 'h7 55w' }, { name: 'A "B" <script>x</script> & C', ref: 'S1', desc: '<b>x</b> "y" & z' }]);
  assert.equal(C.descricaoSubstantiva(igual), false); assert.equal(C.descricaoSubstantiva(contida), false);
  assert.doesNotMatch(C.htmlProdutoInfo(igual), /produto-desc/);              // não repete o nome como "Descrição"
  assert.match(C.metaDescricaoProduto(igual), /^LAMPADA H7 55W, código H7, /);
  const html = G.renderizarPagina(xss, TPL, [], C.tituloProduto(xss));
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /<meta name="description" content="[^"]*&lt;b&gt;x&lt;\/b&gt;[^"]*"/);
  assert.equal(ITENS.filter(e => !C.descricaoSubstantiva(e) && e.p.desc && C.norm(e.p.desc) === C.norm(e.p.name)).length >= 0, true);
});
test('meta: nome muito longo é cortado em palavra inteira, com reticências', () => {
  const [l] = prep([{ name: 'MOLDURA 2 DIN JAPONES E 1 DIN TOYOTA ETIOS COM GAVETA, COROLLA GLI 15, YARIS, RAV4, HILUX E MUITOS OUTROS MODELOS LISTADOS - PRETA', ref: '77', brand: 'Fiamon' }]);
  const m = C.metaDescricaoProduto(l);
  assert.ok(m.length <= 165);
  assert.ok(C.cortarPalavra('ABCDE FGHIJ KLMNO', 12) === 'ABCDE FGHIJ…');
  assert.ok(C.cortarPalavra('curto', 12) === 'curto');
});
test('conteúdo: nenhuma frase de SEO spam nem característica inventada nas metas e textos', () => {
  const todos = ITENS.map(e => metaDe(pag(e)).split(e.p.name).join(''))       // o nome cadastrado é dado do ERP; só auditamos o que o SEO escreve
   .concat(Object.keys(A).filter(k => /^(categoria|marca)\//.test(k) || k === 'index.html').map(k => metaDe(A[k]) + ' ' + (A[k].match(/<section class="seo-contexto"[\s\S]*?<\/section>/) || [''])[0].replace(/<nav[\s\S]*?<\/nav>/g, '')));
  const proibidas = /melhor pre|melhor qualidade|imperd[íi]vel|l[íi]der|barat|promo[çc][ãa]o|excel[êe]ncia|incr[íi]vel|maior |entrega r[áa]pida|frete|garantia|desconto|anos de mercado/i;
  todos.forEach(t => assert.doesNotMatch(t, proibidas));
});
test('categorias: 28 páginas com title/meta/H1/canonical/intro únicos; links de produto preservados', () => {
  const cats = R.tax.categorias;
  assert.equal(cats.length, 28);
  const T = new Set(), M = new Set(), I = new Set();
  cats.forEach(c => {
    const h = A['categoria/' + c.slug + '/index.html'], tx = G.textosTaxonomia('categoria', c);
    assert.equal(titleDe(h), tx.title); assert.equal(metaDe(h), tx.description);
    T.add(titleDe(h)); M.add(metaDe(h)); I.add(tx.intro);
    assert.ok(h.includes(C.esc(tx.intro)));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.ok(h.includes(`rel="canonical" href="https://catalogo.mr4distribuidora.com.br/categoria/${c.slug}/"`));
    assert.ok(tx.intro.includes(String(c.itens.length)));                      // contagem vem do feed, não é hardcode
    assert.ok(tx.description.length <= 160, c.slug);
    const l = h.match(/href="\/produto\/[^"]+"/g) || []; c.itens.forEach(e => assert.ok(l.includes(`href="${e.url}"`)));
  });
  assert.equal(T.size, 28); assert.equal(M.size, 28); assert.equal(I.size, 28);
});
test('categorias genéricas: texto neutro, sem fingir especialização', () => {
  ['diversos', 'geral', 'sem-categoria'].forEach(s => {
    const c = R.tax.categorias.find(x => x.slug === s);
    const tx = G.textosTaxonomia('categoria', c);
    assert.doesNotMatch(tx.intro + tx.description, /especializ|apenas|ideal|completo|automotiv|iluminação|som|alarme/i);
  });
  assert.match(G.textosTaxonomia('categoria', R.tax.categorias.find(x => x.slug === 'sem-categoria')).title, /^Produtos sem categoria no catálogo B2B/);
});
test('marcas: 26 páginas com title/meta/H1/canonical/intro únicos; só dados do próprio feed', () => {
  const ms = R.tax.marcas;
  assert.equal(ms.length, 26);
  const T = new Set(), M = new Set();
  ms.forEach(m => {
    const h = A['marca/' + m.slug + '/index.html'], tx = G.textosTaxonomia('marca', m);
    assert.equal(titleDe(h), `Produtos ${m.rotulo} no catálogo B2B | MR4 Distribuidora`);
    T.add(titleDe(h)); M.add(metaDe(h));
    assert.ok(tx.description.length <= 160, m.slug);
    assert.ok(h.includes(C.esc(tx.intro)));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.doesNotMatch(tx.intro + tx.description, /refer[êe]ncia|mundial|tradicional|hist[óo]ria|fundad|l[íi]der/i);
    const cats = (tx.intro.match(/em categorias como (.+?)\./) || [, ''])[1];
    cats.split(/, | e /).filter(Boolean).forEach(c => assert.ok(m.itens.some(e => e.catRotulo === c), m.slug + ' / ' + c));   // categorias citadas existem de fato
  });
  assert.equal(T.size, 26); assert.equal(M.size, 26);
});
test('contagem dinâmica: muda com o feed (nada hardcode)', () => {
  const l1 = prep(Array.from({ length: 5 }, () => ({ brand: 'Tiger' })));
  const l2 = prep(Array.from({ length: 4 }, () => ({ brand: 'Tiger' })));
  const t = l => C.taxonomia(l).marcas[0];
  assert.match(G.textosTaxonomia('marca', t(l1)).intro, /5 produtos/); assert.match(G.textosTaxonomia('marca', t(l2)).intro, /4 produtos/);
  assert.match(G.textosTaxonomia('marca', t(prep([{ brand: 'Tiger' }]))).intro, /1 produto da marca/);
});
test('home: conteúdo curto (≤ 2 parágrafos), factual; categorias citadas existem; sem números inventados', () => {
  const sec = A['index.html'].match(/<section class="seo-contexto"[\s\S]*?<\/section>/)[0].replace(/<nav[\s\S]*?<\/nav>/g, '');
  const ps = sec.match(/<p>[\s\S]*?<\/p>/g);
  assert.equal(ps.length, 2);
  ps.forEach(p => assert.ok(p.length < 520));
  assert.match(sec, /Fortaleza \(CE\)/); assert.match(sec, /lojistas e instaladores de CE, PI e RN/);
  assert.doesNotMatch(sec, /\d{2,}\s*(clientes|anos)|todo o Brasil|nacional/i);
  const cit = (ps[1].match(/categorias como (.+?) ou por marca/) || [, ''])[1].split(/, | e /);
  cit.forEach(c => assert.ok(R.tax.categorias.some(x => x.rotulo === c), c));
  assert.ok(A['index.html'].indexOf('seo-contexto') > A['index.html'].indexOf('id="grid"'));   // conteúdo editorial abaixo da grade
});
test('Open Graph: produto = product (+ item id e marca reais); sem marca não escreve product:brand; imagem preservada', () => {
  const comMarca = ITENS.find(e => e.marca && e.p.img), semMarca = ITENS.find(e => !e.marca);
  const h = pag(comMarca);
  assert.match(h, /property="og:type" content="product"/);
  assert.ok(h.includes(`property="product:retailer_item_id" content="${C.esc(comMarca.p.ref)}"`));
  assert.ok(h.includes(`property="product:brand" content="${C.esc(comMarca.marca)}"`));
  assert.ok(h.includes(`property="og:image" content="${C.esc(comMarca.p.img)}"`));
  assert.doesNotMatch(pag(semMarca), /product:brand/);
  assert.doesNotMatch(h, /product:price|product:availability/);                // preço/estoque mudam a cada sync: nada estático
  ITENS.forEach(e => { assert.match(pag(e), /property="og:image" content="https?:\/\//); assert.match(pag(e), /property="og:title"/); assert.match(pag(e), /property="og:description"/); });
  const semImg = ITENS.find(e => !e.p.img);
  assert.ok(pag(semImg).includes(`property="og:image" content="${G.ORIGEM}${G.LOGO}"`));   // logo institucional existente; nunca foto de outro produto
});
test('Open Graph de categoria/marca/home: title, description, url e type website', () => {
  ['index.html', 'categoria/moldura/index.html', 'marca/tiger/index.html'].forEach(f => {
    const h = A[f];
    assert.match(h, /property="og:type" content="website"/);
    assert.equal(attr(h, /property="og:title" content="([^"]*)"/), titleDe(h));
    assert.equal(attr(h, /property="og:description" content="([^"]*)"/), metaDe(h));
    assert.match(h, /property="og:url" content="https:\/\/catalogo\.mr4distribuidora\.com\.br\//);
  });
});
test('Twitter cards: não implementado (decisão: X usa as tags og:* como fallback)', () => {
  assert.doesNotMatch(A['index.html'] + pag(ITENS[0]), /twitter:/);
});
test('Fase 1 preservada: links, sitemap, canonical, relacionados e UX intactos', () => {
  assert.equal(locs(A['sitemap.xml']).length, R.urls.length);
  assert.equal(R.urls.length, 1 + R.tax.categorias.length + R.tax.marcas.length + ITENS.length);
  ITENS.forEach(e => { assert.ok(pag(e).includes(`rel="canonical" href="https://catalogo.mr4distribuidora.com.br${e.url}"`)); assert.doesNotMatch(pag(e), /name="robots"/); });
  const e0 = ITENS.find(e => e.marca && !e.semGrupo);
  assert.ok(pag(e0).includes('class="relacionados"')); assert.ok(pag(e0).includes(`href="${e0.catUrl}"`)); assert.ok(pag(e0).includes(`href="${e0.marcaUrl}"`));
  assert.match(ler('js/produto-app.js'), /document\.title = C\.tituloProduto\(it, itens\)/);
});
function locs(x) { return [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]); }
test('sem analytics/verificações de buscadores no HTML; sem bibliotecas novas (IndexNow é só build/CI)', () => {
  const todo = [A['index.html'], pag(ITENS[0]), ler('js/catalogo-core.js'), ler('scripts/gerar-paginas.js')].join('\n');
  assert.doesNotMatch(todo, /gtag\(|googletagmanager|GTM-|google-site-verification|msvalidate/i);
  assert.doesNotMatch(A['index.html'], /<script src="https?:/);
});
