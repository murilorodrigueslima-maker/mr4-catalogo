'use strict';
// Acessibilidade: o painel "Meu pedido" fechado tem aria-hidden e NÃO pode ficar na ordem de foco do teclado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const CSS = fs.readFileSync(path.join(__dirname, '../css/catalogo.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../js/catalogo-cesta.js'), 'utf8');

test('painel Meu pedido: fechado = visibility:hidden (fora do foco e da árvore de acessibilidade); aberto = visible', () => {
  const fechado = CSS.match(/\.cart-sidebar\{[^}]*\}/)[0], aberto = CSS.match(/\.cart-sidebar\.open\{[^}]*\}/)[0];
  assert.match(fechado, /visibility:hidden/);
  assert.match(fechado, /transition:[^;]*visibility 0s linear \.25s/);   // some só depois de deslizar para fora
  assert.match(aberto, /visibility:visible/);
  assert.match(aberto, /transition:transform \.25s(?!,)/);                  // ao abrir, fica visível no mesmo instante (o foco no botão Fechar em 30 ms funciona)
});
test('painel Meu pedido: o JS continua alternando aria-hidden e a classe open (contrato com o CSS)', () => {
  assert.match(JS, /sb\.classList\.add\('open'\)[\s\S]*setAttribute\('aria-hidden', 'false'\)/);
  assert.match(JS, /sb\.classList\.remove\('open'\)[\s\S]*setAttribute\('aria-hidden', 'true'\)/);
  assert.match(JS, /setTimeout\(\(\) => \$\('cartClose'\)\.focus\(\), 30\)/);
});
