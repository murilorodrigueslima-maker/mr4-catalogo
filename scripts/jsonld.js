'use strict';
/**
 * SEO Fase 3 — dados estruturados (JSON-LD), gerados no build, nativamente (sem biblioteca).
 * Regra: só dado confiável e presente na página. Omitido por falta de dado confiável (NÃO inventar):
 *   gtin/mpn/ean, rating/review, fabricante, modelo, preço/disponibilidade (Offer — ver relatório da Fase 3),
 *   endereço (divergente de diretórios externos: pendência do proprietário), telefone (só há WhatsApp de vendedores),
 *   sameAs (nenhum perfil oficial confirmado no projeto), SearchAction (Google descontinuou o recurso em nov/2024).
 * IDs: <origem>/#organization · <origem>/#website · <URL canônica>#product · #breadcrumb · #collection
 */
const Core = require('../js/catalogo-core.js');

const ORIGEM = 'https://catalogo.mr4distribuidora.com.br';
const LOGO = { url: ORIGEM + '/assets/logo-header.png', width: 400, height: 139 };   // ativo institucional existente (PNG 400×139, HTTPS, 200)
const NOME_ORG = 'MR4 Distribuidora';
const ID_ORG = ORIGEM + '/#organization', ID_SITE = ORIGEM + '/#website';

/** JSON seguro para <script>: nunca fecha a tag nem quebra o parser (<, >, &, U+2028/9 viram \uXXXX) */
function serializar(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
const tag = grafo => `<script type="application/ld+json">${serializar({ '@context': 'https://schema.org', '@graph': grafo })}</script>`;

function organizacao() {
  return { '@type': 'Organization', '@id': ID_ORG, name: NOME_ORG, url: ORIGEM + '/', logo: { '@type': 'ImageObject', url: LOGO.url, width: LOGO.width, height: LOGO.height } };
}
function site() {
  return { '@type': 'WebSite', '@id': ID_SITE, url: ORIGEM + '/', name: NOME_ORG, inLanguage: 'pt-BR', publisher: { '@id': ID_ORG } };
}
function breadcrumb(urlCanonica, passos) {
  return { '@type': 'BreadcrumbList', '@id': urlCanonica + '#breadcrumb', itemListElement: passos.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.nome, item: p.url })) };
}
const passoCatalogo = { nome: 'Catálogo', url: ORIGEM + '/' };

/** mesmos passos do breadcrumb VISÍVEL do produto (Core.htmlBreadcrumb): Catálogo › Categoria (se houver) › Produto */
function breadcrumbProduto(item) {
  const url = ORIGEM + item.url, passos = [passoCatalogo];
  if (!item.semGrupo && item.catChave && item.catUrl) passos.push({ nome: item.catRotulo, url: ORIGEM + item.catUrl });
  passos.push({ nome: item.p.name, url });
  return breadcrumb(url, passos);
}
/** descrição do Schema = a MESMA da página: descrição real limpa (≤ 500) ou a frase factual da SEO Fase 2 */
function descricaoSchema(item) {
  return Core.descricaoSubstantiva(item) ? Core.cortarPalavra(Core.excertoDescricao(item.p.desc), 500) : Core.metaDescricaoProduto(item);
}
function produto(item) {
  const url = ORIGEM + item.url, p = item.p;
  const o = { '@type': 'Product', '@id': url + '#product', name: p.name, url };
  if (String(p.ref || '').trim()) o.sku = String(p.ref).trim();
  if (item.marca) o.brand = { '@type': 'Brand', name: item.marca };
  if (/^https:\/\//.test(p.img || '')) o.image = p.img;                    // só foto real do produto (o logo do og:image NÃO é imagem do produto)
  o.description = descricaoSchema(item);
  if (!item.semGrupo && item.catRotulo) o.category = item.catRotulo;
  return o;
}
const grafoHome = () => [organizacao(), site()];
const grafoProduto = item => [produto(item), breadcrumbProduto(item)];
/** categoria/marca: BreadcrumbList + CollectionPage leve (sem ItemList de centenas de produtos). Página vazia (noindex): só breadcrumb */
function grafoTaxonomia(tipo, t, descricao, vazia) {
  const url = ORIGEM + t.url;
  const bc = breadcrumb(url, [passoCatalogo, { nome: t.rotulo, url }]);
  if (vazia) return [bc];
  return [{ '@type': 'CollectionPage', '@id': url + '#collection', url, name: t.rotulo, description: descricao, inLanguage: 'pt-BR', isPartOf: { '@id': ID_SITE }, breadcrumb: { '@id': bc['@id'] } }, bc];
}
/** produto fora do feed: sai o Product (nada de dado "ativo"); o breadcrumb pode ficar */
function somenteBreadcrumb(html) {
  return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (m, js) => {
    let g; try { g = JSON.parse(js)['@graph'] || []; } catch (e) { return ''; }
    const bc = g.filter(n => n['@type'] === 'BreadcrumbList');
    return bc.length ? tag(bc) : '';
  });
}
module.exports = { serializar, tag, organizacao, site, breadcrumb, breadcrumbProduto, produto, grafoHome, grafoProduto, grafoTaxonomia, somenteBreadcrumb, descricaoSchema, ORIGEM, LOGO, ID_ORG, ID_SITE };
