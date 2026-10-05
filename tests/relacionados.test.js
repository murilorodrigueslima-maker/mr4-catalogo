'use strict';
// Relacionados: vizinhos circulares dentro do grupo (distribuem links internos) mantendo a precedência categoria+marca → categoria → marca.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const C = require('../js/catalogo-core.js');
const RAIZ = path.join(__dirname, '..');
const mk = (i, o) => Object.assign({ id: String(i), ref: 'R' + i, name: 'PRODUTO ' + i, category: 'Cat A', brand: 'Marca A', price: 'R$ 1,00', stock: 1, img: '', desc: '' }, o || {});

test('relacionados: os 4 PRÓXIMOS do grupo, em ordem de catálogo e circular; nunca o próprio; sem repetição', () => {
  const it = C.prepararCatalogo(Array.from({ length: 7 }, (_, i) => mk(i + 1)));
  const refs = e => C.relacionados(it, e, 4).map(x => x.p.ref);
  assert.deepEqual(refs(it[0]), ['R2', 'R3', 'R4', 'R5']);
  assert.deepEqual(refs(it[3]), ['R5', 'R6', 'R7', 'R1']);                      // dá a volta
  assert.deepEqual(refs(it[6]), ['R1', 'R2', 'R3', 'R4']);
  it.forEach(e => { const r = C.relacionados(it, e, 4); assert.equal(r.length, 4); assert.ok(!r.includes(e)); assert.equal(new Set(r).size, 4); });
});
test('relacionados: precedência categoria+marca → categoria → marca preservada; grupo pequeno completa com o próximo critério', () => {
  const it = C.prepararCatalogo([mk(1), mk(2, { brand: 'Outra' }), mk(3), mk(4, { category: 'Cat B' }), mk(5, { category: 'Cat B', brand: 'Outra' }), mk(6)]);
  const r1 = C.relacionados(it, it[0], 4).map(x => x.p.ref);
  assert.deepEqual(r1, ['R3', 'R6', 'R2', 'R4']);        // cat+marca (3,6) → categoria (2) → marca A em outra categoria (4)
  const sg = C.prepararCatalogo([mk(1, { category: 'PRODUTOS SEM GRUPO', brand: '' }), mk(2, { category: 'PRODUTOS SEM GRUPO', brand: '' })]);
  assert.deepEqual(C.relacionados(sg, sg[0]), []);          // sem categoria comercial e sem marca → nada
  assert.equal(C.relacionados(it, it[0], 2).length, 2);
});
test('relacionados: a fase categoria+marca é limitada a 2; o resto vem da MESMA categoria na ordem do catálogo — produto sem marca deixa de ficar sem nenhum link recebido', () => {
  const todos = Array.from({ length: 12 }, (_, i) => mk(i + 1)).concat(mk(13, { brand: '' }));       // 12 da Marca A + 1 sem marca, mesma categoria
  const it = C.prepararCatalogo(todos);
  const r = C.relacionados(it, it[0], 4).map(e => e.p.ref);
  assert.deepEqual(r, ['R2', 'R3', 'R4', 'R5']);                                                    // 2 pela fase categoria+marca, 2 pela fase categoria (ordem do catálogo)
  const recebidos = it.reduce((n, e) => n + (C.relacionados(it, e, 4).includes(it[12]) ? 1 : 0), 0);
  assert.ok(recebidos >= 2, 'o produto sem marca recebe links dos vizinhos da categoria: ' + recebidos);   // antes desta regra: 0 (só o próprio sem marca o citava)
  assert.ok(!r.some(ref => ref === 'R1'));
});
test('DADOS REAIS: os links de relacionados se espalham — poucos produtos sem nenhum link recebido, nenhum hub concentrando', () => {
  const F = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/produtos.json'), 'utf8')).produtos;
  const ED = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/editorial.json'), 'utf8'));
  const it = C.prepararCatalogo(F, ED);
  const inn = new Map(it.map(e => [e, 0]));
  it.forEach(e => C.relacionados(it, e, 4).forEach(r => inn.set(r, inn.get(r) + 1)));
  const v = [...inn.values()].sort((a, b) => a - b);
  assert.ok(v.filter(x => x === 0).length <= it.length * 0.01, 'sem nenhum link: ' + v.filter(x => x === 0).length);   // antes ~14; sem marca/marca minoritária agora também recebem links
  assert.ok(v.filter(x => x <= 2).length <= it.length * 0.08, 'com ≤2 links: ' + v.filter(x => x <= 2).length);
  assert.ok(v[v.length >> 1] >= 3, 'mediana ' + v[v.length >> 1]);
  assert.ok(v[v.length - 1] <= 16, 'máximo ' + v[v.length - 1]);
});
