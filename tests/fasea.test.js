'use strict';
// UX B2B — Fase A: shell, header, sidebar/sheets, card, fontes, cores (node --test tests/*.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const IDX = ler('index.html'), TPL = ler('templates/produto.html').replace('{{RODAPE}}', () => require('../scripts/entidade.js').rodape(true)), NF = ler('404.html');
const CSS = ler('css/catalogo.css'), CSSP = ler('css/produto.css');
const APP = ler('js/catalogo-app.js'), CESTA = ler('js/catalogo-cesta.js');
const mk = (o = {}) => C.prepararCatalogo([Object.assign({ id: '9', ref: 'AB-1', name: 'Produto X', category: 'Moldura', brand: 'Tiger', price: 'R$ 12,50', stock: 42, img: 'https://x/y.png', desc: '' }, o)])[0];

const lum = h => { h = h.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contraste = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const token = n => (CSS.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];

test('bloco institucional removido da área principal (sem hero, título, pills, contadores, marca d\'água)', () => {
  assert.doesNotMatch(IDX, /class="hero|hero-inner|hero-pill|hero-stats|stat-num|Catálogo Digital 2026|Acessórios\s*<br>|Para Revendedores|para Revendedores/i);
  assert.doesNotMatch(CSS, /\.hero|hero::after|\.stat-num/);
  assert.equal((IDX.match(/<footer>[\s\S]*<\/footer>/)[0].match(/Atendimento para todo o Brasil/g) || []).length, 1);            // aparece uma vez no rodapé, não 4×
  assert.match(IDX, /<footer>[\s\S]*Atacado B2B[\s\S]*Atendimento para todo o Brasil[\s\S]*CNPJ[\s\S]*<\/footer>/);
});
test('header B2B: sticky, 56–64 px, busca protagonista, atendimento e pedido; ids preservados', () => {
  assert.match(IDX, /<header class="topo">/);
  assert.match(CSS, /\.topo\{position:sticky;top:0;[^}]*height:var\(--topo\)/);
  const topo = Number((CSS.match(/--topo:(\d+)px/) || [])[1]); assert.ok(topo >= 56 && topo <= 64);
  assert.match(CSS, /@media\(max-width:640px\)\{\s*:root\{--topo:56px\}/);
  for (const id of ['searchInput', 'searchClear', 'btnContato', 'cartFab', 'cartBadge', 'logoTopo']) assert.match(IDX, new RegExp('id="' + id + '"'));
  assert.match(IDX, /placeholder="Busque produto, código, marca ou categoria"/);
  assert.match(IDX, /<label class="sr-only" for="searchInput">/);
  assert.match(IDX, /role="search"/);
  assert.match(CSS, /\.busca\{[^}]*max-width:760px/);
  assert.match(CSS, /\.search-input\{[^}]*height:44px/);
});
test('header idêntico no catálogo, nas páginas de produto e no 404 (busca envia ?q= ao catálogo)', () => {
  // única diferença permitida (SEO Fase 1): na home a marca do topo é o H1 (logo com alt estendido)
  const h = s => s.match(/<header class="topo">[\s\S]*?<\/header>/)[0].replace(/<h1 class="h1-logo">([\s\S]*?)<\/h1>/, '$1').replace('alt="MR4 Distribuidora — Catálogo B2B"', 'alt="MR4 Distribuidora"');
  assert.equal(h(IDX), h(TPL)); assert.equal(h(IDX), h(NF));
  assert.match(h(TPL), /<form class="busca"[^>]*action="\/"[^>]*method="get"/);
  assert.match(h(TPL), /name="q"/);
  const f = s => s.match(/<footer>[\s\S]*?<\/footer>/)[0];
  assert.equal(f(IDX), f(TPL)); assert.equal(f(IDX), f(NF));
});
test('navegação: sidebar (links reais ?cat=), marcas recolhíveis, controles mobile e bottom sheet acessível', () => {
  assert.match(IDX, /<aside class="lateral"/); assert.match(IDX, /<details class="marcas"/);
  assert.match(CSS, /\.lateral\{display:none\}/); assert.match(CSS, /@media\(min-width:1024px\)\{[^@]*\.lateral\{display:block;position:sticky;[^}]*overflow-y:auto/);
  assert.match(CSS, /grid-template-columns:240px minmax\(0,1fr\)/);
  assert.match(APP, /href="\$\{esc\(hrefPara\(c, ''\)\)\}"/);
  assert.match(APP, /'\/\?' \+ s/);
  assert.match(IDX, /id="btnCat"[\s\S]*id="btnMarca"[\s\S]*id="btnOrdem"/);
  assert.match(IDX, /class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTit"/);
  assert.match(IDX, /id="sheetClose" aria-label="Fechar"/);
  assert.match(CSS, /\.sheet-close\{width:44px;height:44px/); assert.match(CSS, /\.opt\{[^}]*min-height:48px/);
  assert.match(APP, /e\.key === 'Escape'[\s\S]{0,60}fecharSheet/);                 // Esc fecha
  assert.match(APP, /sheetOpener\.focus\(\)/);                                      // devolve o foco
  assert.match(APP, /name="sheetOpt"/);                                             // radios nativos (teclado/leitor de tela)
  assert.doesNotMatch(IDX, /cat-pill/);                                             // sem 28 pills
});
test('grade: colunas por largura (mobile 1 horizontal; tablet 3; 1024+ 4; 1500+ 5; 1900+ 6)', () => {
  assert.match(CSS, /\.grade\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(CSS, /@media\(min-width:641px\)\{[\s\S]*?\.grade\{grid-template-columns:repeat\(3,/);
  assert.match(CSS, /@media\(min-width:1024px\)\{[\s\S]*?\.grade\{grid-template-columns:repeat\(4,/);
  assert.match(CSS, /@media\(min-width:1500px\)\{\.grade\{grid-template-columns:repeat\(5,/);
  assert.match(CSS, /@media\(min-width:1900px\)\{\.grade\{grid-template-columns:repeat\(6,/);
  assert.match(CSS, /\.card\{[^}]*grid-template-columns:84px minmax\(0,1fr\)/);   // card horizontal no mobile, miniatura de 84 px
  assert.match(CSS, /\.card-img\{width:144px;height:144px/);                       // desktop: caixa 1:1
  assert.match(CSS, /\.card-img img\{[^}]*object-fit:contain/);
});
test('card B2B: hierarquia imagem → nome → código·marca → preço → estoque → ação; link real; sem onclick', () => {
  const e = mk();
  const h = C.htmlCard(e, { naCesta: false });
  const pos = s => h.indexOf(s);
  const ordem = ['card-img', 'card-name', 'card-cod', 'card-preco', 'card-estoque', 'btn-add-cart'].map(pos);
  assert.ok(ordem.every(x => x > 0)); assert.deepEqual(ordem, ordem.slice().sort((a, b) => a - b));
  assert.match(h, /<a class="card-open" href="\/produto\/produto-x--ab-1\/" title="Produto X" data-produto="9">Produto X<\/a>/);
  assert.match(h, /Cód\. <b>AB-1<\/b> · Tiger/);
  assert.match(h, /<span class="card-preco">R\$ 12,50<\/span>/);
  assert.match(h, /card-estoque ok">42 em estoque/);
  assert.match(h, /data-add="9"[^>]*>Adicionar<\/button>/);                 // Fase B: stepper + Adicionar
  assert.doesNotMatch(h, /onclick|JSON/);
  assert.match(C.htmlCard(e, { qtd: 4 }), /btn-add-cart added"[^>]*>✓ No pedido/);
  assert.doesNotMatch(C.htmlCard(e, { acao: false }), /btn-add-cart/);
  assert.match(C.htmlCard(mk({ stock: 3 })), /card-estoque low">Últimas 3 unid\./);
  assert.match(C.htmlCard(mk({ stock: 0 })), /card-estoque out">Sem estoque/);
  assert.doesNotMatch(C.htmlCard(mk({ brand: '' })), /Cód\. <b>AB-1<\/b> ·/);               // sem marca: sem separador solto
  assert.match(C.htmlCard(mk({ img: '' })), /<div class="card-img"><svg/);                  // fallback sem foto
  assert.match(C.htmlCard(mk({ category: 'PRODUTOS SEM GRUPO' })), /card-name/);
});
test('card: preço e dados idênticos ao JSON; ataque HTML escapado', () => {
  const bruto = JSON.parse(ler('data/produtos.json')).produtos.slice(0, 40);
  C.prepararCatalogo(bruto).forEach((e, i) => {
    const h = C.htmlCard(e);
    assert.ok(h.includes('<span class="card-preco">' + C.esc(bruto[i].price) + '</span>'));
    assert.ok(h.includes('Cód. <b>' + C.esc(bruto[i].ref) + '</b>'));
    assert.ok(h.includes(String(bruto[i].stock)));
  });
  const ataque = '<img src=x onerror=alert(1)>"\'';
  const h = C.htmlCard(mk({ name: ataque, ref: ataque, brand: ataque, price: ataque, img: 'https://x/"><script>alert(2)</script>' }));
  assert.doesNotMatch(h.replace(/"[^"]*"/g, '""'), /<img src=x|<script/i);
});
test('cores: preço e nome em texto escuro (não laranja); laranja só em ação primária/estado ativo; contrastes ≥ 4,5:1', () => {
  assert.match(CSS, /\.card-preco\{[^}]*color:var\(--ink\)/); assert.doesNotMatch(CSS.match(/\.card-preco\{[^}]*\}/)[0], /orange/);
  assert.match(CSS, /\.card-name\{[^}]*color:var\(--ink\)/);
  const branco = '#ffffff';
  assert.ok(contraste(token('orange-btn'), branco) >= 4.5);
  assert.ok(contraste(token('orange-ink'), branco) >= 4.5);
  assert.ok(contraste(token('muted'), branco) >= 4.5);
  assert.ok(contraste(token('green'), branco) >= 4.5); assert.ok(contraste(token('amber'), branco) >= 4.5); assert.ok(contraste(token('red'), branco) >= 4.5);
  assert.ok(contraste(token('ink'), branco) >= 12);
  assert.match(CSS, /\.btn-add-cart\{[^}]*background:var\(--orange-btn\)/);
  assert.match(CSS, /\.fbtn\.ativo\{[^}]*orange-ink/); assert.match(CSS, /\.chip\{[^}]*orange-ink/);
});
test('alvos de toque ≥ 44 px nos controles principais e sem fontes < 12 px', () => {
  for (const re of [/\.search-input\{[^}]*height:44px/, /\.fbtn\{[^}]*min-height:44px/, /\.btn-add-cart\{[^}]*min-height:44px/, /\.btn-pedido[^{]*\{[^}]*min-height:44px/, /\.sheet-close\{width:44px;height:44px/]) assert.match(CSS, re);
  const tamanhos = [...CSS.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)].map(m => (m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])));
  assert.ok(Math.min(...tamanhos) >= 12, 'menor fonte: ' + Math.min(...tamanhos));
});
test('fontes: só os pesos usados (Barlow 400/600 + Barlow Condensed 700), auto-hospedadas (sem CSS de terceiros bloqueando), sem JetBrains Mono', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'css/catalogo.css'), 'utf8');
  for (const s of [IDX, TPL, NF]) {
    assert.doesNotMatch(s, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.doesNotMatch(s, /rel="preload"[^>]*fonts/);                                                 // sem preload: medido, disputa banda com CSS/JS/JSON em rede lenta e não melhora o LCP
  }
  const faces = (css.match(/@font-face\{[^}]+\}/g) || []).filter(f => /url\(/.test(f));          // as 3 faces reais (os fallbacks com size-adjust usam local())
  assert.equal(faces.length, 3);
  assert.ok(faces.some(f => /'Barlow Condensed'/.test(f) && /font-weight:700/.test(f)));
  assert.ok(faces.some(f => /'Barlow'/.test(f) && /font-weight:400/.test(f))); assert.ok(faces.some(f => /'Barlow'/.test(f) && /font-weight:600/.test(f)));
  faces.forEach(f => { assert.match(f, /font-display:swap/); const u = f.match(/url\((\/assets\/fonts\/[^)]+)\)/)[1]; assert.ok(fs.existsSync(path.join(RAIZ, u)), u); });
  assert.doesNotMatch(css, /JetBrains/);
});
test('catálogo e páginas de produto usam as mesmas versões de css/js; versões novas (cache)', () => {
  const v = s => (s.match(/catalogo\.css\?v=([\w-]+)/) || [])[1];
  assert.equal(v(IDX), v(TPL)); assert.equal(v(IDX), v(NF)); assert.match(v(IDX), /^(fase[ABCD]|seo\d|perf\d|ent\d|ga\d)-/);
  assert.match(IDX, /catalogo-app\.js\?v=(fase[ABCD]|seo\d|perf\d|ent\d|ga\d)-/); assert.match(TPL, /produto-app\.js\?v=(fase[ABCD]|seo\d|perf\d|ent\d|ga\d)-/);
});
test('lógica comercial preservada: busca usa o núcleo; carrinho no mesmo formato; vendedores/telefones intactos', () => {
  assert.match(APP, /C\.consultar\(itens, estado, destaqueIds\)/);
  assert.doesNotMatch(APP, /\.includes\(|norm\(/);                       // a interface não reimplementa busca
  assert.match(CESTA, /mr4_carrinho/); assert.match(CESTA, /558596098520/); assert.match(CESTA, /558591194961/); assert.match(CESTA, /\(85\) 96098-520/);
  assert.match(APP, /fetch\('\/data\/produtos\.json', \{ cache: 'no-cache' \}\)/);
  assert.match(APP, /\?r=1|'r'\) === '1'/);                              // retorno com estado
  assert.match(IDX, /sync-badge/);                                       // atualização movida para o rodapé
});
test('fora do escopo até a Fase B: modo compacto, pedido rápido, filtro de preço, login', () => {
  const tudo = IDX + APP + CESTA + CSS;
  assert.doesNotMatch(tudo, /modo-compacto|pedido-rapido|faixa-preco|filtro-preco|login|checkout|pagamento/i);
});
