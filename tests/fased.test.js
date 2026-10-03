'use strict';
// UX B2B — Fase D: Pedido Rápido (busca → seleciona → quantidade → Enter), sobre a busca e o carrinho existentes
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const RQ = ler('js/catalogo-rapido.js'), APP = ler('js/catalogo-app.js'), CSS = ler('css/catalogo.css'), IDX = ler('index.html');
const ITENS = C.prepararCatalogo(JSON.parse(ler('data/produtos.json')).produtos);
const nomes = l => l.map(e => e.p.name);

test('busca vazia ou só espaços não lista nada', () => {
  ['', '   ', null, undefined].forEach(q => assert.deepEqual(C.rapidoBuscar(ITENS, q), []));
});
test('sem resultado: lista vazia (a UI mostra "Nenhum produto encontrado")', () => {
  assert.deepEqual(C.rapidoBuscar(ITENS, 'zzzzqqxx'), []);
  assert.match(RQ, /Nenhum produto encontrado/);
});
test('ranking compartilhado: mesmos primeiros resultados da busca principal, máx. 8', () => {
  const ref = ITENS.find(e => e.p.ref);
  const qs = [ref.p.ref, 'h4', 't10', 'moldura', 'led'];
  qs.forEach(q => {
    const esp = nomes(C.consultar(ITENS, { q }).lista).slice(0, 8);
    assert.deepEqual(nomes(C.rapidoBuscar(ITENS, q)), esp);
    assert.ok(C.rapidoBuscar(ITENS, q).length <= 8);
  });
  assert.equal(C.rapidoBuscar(ITENS, 'led', 5).length, 5);
});
test('código exato (de produtos reais) vem em 1º lugar', () => {
  const amostra = ITENS.filter(e => e.p.ref).filter((e, i) => i % 25 === 0);
  assert.ok(amostra.length >= 10);
  amostra.forEach(e => assert.equal(C.rapidoBuscar(ITENS, e.p.ref)[0].p.ref, e.p.ref));
});
test('setas: navegação circular e lista vazia', () => {
  assert.equal(C.rapidoMover(0, 1, 8), 1); assert.equal(C.rapidoMover(7, 1, 8), 0);
  assert.equal(C.rapidoMover(0, -1, 8), 7); assert.equal(C.rapidoMover(-1, 1, 3), 0);
  assert.equal(C.rapidoMover(0, 1, 0), -1);
});
test('aviso de estoque: soma o que já está no pedido; nunca bloqueia', () => {
  assert.equal(C.rapidoAcimaDoEstoque(6, 0, 10), true);
  assert.equal(C.rapidoAcimaDoEstoque(6, 0, 6), false);
  assert.equal(C.rapidoAcimaDoEstoque(6, 4, 3), true);
  assert.equal(C.rapidoAcimaDoEstoque(100, 3, 5), false);
  assert.match(RQ, /Pedido ficará acima do estoque atual/);
});
test('feedback inline informa o acréscimo e o total no pedido (3 + 5 = 8)', () => {
  assert.equal(C.rapidoFeedback('T10', 5, 8), '✓ T10 · +5 · agora 8 no pedido');
  assert.match(RQ, /Cesta\.add\(/);                      // soma é feita pelo carrinho existente
  assert.match(RQ, /qtdDe/);
});
test('quantidade: inteiro, mínimo 1, máximo 9.999, sem NaN/negativo', () => {
  assert.equal(C.normalizarQtd('abc'), 1); assert.equal(C.normalizarQtd('-5'), 5 >= 1 ? C.normalizarQtd('-5') : 1);
  assert.equal(C.normalizarQtd(''), 1); assert.equal(C.normalizarQtd('99999'), 9999); assert.equal(C.normalizarQtd('20'), 20);
  assert.ok(Number.isInteger(C.normalizarQtd('3.7')));
});
test('sem segundo mecanismo comercial: sem storage próprio, sem rede, sem imagem', () => {
  assert.doesNotMatch(RQ, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(RQ, /fetch\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(RQ, /<img|new Image|background-image/);
  assert.match(RQ, /Cesta\.aoMudar/);                    // sincroniza com a mesma fonte do pedido
});
test('acessibilidade: combobox/listbox/option, activedescendant, live regions', () => {
  assert.match(RQ, /role="combobox"/); assert.match(RQ, /role="listbox"/); assert.match(RQ, /role="option"/);
  assert.match(RQ, /aria-activedescendant/); assert.match(RQ, /aria-expanded/); assert.match(RQ, /aria-controls="rapidoLista"/);
  assert.match(RQ, /aria-selected/); assert.match(RQ, /aria-live="polite"/); assert.match(RQ, /role="status"/);
});
test('teclado: Enter nunca adiciona da busca; Esc hierárquico; IME ignorado', () => {
  assert.match(RQ, /isComposing/); assert.match(RQ, /keyCode === 229/); assert.match(RQ, /compositionstart/);
  assert.match(RQ, /'Escape'/); assert.match(RQ, /stopPropagation/);
  assert.match(RQ, /ArrowDown/); assert.match(RQ, /ArrowUp/);
  assert.doesNotMatch(RQ, /localStorage\.removeItem|mr4_carrinho/);   // Esc/fechar nunca mexe no carrinho
});
test('não altera a busca/filtros do catálogo principal e abre lazy', () => {
  assert.doesNotMatch(RQ, /searchInput|estado\.q|renderGrid|history\.(push|replace)State/);
  assert.match(RQ, /insertAdjacentHTML/);                // painel só entra no DOM ao abrir
  assert.doesNotMatch(IDX, /id="rapido"/);
});
test('botão visível, atalho Alt+Q, "/" intacto, scripts versionados', () => {
  assert.match(IDX, /id="btnRapido"/); assert.match(IDX, /Pedido rápido/); assert.match(IDX, /catalogo-rapido\.js\?v=(faseD|seo\d|perf\d|ga\d)-\d/);
  assert.match(RQ, /e\.altKey && !e\.ctrlKey && !e\.metaKey && e\.code === 'KeyQ'/);
  assert.match(APP, /e\.key !== '\/'/);
  assert.match(APP, /Rapido\.alternar/);
  assert.match(CSS, /\.btn-rapido/); assert.match(CSS, /\.rapido\{/);
});
test('mobile: tela cheia como diálogo modal; sem tabela', () => {
  assert.match(CSS, /max-width:640px[\s\S]*\.rapido\{position:fixed;inset:0/);
  assert.match(RQ, /aria-modal/);
  assert.doesNotMatch(RQ, /<table/);
});
test('fora de escopo: sem login, histórico, favoritos, importação, câmera, voz', () => {
  assert.doesNotMatch(RQ + CSS, /favorit|compre novamente|historico-compras|csv|xlsx|barcode|getUserMedia|SpeechRecognition|checkout|cupom/i);
});
