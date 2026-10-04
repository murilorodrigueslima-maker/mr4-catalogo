'use strict';
// Performance/CLS: layout reservado antes do JS, fontes auto-hospedadas, prioridade da imagem LCP
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html'), APP = ler('js/catalogo-app.js'), CSS = ler('css/catalogo.css');
const R = G.planejar(BRUTOS, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-02T10:00:00Z', existente: () => null });
const A = R.arquivos;
const prep = n => C.prepararCatalogo(Array.from({ length: n }, (_, i) => ({ id: String(i + 1), ref: 'R' + i, name: 'P' + i, category: 'Cat', brand: 'M', price: 'R$ 1,00', stock: 2, img: 'https://x.test/' + i + '.jpg', desc: '' })));
const grid = h => h.match(/<div class="grade" id="grid" aria-busy="true">([\s\S]*?)<\/div>\s*(?:<script>[\s\S]*?<\/script>\s*)?<div class="load-more"/)[1];
const sk = h => (grid(h).match(/skeleton-card skel/g) || []).length;

test('esqueleto estático: a grade já nasce com altura reservada (rodapé/contexto não pulam quando o JS chega)', () => {
  assert.equal(sk(A['index.html']), 6);
  R.tax.categorias.concat(R.tax.marcas).forEach(t => {
    const f = (t.url.startsWith('/categoria') ? 'categoria/' : 'marca/') + t.slug + '/index.html';
    assert.equal(sk(A[f]), Math.min(6, t.itens.length), t.slug);
    assert.ok(A[f].includes(`data-n="${t.itens.length}"`), t.slug);
  });
  assert.match(APP, /parseInt\(document\.body\.dataset\.n, 10\)/);
  assert.match(APP, /Math\.min\(base, n\)/);
});
test('esqueleto com altura próxima à do card real (mobile 150 px; grade 340 px) — evita salto do conteúdo abaixo', () => {
  assert.match(CSS, /\.skeleton-card\{[^}]*height:150px\}/);
  assert.match(CSS, /@media\(min-width:641px\)\{\.skeleton-card\{height:340px\}\}/);
  assert.match(CSS, /\.lista-compacta \.skeleton-card\{height:56px/);                                 // modo Compacto mantém o esqueleto de linha
});
test('placeholder da linha de resultados: invisível, aria-hidden, só zeros (sem churn a cada sync), mesma estrutura do renderInfo', () => {
  const h = A['index.html'];
  assert.match(h, /<div class="result-info" id="resultInfo" role="status" aria-live="polite"><span class="ri-ph" aria-hidden="true"><span><strong>000<\/strong> produtos<\/span><\/span><\/div>/);
  assert.match(CSS, /\.ri-ph\{display:contents;visibility:hidden\}/);
  const m = A['categoria/moldura/index.html'].match(/<span class="ri-ph"[\s\S]*?<\/span><button[^>]*>Limpar filtros<\/button><\/span>/);
  assert.ok(m); assert.match(m[0], /<strong>0+<\/strong> produtos/); assert.match(m[0], /<span class="chip">Moldura<button type="button" tabindex="-1">✕<\/button><\/span>/);
  assert.doesNotMatch(m[0], /<strong>[1-9]/);
  assert.match(APP, /el\.innerHTML = `<span>\$\{texto\}<\/span>`/);                                      // o JS substitui o placeholder inteiro
  assert.match(G.paginaTaxonomia(SHELL, R.tax, 'categoria', { chave: 'X', rotulo: 'X', slug: 'x', url: '/categoria/x/', itens: [] }, true), /result-info/);
});
test('o placeholder não polui o conteúdo: sem texto visível nem no sitemap/JSON-LD; aria-hidden', () => {
  assert.doesNotMatch(Object.keys(A).filter(k => /^marca\//.test(k)).map(k => A[k].match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).join(''), /ri-ph|000/);
});
test('fontes auto-hospedadas: sem CSS/conexão de terceiros, arquivos reais woff2, licença OFL junto', () => {
  Object.keys(A).filter(k => /\.html$/.test(k)).forEach(k => assert.doesNotMatch(A[k], /fonts\.googleapis\.com|fonts\.gstatic\.com/, k));
  ['barlow-400-latin', 'barlow-600-latin', 'barlow-condensed-700-latin'].forEach(f => { const b = fs.readFileSync(path.join(RAIZ, `assets/fonts/${f}.woff2`)); assert.equal(b.slice(0, 4).toString(), 'wOF2'); assert.ok(b.length > 8000 && b.length < 40000); });
  assert.match(ler('assets/fonts/LICENSE.txt'), /SIL Open Font License/);
  assert.equal(((CSS.match(/@font-face\{[^}]+\}/g) || []).filter(f => /font-display:swap/.test(f))).length, 3);
});
test('fallback de fonte com largura ajustada (size-adjust) nas 3 faces e nas pilhas --f-body/--f-cond', () => {
  const fb = CSS.match(/@font-face\{font-family:'Barlow(?: Condensed)? Fallback'[^}]+\}/g) || [];
  assert.equal(fb.length, 3);
  fb.forEach(f => { assert.match(f, /size-adjust:\d+(\.\d+)?%/); assert.match(f, /local\('Arial/); const v = parseFloat(f.match(/size-adjust:([\d.]+)%/)[1]); assert.ok(v > 60 && v < 100); });
  assert.match(CSS, /--f-cond:'Barlow Condensed','Barlow Condensed Fallback',sans-serif/); assert.match(CSS, /--f-body:'Barlow','Barlow Fallback',system-ui,sans-serif/);
});
test('home em celular estreito: quebra determinística antes de "Visual/Compacto" (só home, só sem filtro, só ≤415 px)', () => {
  assert.match(CSS, /@media\(max-width:415px\)\{body\[data-pagina="home"\] \.barra:not\(:has\(\.chip,\.link-btn\)\) \.barra-quebra\{display:block;flex:0 0 100%;height:0\}body\[data-pagina="home"\] \.barra:not\(:has\(\.chip,\.link-btn\)\) \.modo\{margin-top:-6px\}\}/);
  assert.match(CSS, /\.barra-quebra\{display:none\}/);
  assert.equal((A['index.html'].match(/<span class="barra-quebra" aria-hidden="true"><\/span>/g) || []).length, 1);
  assert.ok(A['index.html'].indexOf('id="btnRapido"') < A['index.html'].indexOf('barra-quebra') && A['index.html'].indexOf('barra-quebra') < A['index.html'].indexOf('class="modo"'));
});
test('contexto institucional usa fonte do sistema (sem refluxo por troca de webfont em páginas curtas)', () => {
  assert.match(CSS, /\.seo-contexto\{[^}]*font-family:system-ui/);
});
test('modo Compacto salvo: script inline no HTML ajusta a grade ANTES do JS (esqueleto de linhas; sem salto do conteúdo abaixo)', () => {
  const h = A['index.html'];
  const m = h.match(/<script>try\{if\(localStorage\.getItem\("mr4_modo_catalogo"\)==="compacto"\)\{[\s\S]*?\}catch\(e\)\{\}<\/script>/);
  assert.ok(m);
  assert.ok(h.indexOf('id="grid"') < h.indexOf(m[0]) && h.indexOf(m[0]) < h.indexOf('class="load-more"'));
  assert.match(m[0], /className="lista-compacta"/); assert.match(m[0], /Math\.min\(16,n\)/); assert.match(m[0], /dataset\.modo="compacto"/);
  assert.match(APP, /const base = estado\.modo === 'compacto' \? 16 : 6;/);
  assert.equal((Object.keys(A).filter(k => /\.html$/.test(k) && /^(index\.html|categoria\/[^/]+\/index\.html|marca\/[^/]+\/index\.html)$/.test(k) && !/mr4_modo_catalogo/.test(A[k]))).length, 0);   // todas as páginas de catálogo têm o script
  assert.doesNotMatch(A['produto/' + C.prepararCatalogo(BRUTOS)[0].url.replace('/produto/', '') + 'index.html'], /mr4_modo_catalogo/);
});
test('LCP: 1ª imagem do grid sem lazy + fetchpriority=high; as seguintes acima da dobra sem lazy; o resto lazy', () => {
  const it = prep(8);
  const img = (e, o) => C.htmlCard(e, o).match(/<img [^>]*>/)[0];
  assert.match(img(it[0], { prioridade: 'alta' }), /fetchpriority="high"/); assert.doesNotMatch(img(it[0], { prioridade: 'alta' }), /loading=/);
  assert.doesNotMatch(img(it[1], { prioridade: 'eager' }), /loading=|fetchpriority/);
  assert.match(img(it[2], {}), /loading="lazy"/); assert.match(img(it[2], undefined), /loading="lazy"/);
  assert.match(APP, /prioridade: i === 0 \? 'alta' : \(i < \(mobile\(\) \? 2 : 4\) \? 'eager' : ''\)/);
  assert.match(APP, /cardHTML\(e, reiniciar \? i : 99\)/);                                             // "mostrar mais" nunca ganha prioridade
  assert.doesNotMatch(C.htmlLinha(it[0], {}), /<img/);                                                  // Compacto continua sem fotos
});
test('relacionados e produto: cards seguem lazy (sem prioridade) fora do grid', () => {
  assert.match(ler('js/produto-app.js'), /C\.htmlCard\(e, \{ qtd: Cesta\.qtdDe\(e\.p\.id\) \}\)/);
});
test('UX preservada: nenhuma regra de CSS nova esconde conteúdo real; nenhuma mudança em Visual/Compacto/Pedido Rápido/carrinho', () => {
  ['js/catalogo-rapido.js', 'js/catalogo-cesta.js'].forEach(f => assert.doesNotMatch(ler(f), /ri-ph|skeleton|prioridade/));
  assert.doesNotMatch(CSS.slice(CSS.indexOf('.ri-ph')), /\.ri-ph[^{]*\{[^}]*display:none/);
});
