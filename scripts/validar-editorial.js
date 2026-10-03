#!/usr/bin/env node
'use strict';
// Valida data/editorial.json contra data/produtos.json (somente leitura). Erros ⇒ exit 1 (a geração também bloqueia). Avisos (ID órfão, categoria sumida) não bloqueiam.
const fs = require('fs'), path = require('path');
const Core = require('../js/catalogo-core.js');
const raiz = path.join(__dirname, '..');
let ed = null;
try { ed = JSON.parse(fs.readFileSync(path.join(raiz, 'data/editorial.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') { console.error('❌ data/editorial.json ilegível: ' + e.message); process.exit(1); } }
const feed = JSON.parse(fs.readFileSync(path.join(raiz, 'data/produtos.json'), 'utf8')).produtos || [];
const v = Core.validarEditorial(ed, feed);
v.avisos.forEach(a => console.warn('⚠️  ' + a));
v.erros.forEach(e => console.error('❌ ' + e));
const n = ed && ed.produtos ? Object.keys(ed.produtos).length : 0;
console.log(`editorial: ${n} produto(s), ${v.avisos.length} aviso(s), ${v.erros.length} erro(s)`);
process.exit(v.erros.length ? 1 : 0);
