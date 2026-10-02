/**
 * MR4 Catálogo — núcleo puro (sem DOM), usado pelo navegador (window.CatalogoCore)
 * e pelo Node (testes e scripts/sync-produtos.js).
 *
 * Tudo aqui é determinístico e sem IA:
 *  - normalização de texto SÓ para comparação (o nome exibido nunca é alterado pela busca);
 *  - higiene de exibição (resíduo fiscal de NF-e em nome/descrição) — o ERP não é alterado;
 *  - normalização de marcas por mapa explícito (equivalências comprovadas);
 *  - busca por tokens (E), ranking simples, tolerância leve a erro de digitação, ordenação.
 *
 * RANKING (maior pontuação primeiro; empate = ordem original do catálogo):
 *   1000  código exato
 *    900  nome exato
 *    800  nome começa com o texto digitado
 *    780  código começa com o texto digitado (parcial)
 *    700  todos os termos estão no nome
 *    600  marca casa com algum termo (e os termos estão em nome+marca)
 *    500  categoria casa com algum termo
 *    400  demais correspondências (termos espalhados em nome/código/marca/categoria)
 *   + até 5 pontos por termo que começa uma palavra do nome (desempate fino).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatalogoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────── normalização para comparação ───────── */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[‘’ʼ'`´"″′]/g, '')   // apóstrofos/aspas: Led’s → leds, 5'' → 5
      .replace(/[^a-z0-9]+/g, ' ')                  // hífen, pontuação, barras → espaço
      .replace(/\s+/g, ' ')
      .trim();
  }
  const compacto = s => norm(s).replace(/ /g, '');
  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'e', 'a', 'o', 'em', 'p']);
  function tokens(q) {
    const t = norm(q).split(' ').filter(Boolean);
    const uteis = t.filter(x => !STOP.has(x));
    return uteis.length ? uteis : t;
  }

  /* ───────── higiene de exibição (resíduo fiscal) ───────── */
  const NUM = '[\\d.]+(?:,\\s?\\d+)?';
  const MARCADOR_FISCAL = /Trib\.?\s*aprox|Lote-Val|\bCEST\b|ICMS|\bST:\s*R\$|Lote-Validade|\bI\/\d+-N\/|\bIBPT\b/i;
  const PADROES_FISCAIS = [
    /Trib\.?\s*aprox\.?[^;\n]*/gi,                                                       // tributos aproximados + fonte IBPT
    /\bCEST:?\s*[\d.]+/gi,
    new RegExp('\\bBC\\s+ICMS\\s+retido\\s+R\\$\\s*' + NUM, 'gi'),
    new RegExp('\\bVl\\.?\\s+ICMS\\s+retido\\s+R\\$\\s*' + NUM, 'gi'),
    /\bImp\.?\s*Ret\.?\s*ST-?\s*Prot\.?\s*ICMS\s*[\d/]*/gi,
    new RegExp('\\bIVA:\\s*\\d+(?:,\\d+)?%\\s*pICMS\\s*ST:\\s*\\d+(?:,\\d+)?%\\s*BC\\s*ICMS\\s*ST:\\s*' + NUM + '\\s*VR\\s*ICMS\\s*ST:\\s*' + NUM, 'gi'),
    /\s*-?\s*Lote-Validade-Qtd:\s*\([^)]*\)/gi,
  /\s*-\s*Lote-Val[\w:()\-/]*\s*$/gi,                                              // 'Lote-Val' truncado no fim do nome
    /\(?(?:N\/)?I\/\d+-N\/+\d+\/\d+-\d+\)?/g,                                           // (N/I/6304-N///6/2004-2) e truncados
    new RegExp('(?:\\b(?:Base|Valor|Vl\\.?|or|alor|lor)\\s+)?\\bST:\\s*R\\$\\s*' + NUM, 'gi')  // Base ST / Valor ST / ST: R$
  ];
  function removerFiscal(texto) {
    let t = String(texto);
    if (!MARCADOR_FISCAL.test(t)) return t;                    // sem marcador → devolve intacto
    PADROES_FISCAIS.forEach(re => { t = t.replace(re, ' '); });
    t = t.replace(/\s+(?:Valor|Val|Base|Vl\.?)\s*$/i, ' ');                 // rótulo fiscal que ficou pendurado no fim
    t = t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/^[\s;,.-]+|[\s;,]+$/g, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
    return /[a-z0-9]/i.test(t) && t.replace(/[^a-z0-9]/gi, '').length >= 3 ? t : '';
  }
  function limparDescricao(d) { return d ? removerFiscal(d) : (d || ''); }
  function limparNome(n) {
    const bruto = String(n == null ? '' : n);
    const limpo = removerFiscal(bruto);
    if (limpo === bruto) return bruto.replace(/\s+/g, ' ').trim();          // sem resíduo: só espaços (nunca mexe em hífens/caixa)
    const t = limpo.replace(/[ \t]+/g, ' ').replace(/[\s-]+$/g, '').trim();
    return t || bruto.replace(/\s+/g, ' ').trim();
  }

  /* ───────── marcas: mapa explícito e auditável ─────────
   * Só entram equivalências COMPROVADAS (mesma marca com caixa/grafia diferente, evidência nos dados).
   * Dúvida → não unir. Marcas que não aparecem aqui ficam como vieram (apenas trim/espaços).
   */
  const MAPA_MARCAS = [
    { para: 'Tiger', de: ['Tiger', 'TIGER'], motivo: 'caixa' },
    { para: 'Tiger', de: ['TIGER AUTO'], motivo: 'mesma linha de códigos (1015Hx, 1025xxx) já cadastrada como Tiger' },
    { para: 'Permak', de: ['Permak', 'PERMAK'], motivo: 'caixa' },
    { para: 'Fiamon', de: ['Fiamon', 'fiamon'], motivo: 'caixa' },
    { para: 'Tarponn', de: ['Tarponn', 'TARPONN'], motivo: 'caixa' },
    { para: 'Lux Led', de: ['Lux Led', 'Lux led'], motivo: 'caixa' },
    { para: 'Rayx', de: ['Rayx', 'RAYX'], motivo: 'caixa' },
    { para: 'Vipertron', de: ['Vipertron', 'VIPERTRON'], motivo: 'caixa' },
    { para: 'Exclusive', de: ['Exclusive', 'EXCLUSIVE'], motivo: 'caixa' },
    { para: 'First Option', de: ['First Option', 'FIRST OPTION'], motivo: 'caixa' },
    { para: 'Alemar', de: ['Alemar', 'ALEMAR'], motivo: 'caixa' },
    { para: 'Alemar', de: ['Alermar'], motivo: 'erro de digitação; o nome do produto contém ALEMAR' },
    { para: 'Fitto/Joker', de: ['Fitto/Joker', 'FITTO/JOKER'], motivo: 'caixa' },
    { para: 'Fitto/Joker', de: ['FITTO/JPKER'], motivo: 'erro de digitação (P por O); mesma linha MD09 das molduras Fitto/Joker' },
    { para: 'Look Out', de: ['look out'], motivo: 'caixa (tudo minúsculo)' }
  ];
  // valores que são tipo de produto, não marca → sem marca (não se inventa fabricante)
  const MARCAS_INVALIDAS = [
    { de: ['Soquete'], motivo: 'tipo de produto, não marca' },
    { de: ['MOLDURA'], motivo: 'tipo de produto, não marca' }
  ];
  const _marcaPorChave = {};
  MAPA_MARCAS.forEach(m => m.de.forEach(v => { _marcaPorChave[norm(v)] = m.para; }));
  const _marcaInvalida = {};
  MARCAS_INVALIDAS.forEach(m => m.de.forEach(v => { _marcaInvalida[norm(v)] = true; }));

  function marcaNormalizada(bruta) {
    const t = String(bruta == null ? '' : bruta).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const k = norm(t);
    if (_marcaInvalida[k]) return '';
    return _marcaPorChave[k] || t;
  }
  /** relatório auditável: toda transformação realizada (bruto → exibido), com contagem */
  function relatorioMarcas(lista) {
    const c = {};
    (lista || []).forEach(p => {
      const b = String(p.brand == null ? '' : p.brand).replace(/\s+/g, ' ').trim();
      if (!b) return;
      const para = marcaNormalizada(b);
      if (para === b) return;
      const key = b + '→' + para;
      c[key] = c[key] || { de: b, para: para || '(sem marca)', produtos: 0 };
      c[key].produtos++;
    });
    return Object.values(c).sort((a, b) => b.produtos - a.produtos || a.de.localeCompare(b.de));
  }
  /** grupos que só diferem por caixa/espaço/acento e NÃO estão cobertos pelo mapa (alerta para o teste) */
  function marcasNaoUnificadas(lista) {
    const g = {};
    (lista || []).forEach(p => {
      const m = marcaNormalizada(p.brand);
      if (!m) return;
      const k = norm(m);
      (g[k] = g[k] || new Set()).add(m);
    });
    return Object.values(g).filter(s => s.size > 1).map(s => [...s]);
  }

  /* ───────── categorias ───────── */
  const ORDEM_CATEGORIAS = [
    'Led’s interno/externo', 'Lâmpada de led', 'Lâmpadas Halógenas', 'Câmera', 'Multimídia', 'Rádio',
    'Sensor estacionamento', 'Alto-Falantes', 'Chave', 'Farol de milha', 'Fusíveis', 'Terminais', 'Chicotes',
    'Soquetes', 'Antenas', 'Palheta', 'Bateria', 'Travas', 'Diversos', 'PRODUTOS SEM GRUPO', 'Moldura', 'Geral'
  ];
  const normCat = s => (s || '').trim().toLowerCase().replace(/[‘’ʼ']/g, "'");
  function prioridadeCategoria(cat) {
    const nc = normCat(cat);
    const i = ORDEM_CATEGORIAS.findIndex(c => normCat(c) === nc);
    return i >= 0 ? i : ORDEM_CATEGORIAS.length - 3;   // regra original da MR4 para categorias fora da lista
  }
  const ehSemGrupo = cat => norm(cat) === 'produtos sem grupo';
  const ROTULO_SEM_GRUPO = 'Sem categoria';
  const rotuloCategoria = cat => (ehSemGrupo(cat) ? ROTULO_SEM_GRUPO : String(cat || '').trim());
  /** categorias comerciais na ordem da MR4; "sem grupo" sempre separado e por último */
  function ordenarCategorias(cats) {
    const lista = [...new Set((cats || []).map(c => String(c || '').trim()).filter(Boolean))];
    const comerciais = lista.filter(c => !ehSemGrupo(c))
      .sort((a, b) => prioridadeCategoria(a) - prioridadeCategoria(b) || a.localeCompare(b, 'pt-BR'));
    return { comerciais, semGrupo: lista.filter(ehSemGrupo) };
  }

  /* ───────── preparação do catálogo e índice de busca ───────── */
  function precoNumerico(p) {
    const s = String((p && p.price) || '').replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }
  function prepararCatalogo(bruto) {
    const itens = (bruto || []).map((r, ordem) => {
      const p = Object.assign({}, r, {
        name: limparNome(r.name),
        desc: limparDescricao(r.desc),
        category: String(r.category || '').trim()
      });
      const marca = marcaNormalizada(r.brand);
      const semGrupo = ehSemGrupo(p.category);
      const catRot = rotuloCategoria(p.category);
      const nome = norm(p.name), ref = norm(p.ref), cat = semGrupo ? '' : norm(p.category), mar = norm(marca);
      return {
        p, ordem, marca, semGrupo, catChave: p.category, catRotulo: catRot,
        n: nome, r: ref, rc: compacto(p.ref), c: cat, b: mar,
        all: [nome, ref, compacto(p.ref), cat, mar].join(' '),
        words: nome.split(' ').filter(Boolean)
      };
    });
    return atribuirUrls(itens);
  }


  /* ───────── identidade e URL do produto ─────────
   * URL: /produto/<slug-do-nome>--<slug-do-código>/
   *  - o CÓDIGO (campo `ref`, já público no catálogo) é o identificador estável; o `id` interno do ERP não aparece;
   *  - o slug do nome é só cosmético: se o nome mudar, o link antigo continua resolvendo pelo código;
   *  - se dois códigos gerarem o mesmo slug, TODOS do grupo recebem um sufixo de hash do código bruto.
   */
  const BASE_PRODUTO = '/produto/';
  const slugify = s => norm(s).replace(/ /g, '-');
  function hash4(str) {                                   // FNV-1a 32 bits → 4 hex (determinístico)
    let h = 0x811c9dc5;
    const t = String(str);
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000' + (h >>> 0).toString(16)).slice(-4);
  }
  function slugNome(nome, max) {
    max = max || 60;
    let s = slugify(nome);
    if (s.length > max) { s = s.slice(0, max); const i = s.lastIndexOf('-'); if (i > 20) s = s.slice(0, i); }
    return s.replace(/^-+|-+$/g, '') || 'produto';
  }
  function atribuirUrls(itens) {
    const grupos = {};
    itens.forEach(e => {
      e.slugNome = slugNome(e.p.name);
      e.slugBase = slugify(e.p.ref) || ('p' + hash4(e.p.id));
      (grupos[e.slugBase] = grupos[e.slugBase] || []).push(e);
    });
    itens.forEach(e => {
      const g = grupos[e.slugBase];
      e.slugCodigo = g.length > 1 ? e.slugBase + '-' + hash4(String(e.p.ref) + '|' + (g.filter(x => x.p.ref === e.p.ref).length > 1 ? e.p.id : '')) : e.slugBase;
      e.url = BASE_PRODUTO + e.slugNome + '--' + e.slugCodigo + '/';
    });
    return itens;
  }
  /** caminho (pathname) → { item, canonico:boolean } | null. Resolve pelo CÓDIGO; o slug do nome é ignorado. */
  function resolverProduto(itens, caminho) {
    let p = String(caminho || '').split('#')[0].split('?')[0];
    const m = p.match(/\/produto\/([^/]+)/i);
    if (!m) return null;
    let seg;
    try { seg = decodeURIComponent(m[1]); } catch (e) { seg = m[1]; }
    seg = seg.toLowerCase();
    const i = seg.lastIndexOf('--');
    const codigo = i >= 0 ? seg.slice(i + 2) : seg;
    if (!codigo) return null;
    const item = itens.find(e => e.slugCodigo === codigo) || null;
    if (!item) return null;
    const atual = '/produto/' + m[1].replace(/\/+$/, '') + '/';
    return { item, canonico: atual.toLowerCase() === item.url.toLowerCase() };
  }
  /**
   * Relacionados (determinístico, sem IA, sem comportamento, preço não é critério):
   *   1º mesma categoria comercial E mesma marca; 2º mesma categoria comercial; 3º mesma marca.
   *   Dentro de cada grupo vale a ordem do catálogo. Nunca inclui o próprio produto. Máx. n (padrão 4).
   */
  function relacionados(itens, item, n) {
    n = n || 4;
    const mesmaCat = e => !item.semGrupo && !e.semGrupo && e.catChave === item.catChave;
    const mesmaMarca = e => !!item.marca && e.marca === item.marca;
    const out = [], usados = new Set([item]);
    [e => mesmaCat(e) && mesmaMarca(e), e => mesmaCat(e), e => mesmaMarca(e)].forEach(regra => {
      itens.forEach(e => { if (out.length < n && !usados.has(e) && regra(e)) { usados.add(e); out.push(e); } });
    });
    return out;
  }

  /* ───────── HTML do produto (fonte única: gerador estático e navegador) ───────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const PLACEHOLDER_SVG = '<svg width="72" height="72" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M10 30 C10 18 16 12 26 11 L44 11" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M10 30 L10 46" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/><path d="M10 38 L44 38" stroke="#D4D4DC" stroke-width="2" stroke-linecap="round"/><line x1="10" y1="22" x2="44" y2="22" stroke="#D4D4DC" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="30" x2="44" y2="30" stroke="#D4D4DC" stroke-width="1.2" stroke-linecap="round"/></svg>';

  /* ───────── dinheiro em centavos inteiros e resolução do pedido contra o catálogo ATUAL ─────────
   * Regra: o preço de um item do pedido vem SEMPRE do produtos.json atual (resolvido pelo código);
   * o preço guardado no carrinho é só referência para detectar "Preço atualizado".            */
  const MAX_QTD = 9999;
  function normalizarQtd(v) {
    if (/^\s*-/.test(String(v == null ? '' : v))) return 1;           // negativo nunca vale
    const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
    if (!isFinite(n) || n < 1) return 1;
    return n > MAX_QTD ? MAX_QTD : n;
  }
  /** "R$ 1.234,56" → 123456 (inteiro); sem número ("Sob consulta", vazio) → null. Sem ponto flutuante. */
  function precoCentavos(txt) {
    const t = String(txt == null ? '' : txt).replace(/R\$/gi, '').replace(/\s/g, '');
    const m = t.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/);
    if (!m) return null;
    const reais = parseInt(m[1].replace(/\./g, ''), 10);
    const cent = m[2] ? parseInt((m[2] + '0').slice(0, 2), 10) : 0;
    return reais * 100 + cent;
  }
  function formatarCentavos(c) {
    if (c == null || !isFinite(c)) return '—';
    const neg = c < 0; c = Math.abs(Math.round(c));
    const reais = Math.floor(c / 100), cent = c % 100;
    return (neg ? '-' : '') + 'R$ ' + String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + (cent < 10 ? '0' : '') + cent;
  }
  /**
   * carrinho: { [id]: { produto:{...}, qty } } (formato `mr4_carrinho`, inalterado)
   * itens: catálogo atual preparado (ou null se ainda não carregou)
   * → { linhas, totalItens, totalCent, indisponiveis, semPreco, carregado }
   */
  function resolverPedido(carrinho, itens) {
    const porRef = new Map(), porId = new Map();
    (itens || []).forEach(e => { porRef.set(String(e.p.ref), e); porId.set(String(e.p.id), e); });
    const linhas = [];
    let totalCent = 0, totalItens = 0, indisponiveis = 0, semPreco = 0;
    Object.keys(carrinho || {}).forEach(id => {
      const l = carrinho[id];
      if (!l || typeof l !== 'object') return;
      const prod = l.produto || {};
      const qtd = normalizarQtd(l.qty);
      totalItens += qtd;
      const base = { id: String(id), ref: prod.ref == null ? '' : String(prod.ref), nome: prod.name || '(produto)', img: prod.img || '', qtd };
      if (!itens) { linhas.push(Object.assign(base, { estado: 'carregando' })); return; }
      // resolve pelo CÓDIGO; só se o carrinho antigo não tiver código, tenta pelo id
      const atual = (base.ref && porRef.get(base.ref)) || (!base.ref ? porId.get(String(id)) : null) || null;
      if (!atual) { indisponiveis++; linhas.push(Object.assign(base, { estado: 'indisponivel' })); return; }
      const precoCent = precoCentavos(atual.p.price);
      const antigo = precoCentavos(prod.price);
      const sub = precoCent == null ? null : precoCent * qtd;
      if (sub == null) semPreco++; else totalCent += sub;
      linhas.push(Object.assign(base, {
        estado: 'ok', nome: atual.p.name, ref: String(atual.p.ref), img: atual.p.img || base.img, url: atual.url,
        precoCent, subtotalCent: sub, estoque: atual.p.stock, acimaEstoque: qtd > atual.p.stock,
        precoAtualizado: precoCent != null && antigo != null && antigo !== precoCent
      }));
    });
    return { linhas, totalItens, totalCent, indisponiveis, semPreco, carregado: !!itens };
  }
  /** controle de compra (stepper + Adicionar), usado nos cards, relacionados e na página do produto */
  function htmlAcao(p, qtd, extraClasse) {
    const id = esc(p.id), nome = esc(p.name), n = qtd > 0 ? qtd : 0;
    return `<div class="acao${n ? ' no-pedido' : ''}${extraClasse ? ' ' + extraClasse : ''}" data-id="${id}" data-nome="${nome}">
      <div class="qtd" role="group" aria-label="Quantidade de ${nome}">
        <button type="button" class="qb" data-q="-1" aria-label="Diminuir quantidade de ${nome}">−</button>
        <input class="qi" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${n || 1}" aria-label="Quantidade de ${nome}">
        <button type="button" class="qb" data-q="1" aria-label="Aumentar quantidade de ${nome}">+</button>
      </div>
      <button type="button" class="btn-add-cart${n ? ' added' : ''}" data-add="${id}"${n ? ' aria-disabled="true"' : ''} aria-label="${n ? 'No pedido: ' + n + ' un. de ' : 'Adicionar ao pedido: '}${nome}">${n ? '✓ No pedido' : 'Adicionar'}</button>
    </div>`;
  }

  /* ───────── modo de exibição: Visual (cards com foto) × Compacto (lista densa, sem fotos) ─────────
   * É só outra representação dos MESMOS produtos: mesma busca, filtros, ordenação, pedido e componente de quantidade.
   * O modo compacto NUNCA emite <img>: quem abre direto em Compacto não solicita nenhuma foto. */
  const MODOS = ['visual', 'compacto'];
  const normalizarModo = v => (MODOS.indexOf(v) >= 0 ? v : 'visual');          // chave ausente/inválida → Visual
  function htmlCabecalhoLista() {
    return `<div class="lista-cab" aria-hidden="true"><span>Produto</span><span>Código</span><span class="c-marca">Marca</span><span>Estoque</span><span>Preço</span><span>Qtd</span></div>`;
  }
  function htmlLinha(e, o) {
    o = o || {};
    const p = e.p, id = esc(p.id);
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 0 ? `${p.stock} em estoque` : 'Sem estoque';          // sem urgência artificial ("últimas unidades" etc.)
    const marca = e.marca ? esc(e.marca) : '';
    return `<div class="linha${o.destaque ? ' destaque-linha' : ''}" role="listitem" data-id="${id}">
      <h3 class="l-nome"><a class="l-link" href="${esc(e.url)}" title="${esc(p.name)}" data-produto="${id}">${esc(p.name)}</a></h3>
      <span class="l-cod"><span class="l-cod-lbl">Cód. </span><b>${esc(p.ref)}</b>${marca ? `<span class="l-marca-inline"> · ${marca}</span>` : ''}</span>
      <span class="l-marca">${marca}</span>
      <span class="l-est ${sc}">${sl}</span>
      <span class="l-preco">${esc(p.price)}</span>
      ${htmlAcao(p, o.qtd || 0, 'acao--compacta')}
    </div>`;
  }

  /** card do catálogo (fonte única: catálogo e relacionados). Preço/estoque exibidos como no JSON; sem JSON/onclick no DOM. */
  function htmlCard(e, o) {
    o = o || {};
    const p = e.p, id = esc(p.id);
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 10 ? `${p.stock} em estoque` : p.stock > 0 ? `Últimas ${p.stock} unid.` : 'Sem estoque';
    return `<article class="card${o.destaque ? ' destaque-card' : ''}" data-id="${id}">
      ${o.destaque ? `<div class="destaque-badge">🔥 Destaque</div>` : ''}
      <div class="card-img">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" decoding="async">` : PLACEHOLDER_SVG}</div>
      <div class="card-body">
        <h3 class="card-name"><a class="card-open" href="${esc(e.url)}" title="${esc(p.name)}" data-produto="${id}">${esc(p.name)}</a></h3>
        <div class="card-cod">Cód. <b>${esc(p.ref)}</b>${e.marca ? ` · ${esc(e.marca)}` : ''}</div>
        <div class="card-compra">
          <div class="card-precos"><span class="card-preco">${esc(p.price)}</span><span class="card-estoque ${sc}">${sl}</span></div>
          ${o.acao === false ? '' : htmlAcao(p, o.qtd || 0)}
        </div>
      </div>
    </article>`;
  }
  function htmlBreadcrumb(item) {
    const li = [`<li><a href="/?r=1">Catálogo</a></li>`];
    if (!item.semGrupo && item.catChave) li.push(`<li><a href="/?cat=${encodeURIComponent(item.catChave)}">${esc(item.catRotulo)}</a></li>`);
    li.push(`<li aria-current="page">${esc(item.p.name)}</li>`);
    return `<nav class="breadcrumb" aria-label="Você está em"><ol>${li.join('')}</ol></nav>`;
  }
  /** conteúdo estático do produto (sem preço/estoque: esses vêm do JSON atual, no navegador) */
  function htmlProdutoInfo(item, dinamico) {
    const p = item.p;
    return `<div class="produto-img">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" decoding="async">` : `<div class="img-placeholder" role="img" aria-label="Produto sem foto">${PLACEHOLDER_SVG}<span>Sem foto</span></div>`}</div>
    <div class="produto-info">
      <h1 class="produto-nome" id="pNome">${esc(p.name)}</h1>
      <p class="produto-codigo"><span class="produto-ref">Cód. <b id="pRef">${esc(p.ref)}</b></span>${dinamico ? `<button type="button" class="copiar-cod" id="pCopiarCod" aria-label="Copiar código ${esc(p.ref)}">Copiar código</button>` : ''}${item.marca ? `<span class="modal-brand">${esc(item.marca)}</span>` : ''}${!item.semGrupo ? `<span class="produto-cat">${esc(item.catRotulo)}</span>` : ''}</p>
      <div class="produto-compra" id="pCompra" data-estado="carregando"><p class="produto-carregando">Carregando preço e estoque…</p><noscript><p>Ative o JavaScript para ver preço e estoque.</p></noscript></div>
    </div>
    ${p.desc ? `<section class="produto-desc"><h2>Descrição</h2><p>${esc(p.desc)}</p></section>` : ''}`;
  }
  function descricaoCurta(texto, max) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const c = t.slice(0, max - 1); const i = c.lastIndexOf(' ');
    return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[ ,;:.-]+$/, '') + '…';
  }
  /** metadados mínimos para compartilhamento (Open Graph) — sem preço e sem estoque (mudam a cada sync) */
  function metaProduto(item, origem, logo) {
    const p = item.p;
    const partes = [`Código ${p.ref}`];
    if (item.marca) partes.push(item.marca);
    if (!item.semGrupo) partes.push(item.catRotulo);
    let desc = p.name + ' — ' + partes.join(' · ') + '. Catálogo B2B MR4 Distribuidora (CE · PI · RN).';
    if (p.desc) desc = descricaoCurta(p.name + ' — ' + partes.join(' · ') + '. ' + p.desc, 200);
    return { title: p.name + ' — MR4 Distribuidora', description: descricaoCurta(desc, 200), url: origem + item.url, image: p.img || (origem + logo), imagemDoProduto: !!p.img };
  }

  /* ───────── compartilhar / copiar link (ambiente injetado → testável) ───────── */
  async function copiarLink(env, url) {
    if (env && env.clipboard) { try { await env.clipboard(url); return { ok: true, via: 'clipboard' }; } catch (e) {} }
    if (env && env.exec) { try { if (env.exec(url)) return { ok: true, via: 'exec' }; } catch (e) {} }
    return { ok: false, via: 'manual' };
  }
  async function compartilhar(env, dados) {
    if (env && env.share) {
      try { await env.share(dados); return { ok: true, via: 'share' }; }
      catch (e) { if (e && e.name === 'AbortError') return { ok: false, via: 'cancelado' }; }
    }
    return copiarLink(env, dados.url);
  }

  /* ───────── tolerância leve a erro de digitação (distância de Damerau/OSA ≤ 1) ───────── */
  function osa(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  function vocabulario(itens) {
    const v = new Map();
    itens.forEach(e => {
      new Set((e.n + ' ' + e.c + ' ' + e.b).split(' ')).forEach(w => {
        if (w.length >= 4 && !/\d/.test(w)) v.set(w, (v.get(w) || 0) + 1);
      });
    });
    return v;
  }
  /** para cada termo desconhecido (≥5 letras, sem dígitos) sugere até 3 palavras do catálogo a 1 edição de distância */
  function corrigirTermos(toks, itens, vocab) {
    let mudou = false;
    const alt = toks.map(t => {
      const conhecido = itens.some(e => e.all.includes(t));
      if (conhecido || t.length < 5 || /\d/.test(t)) return [t];
      const cands = [];
      vocab.forEach((freq, w) => {
        if (w[0] === t[0] && Math.abs(w.length - t.length) <= 1 && osa(t, w, 1) <= 1) cands.push([w, freq]);
      });
      if (!cands.length) return [t];
      mudou = true;
      return cands.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(c => c[0]);
    });
    return { alt, mudou };
  }

  /* ───────── busca ───────── */
  function casaToken(e, alts) {
    for (const t of alts) {
      if (e.all.includes(t)) return true;
      if (t.length > 3 && t.endsWith('s') && e.all.includes(t.slice(0, -1))) return true;   // plural simples
    }
    return false;
  }
  const _vocabCache = new WeakMap();
  function pontuar(e, qn, qc, alt) {
    const emNome = alt.every(a => a.some(t => e.n.includes(t) || (t.length > 3 && t.endsWith('s') && e.n.includes(t.slice(0, -1)))));
    let s;
    if (qc && (e.rc === qc || e.r === qn)) s = 1000;
    else if (e.n === qn) s = 900;
    else if (e.n.startsWith(qn)) s = 800;
    else if (qc.length >= 2 && e.rc.startsWith(qc)) s = 780;
    else if (emNome) s = 700;
    else {
      const nomeMarca = e.n + ' ' + e.b;
      const todosNomeMarca = alt.every(a => a.some(t => nomeMarca.includes(t)));
      const marcaCasa = e.b && alt.some(a => a.some(t => e.b.includes(t)));
      const catCasa = e.c && alt.some(a => a.some(t => e.c.includes(t)));
      if (marcaCasa && todosNomeMarca) s = 600;
      else if (catCasa) s = 500;
      else s = 400;
    }
    alt.forEach(a => { if (a.some(t => e.words.some(w => w.startsWith(t)))) s += 5; });
    return s;
  }
  /** retorna { itens (ordenados por relevância), corrigido: null | 'termos usados' } */
  function buscar(itens, consulta) {
    const qn = norm(consulta);
    if (!qn) return { itens: itens.slice(), corrigido: null, relevancia: false };
    const toks = tokens(consulta);
    const qc = qn.replace(/ /g, '');
    let alt = toks.map(t => [t]);
    let achados = itens.filter(e => alt.every(a => casaToken(e, a)));
    let corrigido = null;
    if (!achados.length) {
      let vocab = _vocabCache.get(itens);
      if (!vocab) { vocab = vocabulario(itens); _vocabCache.set(itens, vocab); }
      const c = corrigirTermos(toks, itens, vocab);
      if (c.mudou) {
        const tentativa = itens.filter(e => c.alt.every(a => casaToken(e, a)));
        if (tentativa.length) { achados = tentativa; alt = c.alt; corrigido = c.alt.map(a => a[0]).join(' '); }
      }
    }
    const pont = new Map(achados.map(e => [e, pontuar(e, qn, qc, alt)]));
    achados.sort((a, b) => pont.get(b) - pont.get(a) || a.ordem - b.ordem);
    return { itens: achados, corrigido, relevancia: true };
  }

  /* ───────── ordenação ───────── */
  function ordenar(lista, modo, destaques) {
    const arr = lista.slice();
    const dest = e => (destaques && destaques.has(String(e.p.id))) ? 0 : 1;
    const byOrdem = (a, b) => a.ordem - b.ordem;
    switch (modo) {
      case 'az': return arr.sort((a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR') || byOrdem(a, b));
      case 'za': return arr.sort((a, b) => b.p.name.localeCompare(a.p.name, 'pt-BR') || byOrdem(a, b));
      case 'menor-preco': return arr.sort((a, b) => precoNumerico(a.p) - precoNumerico(b.p) || byOrdem(a, b));
      case 'maior-preco': return arr.sort((a, b) => precoNumerico(b.p) - precoNumerico(a.p) || byOrdem(a, b));
      case 'maior-estoque': return arr.sort((a, b) => b.p.stock - a.p.stock || byOrdem(a, b));
      case 'destaque': return arr.sort((a, b) => dest(a) - dest(b));   // estável: mantém a ordem recebida dentro de cada grupo
      default: return arr;                                              // 'padrao': ordem do catálogo (ou relevância na busca)
    }
  }

  /**
   * Consulta completa sobre a base inteira: categoria + marca + busca + ordenação.
   * estado: { q, cat, marca, sort }  (cat = chave de categoria; marca = marca normalizada)
   */
  function consultar(itens, estado, destaques) {
    const e = estado || {};
    let base = itens;
    if (e.cat) base = base.filter(x => x.catChave === e.cat);
    if (e.marca) base = base.filter(x => x.marca === e.marca);
    const comBusca = !!norm(e.q);
    let r = comBusca ? buscar(base, e.q) : { itens: base.slice(), corrigido: null, relevancia: false };
    // relevância vale para a ordenação padrão; as demais ordenações são escolha explícita do usuário
    let lista = r.itens;
    const modo = e.sort || 'padrao';
    if (modo === 'destaque') lista = ordenar(lista, 'destaque', destaques);
    else if (modo !== 'padrao') lista = ordenar(lista, modo, destaques);
    return { lista, total: lista.length, corrigido: r.corrigido, termo: String(e.q || '').trim(), comBusca };
  }

  function opcoesMarca(itens) {
    const c = {};
    itens.forEach(x => { if (x.marca) c[x.marca] = (c[x.marca] || 0) + 1; });
    return Object.keys(c).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(m => ({ marca: m, n: c[m] }));
  }

  function mensagemWhatsProduto(p, qtd, url) {
    const linhas = ['Olá, MR4 Distribuidora! Vi este produto no catálogo e tenho interesse:', '', '*' + p.name + '*', 'Ref: ' + p.ref];
    if (qtd && qtd > 0) linhas.push('Quantidade desejada: ' + qtd);
    if (url) linhas.push('Link: ' + url);
    linhas.push('', '(Mensagem enviada pelo catálogo digital)');
    return linhas.join('\n');
  }

  return {
    norm, compacto, tokens, removerFiscal, limparDescricao, limparNome,
    MAPA_MARCAS, MARCAS_INVALIDAS, marcaNormalizada, relatorioMarcas, marcasNaoUnificadas,
    ORDEM_CATEGORIAS, prioridadeCategoria, ehSemGrupo, rotuloCategoria, ROTULO_SEM_GRUPO, ordenarCategorias,
    precoNumerico, prepararCatalogo, buscar, ordenar, consultar, opcoesMarca, mensagemWhatsProduto, osa,
    slugify, slugNome, hash4, resolverProduto, relacionados, esc, htmlBreadcrumb, htmlProdutoInfo, descricaoCurta, metaProduto,
    copiarLink, compartilhar, BASE_PRODUTO, PLACEHOLDER_SVG, htmlCard, htmlAcao, MODOS, normalizarModo, htmlLinha, htmlCabecalhoLista,
    MAX_QTD, normalizarQtd, precoCentavos, formatarCentavos, resolverPedido
  };
});
