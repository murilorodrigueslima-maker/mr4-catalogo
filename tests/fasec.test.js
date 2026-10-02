'use strict';
// UX B2B — Fase C: modo compacto (lista densa, sem fotos) coexistindo com o modo visual
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const APP = ler('js/catalogo-app.js'), CSS = ler('css/catalogo.css'), IDX = ler('index.html'), CESTA = ler('js/catalogo-cesta.js');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const ITENS = C.prepararCatalogo(BRUTOS);
const mk = (o = {}) => C.prepararCatalogo([Object.assign({ id: '9', ref: 'AB-1', name: 'Produto X', category: 'Moldura', brand: 'Tiger', price: 'R$ 12,50', stock: 42, img: 'https://x/y.png', desc: '' }, o)])[0];

test('modo: valores válidos, fallback para visual com chave ausente/inválida', () => {
  assert.deepEqual(C.MODOS, ['visual', 'compacto']);
  ['visual', 'compacto'].forEach(m => assert.equal(C.normalizarModo(m), m));
  [null, undefined, '', 'lixo', 'COMPACTO', 'tabela', 42, {}].forEach(v => assert.equal(C.normalizarModo(v), 'visual'));
  assert.match(APP, /const CHAVE_MODO = 'mr4_modo_catalogo'/);
  assert.match(APP, /localStorage\.getItem\(CHAVE_MODO\)/); assert.match(APP, /localStorage\.setItem\(CHAVE_MODO, novo\)/);
  assert.match(APP, /try \{ return C\.normalizarModo\(localStorage\.getItem\(CHAVE_MODO\)\); \} catch \(e\) \{ return 'visual'; \}/);   // storage bloqueado → visual
  assert.match(APP, /modo: lerModo\(\)/);                                                                  // lido ANTES da 1ª renderização
});
test('linha compacta: link real, código, marca, estoque, preço, quantidade; semântica de lista; sem <img>', () => {
  const h = C.htmlLinha(mk({ stock: 2187 }), { qtd: 0 });
  assert.match(h, /role="listitem"/);
  assert.match(h, /<h3 class="l-nome"><a class="l-link" href="\/produto\/produto-x--ab-1\/" title="Produto X" data-produto="9">Produto X<\/a><\/h3>/);
  assert.match(h, /Cód\. <\/span><b>AB-1<\/b>/); assert.match(h, /<span class="l-marca">Tiger<\/span>/);
  assert.match(h, /<span class="l-est ok">2187 em estoque<\/span>/);
  assert.match(h, /<span class="l-preco">R\$ 12,50<\/span>/);
  assert.match(h, /class="acao acao--compacta"/); assert.match(h, /class="qb"/); assert.match(h, /class="qi"/); assert.match(h, /data-add="9"/);
  assert.doesNotMatch(h, /<img|onclick|JSON/);
  assert.doesNotMatch(C.htmlLinha(mk({ img: '' })), /<img/);
  assert.equal(C.htmlLinha(mk(), {}).includes('<img'), false);
});
test('linha compacta: mesmo componente de quantidade; estado "No pedido"; estoque sem urgência artificial', () => {
  const sem = C.htmlLinha(mk(), { qtd: 0 }), com = C.htmlLinha(mk(), { qtd: 4 });
  assert.match(sem, />Adicionar<\/button>/); assert.match(com, /class="acao no-pedido acao--compacta"/); assert.match(com, /value="4"/); assert.match(com, /✓ No pedido/);
  assert.match(C.htmlLinha(mk({ stock: 3 })), /l-est low">3 em estoque/); assert.match(C.htmlLinha(mk({ stock: 0 })), /l-est out">Sem estoque/);
  assert.doesNotMatch(C.htmlLinha(mk({ stock: 3 })), /últim|corra|restam|só/i);
  assert.equal(C.htmlAcao(mk().p, 2, 'acao--compacta').replace(/ acao--compacta/, ''), C.htmlAcao(mk().p, 2, ''));     // idêntico ao modo visual, só muda a classe
});
test('produto sem marca: sem "undefined"/"null"/separador solto; HTML escapado', () => {
  const h = C.htmlLinha(mk({ brand: '' }));
  assert.match(h, /<span class="l-marca"><\/span>/); assert.doesNotMatch(h, /undefined|null|l-marca-inline| · /);
  const x = '<img src=x onerror=alert(1)>"\'';
  const a = C.htmlLinha(mk({ name: x, ref: x, brand: x, price: x }));
  assert.doesNotMatch(a.replace(/"[^"]*"/g, '""'), /<img|<script/i);
});
test('GOLDEN real: 605 linhas sem <img>, sem undefined/null; links únicos iguais aos do modo visual', () => {
  const html = ITENS.map(e => C.htmlLinha(e, { qtd: 0 }));
  assert.equal(html.filter(h => /<img/.test(h)).length, 0);
  assert.equal(html.filter(h => /undefined|null|NaN/.test(h)).length, 0);
  const hrefs = html.map(h => (h.match(/class="l-link" href="([^"]+)"/) || [])[1]);
  assert.equal(new Set(hrefs).size, ITENS.length);
  hrefs.forEach((u, i) => assert.equal(u, ITENS[i].url));
  assert.equal(hrefs.filter((u, i) => C.htmlCard(ITENS[i], {}).includes('href="' + u + '"')).length, ITENS.length);
  ITENS.forEach((e, i) => { assert.ok(html[i].includes('>' + C.esc(e.p.price) + '<')); assert.ok(html[i].includes('<b>' + C.esc(e.p.ref) + '</b>')); });
});
test('o modo NÃO altera busca/filtros/ordenação: mesma consulta, mesmos resultados (golden)', () => {
  const g = [['lâmpada', 110], ['câmera', 6], ['alto-falante', 23], ['led h4', 9], ['h4 led', 9], ['tiger', 61], ['permak', 55], ['ldcar', 58]];
  g.forEach(([q, n]) => {
    const v = C.consultar(ITENS, { q, modo: 'visual' }), c = C.consultar(ITENS, { q, modo: 'compacto' });
    assert.equal(v.total, n); assert.equal(c.total, n);
    assert.deepEqual(c.lista.map(e => e.p.id), v.lista.map(e => e.p.id));
  });
  assert.equal(C.consultar(ITENS, { cat: 'Moldura', modo: 'compacto' }).total, 93);
  assert.equal(C.consultar(ITENS, { cat: 'Moldura', marca: 'Fiamon', modo: 'compacto' }).total, 47);
  for (const sort of ['az', 'za', 'menor-preco', 'maior-preco', 'maior-estoque']) {
    assert.deepEqual(C.consultar(ITENS, { q: 'led', sort, modo: 'compacto' }).lista.map(e => e.p.id), C.consultar(ITENS, { q: 'led', sort, modo: 'visual' }).lista.map(e => e.p.id), sort);
  }
  // a interface usa a MESMA consulta; não reimplementa busca nem preço/estoque
  assert.match(APP, /C\.consultar\(itens, estado, destaqueIds\)/); assert.doesNotMatch(APP, /\.includes\(|norm\(|precoCentavos|resolverPedido/);
});
test('troca de modo no cliente: sem recarregar, sem nova consulta, mantém lote/posição; um só catálogo/carrinho', () => {
  assert.match(APP, /function trocarModo\(novo\)/);
  const corpo = APP.slice(APP.indexOf('function trocarModo'), APP.indexOf('/* ───────── estado da navegação'));
  assert.doesNotMatch(corpo, /location\.reload|location\.href|fetch\(|C\.consultar|atualizar\(\)|Cesta\.(add|setQty|limpar|remove)/);
  assert.match(corpo, /renderGrid\(true\)/); assert.match(corpo, /minVisiveis = Math\.max\(visiveis, minVisiveis\)/);
  assert.equal((APP.match(/fetch\(/g) || []).length, 2);                                                  // produtos.json + destaques.json (nenhum a mais)
  assert.match(APP, /Cesta\.delegarAcao\(\$\('grid'\)/);                                                   // MESMA delegação do pedido nos dois modos
  assert.match(APP, /Cesta\.aoMudar\(id => Cesta\.pintar\(id\)\)/);
  assert.match(APP, /\.closest\('\.card-open, \.l-link'\)/);                                              // abrir produto pelo compacto guarda o estado
});
test('lote incremental no compacto (DOM enxuto) e visual inalterado', () => {
  assert.match(APP, /estado\.modo === 'compacto'\) return mobile\(\) \? 24 : 30/);
  assert.match(APP, /return Math\.max\(20, cols \* 5\)/); assert.match(APP, /if \(mobile\(\)\) return 20;/);
  assert.match(APP, /\(compacto \? C\.htmlCabecalhoLista\(\) : ''\) \+ html/);
});
test('seletor Visual/Compacto acessível: grupo rotulado, botões com aria-pressed, rótulos visíveis, 44 px', () => {
  assert.match(IDX, /<div class="modo" role="group" aria-label="Modo de exibição">/);
  assert.match(IDX, /data-modo="visual" aria-pressed="true"[^>]*>[\s\S]*Visual<\/button>/);
  assert.match(IDX, /data-modo="compacto" aria-pressed="false"[^>]*>[\s\S]*Compacto<\/button>/);
  assert.match(APP, /setAttribute\('aria-pressed', b\.dataset\.modo === estado\.modo \? 'true' : 'false'\)/);
  assert.match(CSS, /\.modo-btn\{min-height:44px/); assert.match(CSS, /\.modo-btn\[aria-pressed="true"\]\{background:var\(--ink\);color:#fff\}/);
});
test('CSS do compacto: lista com contêiner (sem tabela larga/rolagem horizontal), colunas no desktop, linha ~56px, sem foto, nada só no hover', () => {
  assert.match(CSS, /\.lista-compacta\{[^}]*container-type:inline-size/);
  assert.match(CSS, /@container lista \(min-width:760px\)/); assert.match(CSS, /@container lista \(min-width:1000px\)/); assert.match(CSS, /@container lista \(max-width:759px\)/);
  assert.match(CSS, /\.linha\{min-height:56px/);
  assert.doesNotMatch(CSS, /\.lista-compacta[^{]*\{[^}]*overflow-x:\s*(auto|scroll)/); assert.doesNotMatch(CSS.slice(CSS.indexOf('MODO COMPACTO')), /<table|[{;]\s*min-width:\s*\d{3,}px/);                 // nenhum elemento com largura mínima fixa grande
  assert.doesNotMatch(CSS, /\.linha:hover[^{]*\{[^}]*display:\s*(none|block|flex)/);                       // hover só muda fundo
  assert.match(CSS, /\.linha:hover\{background:#fff7f1\}/);
  assert.doesNotMatch(CSS, /\.lista-cab[^{]*\{[^}]*position:\s*sticky/);                                  // sem 2ª barra sticky
  assert.doesNotMatch(CSS, /\.lista-compacta[^{]*img|\.linha[^{]*img/);
  assert.match(CSS, /\.l-nome\{[^}]*-webkit-line-clamp:2/);                                               // nome em até 2 linhas, altura estável
  assert.match(CSS, /\.linha \.acao\.no-pedido \.btn-add-cart::after\{content:"✓"/);                      // celular: "✓" cabe ao lado do stepper
});
test('compacto sem download de fotos: o modo escolhe o template ANTES de gerar HTML (nenhum <img> escondido por CSS)', () => {
  assert.match(APP, /map\(compacto \? linhaHTML : cardHTML\)/);
  assert.equal((C.htmlLinha.toString().match(/<img/g) || []).length, 0);
  assert.equal(/display:\s*none[^}]*img|img[^}]*display:\s*none/.test(CSS.slice(CSS.indexOf('MODO COMPACTO'))), false);
});
test('Fase C não introduz: pedido rápido, autocomplete, favoritos, histórico, "compre novamente", filtros novos', () => {
  const tudo = APP + CSS + IDX + CESTA;
  assert.doesNotMatch(tudo, /pedido-rapido|pedido rápido|autocomplete-lista|favorit|compre novamente|historico-compras|faixa-preco|filtro-preco/i);
});
