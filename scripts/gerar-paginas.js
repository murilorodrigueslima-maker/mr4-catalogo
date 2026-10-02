#!/usr/bin/env node
/**
 * Gera as páginas estáticas de produto: produto/<slug-nome>--<slug-codigo>/index.html
 *
 * - Determinístico: sem datas/aleatoriedade; mesma entrada → mesmos bytes.
 * - Só escreve arquivos cujo conteúdo mudou (nada de tocar em centenas de arquivos a cada sync).
 * - O HTML estático traz só dados estáveis (nome, código, marca, categoria, foto, descrição) + Open Graph.
 *   Preço e estoque NÃO entram no HTML: mudam a cada sync e vêm do data/produtos.json no navegador.
 * - Nunca apaga páginas (produto sem estoque some do JSON e volta depois; o link antigo continua abrindo
 *   e mostra "não disponível no momento"). Se o nome mudar (slug novo), a página antiga vira um redirecionamento.
 * - produto/manifest.json guarda código→pasta (para detectar renomeações).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require('../js/catalogo-core.js');

const ORIGEM = 'https://catalogo.mr4distribuidora.com.br';
const LOGO = '/assets/logo-header.png';

function renderizarPagina(item, tpl) {
  const m = Core.metaProduto(item, ORIGEM, LOGO);
  return tpl
    .replace(/\{\{TITLE\}\}/g, Core.esc(m.title))
    .replace(/\{\{DESC\}\}/g, Core.esc(m.description))
    .replace(/\{\{CANONICAL\}\}/g, Core.esc(m.url))
    .replace(/\{\{OG_IMAGE\}\}/g, Core.esc(m.image))
    .replace('{{BREADCRUMB}}', () => Core.htmlBreadcrumb(item).replace('<nav ', '<nav id="bc" '))
    .replace('{{INFO}}', () => Core.htmlProdutoInfo(item));
}
function renderizarRedirecionamento(novoUrl) {
  const abs = ORIGEM + novoUrl;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Redirecionando… — MR4 Distribuidora</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${Core.esc(abs)}">
<meta http-equiv="refresh" content="0; url=${Core.esc(novoUrl)}">
</head><body><p>Este produto mudou de endereço: <a href="${Core.esc(novoUrl)}">abrir página atual</a>.</p>
<script>location.replace(${JSON.stringify(novoUrl).replace(/</g, '\\u003c')}+location.search+location.hash);</script></body></html>
`;
}
const dirDe = url => url.replace(/^\/produto\//, '').replace(/\/$/, '');

/** planejamento puro: devolve os arquivos que DEVEM existir (caminho relativo → conteúdo) e o novo manifesto */
function planejar(produtosBrutos, tpl, manifestoAnterior) {
  const itens = Core.prepararCatalogo(produtosBrutos);
  const anterior = (manifestoAnterior && manifestoAnterior.produtos) || {};
  const arquivos = {};
  const produtos = Object.assign({}, anterior);
  itens.forEach(it => {
    const dir = dirDe(it.url);
    arquivos['produto/' + dir + '/index.html'] = renderizarPagina(it, tpl);
    const antigo = anterior[it.slugCodigo];
    if (antigo && antigo !== dir) arquivos['produto/' + antigo + '/index.html'] = renderizarRedirecionamento(it.url);
    produtos[it.slugCodigo] = dir;
  });
  const ordenado = {};
  Object.keys(produtos).sort().forEach(k => { ordenado[k] = produtos[k]; });
  arquivos['produto/manifest.json'] = JSON.stringify({ versao: 1, produtos: ordenado }, null, 1) + '\n';
  return { arquivos, itens };
}

function executar(raiz) {
  const dados = JSON.parse(fs.readFileSync(path.join(raiz, 'data/produtos.json'), 'utf8'));
  const tpl = fs.readFileSync(path.join(raiz, 'templates/produto.html'), 'utf8');
  let manifesto = null;
  try { manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'produto/manifest.json'), 'utf8')); } catch (e) {}
  const { arquivos, itens } = planejar(dados.produtos || [], tpl, manifesto);
  let escritos = 0, iguais = 0;
  Object.keys(arquivos).sort().forEach(rel => {
    const destino = path.join(raiz, rel);
    let atual = null;
    try { atual = fs.readFileSync(destino, 'utf8'); } catch (e) {}
    if (atual === arquivos[rel]) { iguais++; return; }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, arquivos[rel], 'utf8');
    escritos++;
  });
  console.log(`🧱 Páginas de produto: ${itens.length} produtos · ${escritos} arquivos escritos · ${iguais} sem mudança`);
  return { produtos: itens.length, escritos, iguais };
}

module.exports = { planejar, renderizarPagina, renderizarRedirecionamento, dirDe, ORIGEM, LOGO };
if (require.main === module) executar(path.join(__dirname, '..'));
