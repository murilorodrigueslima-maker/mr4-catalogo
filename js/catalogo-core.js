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

  /* ───────── camada EDITORIAL (data/editorial.json) ─────────
   * Correções versionadas, chaveadas pelo ID do ERP, aplicadas DEPOIS do feed (que continua 100 % ERP) e ANTES de qualquer
   * derivação (marca/slug/categoria/URL/SEO). O próximo sync nunca as apaga: o sync não toca neste arquivo.
   * Campos aceitos: brand, category, title, desc (+ descModo, motivo, evidencia, status). Preço/estoque/código/imagem/ID: NUNCA (erro de validação).
   * Produto sem override ou produto novo: segue exatamente o ERP. ID órfão: aviso (não bloqueia). Arquivo inválido: bloqueia a geração.
   * Cada item alterado carrega `p.erp` (valores originais do ERP) e `p.editado` (lista de campos) — o dado ERP continua distinguível. */
  const EDITORIAL_CAMPOS = ['brand', 'category', 'title', 'desc'];
  const EDITORIAL_META = ['descModo', 'motivo', 'evidencia', 'status'];
  const EDITORIAL_PROIBIDOS = ['price', 'preco', 'stock', 'estoque', 'ref', 'sku', 'codigo', 'id', 'img', 'image', 'imagem', 'gtin', 'mpn', 'valores'];
  function descricaoEditorialProblema(d) {
    const t = String(d || '');
    if (/<[a-z!\/][^>]*>/i.test(t)) return 'contém HTML';
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br)\b/i.test(t)) return 'contém URL/domínio';
    if (/R\$\s?\d|\b\d+[.,]\d{2}\s?(reais|r\$)|\bpor apenas\b|\bpromo[cç][aã]o\b|\bdesconto\b/i.test(t)) return 'contém preço/promoção';
    if (/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b|\bwhats(app)?\b/i.test(t)) return 'contém telefone/WhatsApp';
    if (/\bNCM\b|\bCFOP\b|\bCST\b|\bCEST\b/i.test(t)) return 'contém dado fiscal (NCM/CFOP/CST)';
    if (/\b(garantia de|melhor do mercado|o mais vendido|original de f[aá]brica|100\s?%\s?original|homologad[oa]|certificad[oa] pelo|inmetro)\b/i.test(t)) return 'contém afirmação não comprovada (exige evidência)';
    if (t.trim().length < 40) return 'muito curta (< 40 caracteres)';
    if (t.length > 1500) return 'muito longa (> 1500 caracteres)';
    return '';
  }
  /** valida o arquivo editorial contra o feed ERP. Devolve { erros, avisos }; qualquer erro ⇒ o chamador deve BLOQUEAR. */
  function validarEditorial(ed, produtosErp) {
    const erros = [], avisos = [];
    if (ed == null) return { erros, avisos };
    if (typeof ed !== 'object' || Array.isArray(ed)) return { erros: ['editorial: raiz deve ser um objeto'], avisos };
    if (ed.versao !== 1) erros.push('editorial: "versao" deve ser 1');
    const mapa = ed.produtos;
    if (mapa == null || typeof mapa !== 'object' || Array.isArray(mapa)) { erros.push('editorial: "produtos" deve ser um objeto { <id>: {...} }'); return { erros, avisos }; }
    const red = ed.redirecionamentos;
    if (red != null) {
      if (typeof red !== 'object' || Array.isArray(red)) erros.push('editorial: "redirecionamentos" deve ser um objeto { "/marca/antiga/": "/marca/canonica/" }');
      else Object.keys(red).forEach(de => {
        const para = red[de], re = /^\/(marca|categoria)\/[a-z0-9]+(-[a-z0-9]+)*\/$/;
        if (!re.test(de) || typeof para !== 'string' || !re.test(para)) erros.push('editorial.redirecionamentos["' + de + '"]: origem e destino devem ser /marca/<slug>/ ou /categoria/<slug>/');
        else if (de === para) erros.push('editorial.redirecionamentos["' + de + '"]: origem = destino');
        else if (de.split('/')[1] !== para.split('/')[1]) erros.push('editorial.redirecionamentos["' + de + '"]: origem e destino devem ser do mesmo tipo');
      });
    }
    const ali = ed.aliasesMarca;
    if (ali != null) {
      if (typeof ali !== 'object' || Array.isArray(ali)) erros.push('editorial: "aliasesMarca" deve ser um objeto { "Marca antiga": "Marca canônica" }');
      else {
        const chaves = Object.keys(ali).map(norm);
        Object.keys(ali).forEach(de => {
          const para = ali[de], ctx = 'editorial.aliasesMarca["' + de + '"]';
          if (typeof para !== 'string' || !para.trim()) erros.push(ctx + ': destino deve ser texto não vazio');
          else if (norm(de) === norm(para)) erros.push(ctx + ': origem = destino');
          else if (chaves.indexOf(norm(para)) >= 0) erros.push(ctx + ': destino é origem de outro alias (cadeia/ciclo proibido)');
          else if (_marcaInvalida[norm(para)]) erros.push(ctx + ': destino "' + para + '" é tipo de produto, não marca');
        });
      }
    }
    const erp = new Map((produtosErp || []).map(p => [String(p.id), p]));
    const cats = new Set((produtosErp || []).map(p => String(p.category || '').trim()).filter(Boolean));
    Object.keys(mapa).forEach(id => {
      const o = mapa[id], ctx = 'editorial[' + id + ']';
      if (!/^\d+$/.test(id)) { erros.push(ctx + ': chave deve ser o ID numérico do ERP'); return; }
      if (o == null || typeof o !== 'object' || Array.isArray(o)) { erros.push(ctx + ': deve ser um objeto'); return; }
      const chaves = Object.keys(o);
      chaves.forEach(k => {
        if (EDITORIAL_PROIBIDOS.indexOf(k.toLowerCase()) >= 0) erros.push(ctx + ': campo "' + k + '" é do ERP e NUNCA pode ser sobrescrito editorialmente');
        else if (EDITORIAL_CAMPOS.indexOf(k) < 0 && EDITORIAL_META.indexOf(k) < 0) erros.push(ctx + ': campo desconhecido "' + k + '"');
      });
      EDITORIAL_CAMPOS.forEach(k => { if (k in o && (typeof o[k] !== 'string' || !o[k].trim())) erros.push(ctx + ': "' + k + '" deve ser texto não vazio'); });
      if (!EDITORIAL_CAMPOS.some(k => k in o)) erros.push(ctx + ': nenhum campo editorial (brand/category/title/desc)');
      if ('descModo' in o && o.descModo !== 'preencher' && o.descModo !== 'substituir') erros.push(ctx + ': descModo deve ser "preencher" ou "substituir"');
      if (!o.motivo || typeof o.motivo !== 'string') erros.push(ctx + ': "motivo" é obrigatório (por que a correção é segura)');
      if (typeof o.brand === 'string' && (o.brand.length > 40 || /[<>\/\\]{2,}|https?:/i.test(o.brand))) erros.push(ctx + ': marca inválida');
      if (typeof o.brand === 'string' && _marcaInvalida[norm(o.brand)]) erros.push(ctx + ': "' + o.brand + '" é tipo de produto, não marca');
      if (typeof o.category === 'string' && !cats.has(o.category.trim())) avisos.push(ctx + ': categoria "' + o.category + '" não existe mais no catálogo — override de categoria ignorado (só categorias já existentes; não bloqueia o sync)');
      if (typeof o.title === 'string') {
        if (o.title.length > 100) erros.push(ctx + ': title > 100 caracteres');
        if (/https?:|R\$\s?\d|<[^>]+>/i.test(o.title)) erros.push(ctx + ': title contém URL/preço/HTML');
      }
      if (typeof o.desc === 'string') { const pr = descricaoEditorialProblema(o.desc); if (pr) erros.push(ctx + ': desc ' + pr); }
      const p = erp.get(id);
      if (!p) avisos.push(ctx + ': ID órfão (não está no feed ERP atual) — override ignorado');
    });
    return { erros, avisos };
  }
  /** aplica os overrides (cópias; o feed original não é mutado). IDs sem override passam intactos. */
  function aplicarEditorial(produtos, ed) {
    // TOTAL por construção: um editorial malformado NUNCA pode derrubar o catálogo (o navegador não valida; só o gerador valida).
    const objeto = x => x != null && typeof x === 'object' && !Array.isArray(x);
    const mapa = objeto(ed) && objeto(ed.produtos) ? ed.produtos : null;
    if (!mapa) return produtos || [];
    const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const cats = new Set((produtos || []).map(p => String((p && p.category) || '').trim()).filter(Boolean));
    return (produtos || []).map(r => {
      const id = r && r.id != null ? String(r.id) : '';
      const o = id && tem(mapa, id) ? mapa[id] : null;
      if (!objeto(o)) return r;
      const p = Object.assign({}, r), erp = {}, editado = [];
      const descErpValida = r.desc && String(r.desc).trim().length >= 40;
      EDITORIAL_CAMPOS.forEach(k => {
        if (!tem(o, k) || typeof o[k] !== 'string' || !o[k].trim()) return;                // só texto não vazio
        const campo = k === 'title' ? 'name' : k;
        if (k === 'desc' && descErpValida && o.descModo !== 'substituir') return;      // ERP válida vence, salvo substituição explícita
        if (k === 'category' && !cats.has(o[k].trim())) return;                         // só categoria que já existe no feed
        const novo = o[k].trim();
        if (String(p[campo] == null ? '' : p[campo]).trim() === novo) return;
        erp[campo] = r[campo] == null ? '' : r[campo];
        p[campo] = novo; editado.push(campo);
      });
      if (editado.length) { p.erp = erp; p.editado = editado; }
      return p;
    });
  }
  /** alias editorial de marca (ed.aliasesMarca: { "Tiger": "Tiger Auto" }): aplicado DEPOIS da normalização por mapa; chave comparada sem caixa/acento; total e seguro */
  function aliasMarca(marca, ed) {
    const al = ed && typeof ed === 'object' && !Array.isArray(ed) ? ed.aliasesMarca : null;
    if (!marca || al == null || typeof al !== 'object' || Array.isArray(al)) return marca;
    const k = norm(marca);
    for (const de of Object.keys(al)) { if (norm(de) === k && typeof al[de] === 'string' && al[de].trim()) return al[de].replace(/\s+/g, ' ').trim(); }
    return marca;
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
  function prepararCatalogo(bruto, editorial) {
    const itens = aplicarEditorial(bruto || [], editorial).map((r, ordem) => {
      const p = Object.assign({}, r, {
        name: limparNome(r.name),
        desc: limparDescricao(r.desc),
        category: String(r.category || '').trim()
      });
      const marca = aliasMarca(marcaNormalizada(r.brand), editorial);
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
    atribuirUrls(itens);
    atribuirTaxonomia(itens);
    return itens;
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

  /* ───────── taxonomia: páginas estáticas de categoria e marca (SEO Fase 1) ─────────
   * /categoria/<slug>/ e /marca/<slug>/ — slug determinístico (sem acento/pontuação/caixa).
   * Colisão (dois valores distintos com o mesmo slug): TODOS do grupo recebem sufixo hash4 do valor bruto.
   * Marca NÃO é fundida por suposição: só a normalização já aprovada (MAPA_MARCAS) vale; o resto fica separado.
   * Produto sem marca não tem página de marca. "PRODUTOS SEM GRUPO" vira a página "Sem categoria".
   */
  const BASE_CATEGORIA = '/categoria/', BASE_MARCA = '/marca/';
  function atribuirSlugs(valores, rotuloDe, fallback) {
    const grupos = {};
    valores.forEach(v => { const b = slugify(rotuloDe(v)) || fallback; (grupos[b] = grupos[b] || []).push(v); });
    const out = {};
    Object.keys(grupos).forEach(b => grupos[b].forEach(v => { out[v] = grupos[b].length > 1 ? b + '-' + hash4(v) : b; }));
    return out;
  }
  function atribuirTaxonomia(itens) {
    const cats = [...new Set(itens.map(e => e.catChave).filter(Boolean))];
    const marcas = [...new Set(itens.map(e => e.marca).filter(Boolean))];
    const sc = atribuirSlugs(cats, rotuloCategoria, 'categoria');
    const sm = atribuirSlugs(marcas, m => m, 'marca');
    itens.forEach(e => {
      e.catSlug = e.catChave ? sc[e.catChave] : '';
      e.catUrl = e.catSlug ? BASE_CATEGORIA + e.catSlug + '/' : '';
      e.marcaSlug = e.marca ? sm[e.marca] : '';
      e.marcaUrl = e.marcaSlug ? BASE_MARCA + e.marcaSlug + '/' : '';
    });
    return itens;
  }
  /** listas de categorias (ordem da MR4) e marcas (A→Z) com seus produtos — fonte única do gerador e do app */
  function taxonomia(itens) {
    const { comerciais, semGrupo } = ordenarCategorias(itens.map(e => e.catChave));
    const categorias = comerciais.concat(semGrupo).map(chave => {
      const lista = itens.filter(e => e.catChave === chave);
      return { chave, rotulo: rotuloCategoria(chave), slug: lista[0].catSlug, url: lista[0].catUrl, itens: lista };
    });
    const marcas = opcoesMarca(itens).map(o => {
      const lista = itens.filter(e => e.marca === o.marca);
      return { chave: o.marca, rotulo: o.marca, slug: lista[0].marcaSlug, url: lista[0].marcaUrl, itens: lista };
    });
    return { categorias, marcas };
  }
  /** URL "limpa" de um estado de filtros: só categoria → /categoria/x/; só marca → /marca/y/; senão null (usa ?query) */
  function urlLimpa(itens, cat, marca) {
    if (cat && !marca) { const e = itens.find(x => x.catChave === cat); return e && e.catUrl ? e.catUrl : null; }
    if (marca && !cat) { const e = itens.find(x => x.marca === marca); return e && e.marcaUrl ? e.marcaUrl : null; }
    return null;
  }

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
  /** relacionados: mesma regra de precedência (categoria+marca → categoria → marca), mas dentro de cada grupo pega os PRÓXIMOS itens na ordem do catálogo
   *  (circular), não sempre os 4 primeiros. Efeito: os links de "relacionados" se distribuem por todos os produtos do grupo (cada item recebe ~4 links de
   *  vizinhos) em vez de concentrar tudo nos 4 primeiros — determinístico, mesmo algoritmo no HTML estático e no navegador. */
  function relacionados(itens, item, n) {
    n = n || 4;
    const mesmaCat = e => !item.semGrupo && !e.semGrupo && e.catChave === item.catChave;
    const mesmaMarca = e => !!item.marca && e.marca === item.marca;
    const pos = itens.indexOf(item);
    const out = [], usados = new Set([item]);
    [e => mesmaCat(e) && mesmaMarca(e), e => mesmaCat(e), e => mesmaMarca(e)].forEach(regra => {
      if (out.length >= n) return;
      const grupo = itens.filter(e => e !== item && regra(e));
      if (!grupo.length) return;
      let ini = grupo.findIndex(e => itens.indexOf(e) > pos);
      if (ini < 0) ini = 0;
      for (let k = 0; k < grupo.length && out.length < n; k++) {
        const e = grupo[(ini + k) % grupo.length];
        if (!usados.has(e)) { usados.add(e); out.push(e); }
      }
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

  /* ───────── Pedido Rápido: ajudantes puros (a busca e o ranking são os da consulta normal) ───────── */
  /** até n resultados (padrão 8) na MESMA ordem de relevância da busca principal; consulta vazia → nada */
  function rapidoBuscar(itens, q, n) {
    if (!norm(q)) return [];
    return consultar(itens, { q }).lista.slice(0, n || 8);
  }
  const rapidoMover = (atual, delta, n) => (n > 0 ? (atual + delta + n) % n : -1);          // setas ↑/↓ com volta
  const rapidoAcimaDoEstoque = (stock, noPedido, qtd) => (Number(noPedido) || 0) + (Number(qtd) || 0) > Number(stock);
  const rapidoFeedback = (nome, adicionado, agora) => `✓ ${nome} · +${adicionado} · agora ${agora} no pedido`;

  /** card do catálogo (fonte única: catálogo e relacionados). Preço/estoque exibidos como no JSON; sem JSON/onclick no DOM. */
  function htmlCard(e, o) {
    o = o || {};
    const p = e.p, id = esc(p.id);
    const sc = p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out';
    const sl = p.stock > 10 ? `${p.stock} em estoque` : p.stock > 0 ? `Últimas ${p.stock} unid.` : 'Sem estoque';
    return `<article class="card${o.destaque ? ' destaque-card' : ''}" data-id="${id}">
      ${o.destaque ? `<div class="destaque-badge">🔥 Destaque</div>` : ''}
      <div class="card-img">${p.img ? `<img src="${esc(p.img)}" alt="" ${o.prioridade === 'alta' ? 'fetchpriority="high" ' : o.prioridade === 'eager' ? '' : 'loading="lazy" '}decoding="async">` : PLACEHOLDER_SVG}</div>
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
    const li = [`<li><a href="/">Catálogo</a></li>`];
    if (!item.semGrupo && item.catChave) li.push(`<li><a href="${esc(item.catUrl || '/?cat=' + encodeURIComponent(item.catChave))}">${esc(item.catRotulo)}</a></li>`);
    li.push(`<li aria-current="page">${esc(item.p.name)}</li>`);
    return `<nav class="breadcrumb" aria-label="Você está em"><ol>${li.join('')}</ol></nav>`;
  }
  /** relacionados no HTML estático: nome + link reais (JS troca por cards com preço/estoque/pedido) */
  function htmlRelacionadosEstatico(lista) {
    if (!lista || !lista.length) return '';
    return `<section class="relacionados" aria-labelledby="relTit"><h2 id="relTit">Produtos relacionados</h2><ul class="rel-links">` +
      lista.map(e => `<li><a href="${esc(e.url)}">${esc(e.p.name)}</a> <span class="rel-cod">Cód. ${esc(e.p.ref)}</span></li>`).join('') + `</ul></section>`;
  }
  /** lista leve de links (sem imagem) para páginas de categoria/marca: TODOS os produtos, no HTML inicial */
  function htmlListaProdutosSeo(itens, rotulo) {
    return `<nav class="seo-lista" id="seoLista" aria-label="${esc(rotulo)}"><ul>` +
      itens.map(e => `<li><a href="${esc(e.url)}">${esc(e.p.name)}</a> <span class="rel-cod">Cód. ${esc(e.p.ref)}${e.marca ? ' · ' + esc(e.marca) : ''}</span></li>`).join('') + `</ul></nav>`;
  }
  /** conteúdo estático do produto (sem preço/estoque: esses vêm do JSON atual, no navegador) */
  function htmlProdutoInfo(item, dinamico) {
    const p = item.p;
    return `<div class="produto-img">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" decoding="async">` : `<div class="img-placeholder" role="img" aria-label="Produto sem foto">${PLACEHOLDER_SVG}<span>Sem foto</span></div>`}</div>
    <div class="produto-info">
      <h1 class="produto-nome" id="pNome">${esc(p.name)}</h1>
      <p class="produto-codigo"><span class="produto-ref">Cód. <b id="pRef">${esc(p.ref)}</b></span>${dinamico ? `<button type="button" class="copiar-cod" id="pCopiarCod" aria-label="Copiar código ${esc(p.ref)}">Copiar código</button>` : ''}${item.marca ? `<span class="modal-brand">${item.marcaUrl ? `<a class="marca-link" href="${esc(item.marcaUrl)}">${esc(item.marca)}</a>` : esc(item.marca)}</span>` : ''}${!item.semGrupo ? `<span class="produto-cat">${esc(item.catRotulo)}</span>` : ''}</p>
      <div class="produto-compra" id="pCompra" data-estado="carregando"><p class="produto-carregando">Carregando preço e estoque…</p><noscript><p>Ative o JavaScript para ver preço e estoque.</p></noscript></div>
    </div>
    ${descricaoSubstantiva(item) ? `<section class="produto-desc"><h2>Descrição</h2><p>${esc(p.desc)}</p></section>` : ''}`;
  }
  function descricaoCurta(texto, max) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const c = t.slice(0, max - 1); const i = c.lastIndexOf(' ');
    return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[ ,;:.-]+$/, '') + '…';
  }
  /* ───────── SEO on-page (Fase 2): title e meta description DETERMINÍSTICOS, só com dado cadastral ─────────
   * Nada é inferido (aplicação, compatibilidade, potência, voltagem, cor…). Insumos: nome, código, marca, categoria
   * e, quando existe e é substantiva, a descrição real do ERP.
   * TITLE  (alvo ≈ 60 caracteres; o NOME nunca é cortado nem alterado):
   *   prioridade nome > marca (só se o nome ainda não a contém) > código > "MR4 Distribuidora" (→ "MR4" se não couber).
   *   Primeira opção que cabe em 60, da mais rica à mais simples: nome · marca · código | MR4 Distribuidora → … | MR4 → nome · marca → nome (cada uma com os dois sufixos).
   *   Nome que sozinho passa de 60 fica inteiro (clareza > limite). Títulos iguais ⇒ o CÓDIGO desambigua (sempre).
   */
  const SEO_TITLE_ALVO = 60, SUFIXO_LONGO = ' | MR4 Distribuidora', SUFIXO_CURTO = ' | MR4';
  const contemTermo = (texto, termo) => { const t = norm(termo); return !!t && (' ' + norm(texto) + ' ').indexOf(' ' + t + ' ') >= 0; };
  /** corta SEMPRE em limite de palavra (nunca no meio de código/unidade/modelo) */
  function cortarPalavra(texto, max) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const c = t.slice(0, max - 1); const i = c.lastIndexOf(' ');
    const fimDePalavra = /\s/.test(t.charAt(max - 1));                      // a palavra termina exatamente no limite
    return (fimDePalavra || i <= 0 ? c : c.slice(0, i)).replace(/[ ,;:.\-–(]+$/, '') + '…';
  }
  function candidatosTitle(item, comCodigo) {
    const nome = item.p.name, cod = String(item.p.ref || '').trim();
    const marca = item.marca && !contemTermo(nome, item.marca) ? item.marca : '';
    const mont = (m, c, suf) => [nome, m, c].filter(Boolean).join(' · ') + suf;
    const l = [];
    const add = t => { if (l.indexOf(t) < 0) l.push(t); };
    const combos = comCodigo ? [[marca, cod], ['', cod]] : [[marca, cod], [marca, ''], ['', '']];
    combos.forEach(([m, c]) => { if (comCodigo && !c) return; add(mont(m, c, SUFIXO_LONGO)); add(mont(m, c, SUFIXO_CURTO)); });
    if (!l.length) { add(mont('', '', SUFIXO_LONGO)); add(mont('', '', SUFIXO_CURTO)); }
    return l;
  }
  const escolherTitle = (item, comCodigo) => { const c = candidatosTitle(item, comCodigo); return c.find(t => t.length <= SEO_TITLE_ALVO) || c[c.length - 1]; };
  /** títulos de TODOS os itens, alinhados ao array; duplicados são desambiguados pelo código */
  function titulosProdutos(itens) {
    let t = itens.map(e => escolherTitle(e, false));
    const cont = {}; t.forEach(x => { cont[x] = (cont[x] || 0) + 1; });
    t = t.map((x, i) => (cont[x] > 1 ? escolherTitle(itens[i], true) : x));
    const c2 = {}; t.forEach(x => { c2[x] = (c2[x] || 0) + 1; });
    return t.map((x, i) => (c2[x] > 1 ? x.replace(/( \| MR4(?: Distribuidora)?)$/, ' · ' + itens[i].slugCodigo + '$1') : x));
  }
  const _cacheTitulos = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function tituloProduto(item, itens) {
    if (!itens) return escolherTitle(item, false);
    let m = _cacheTitulos && _cacheTitulos.get(itens);
    if (!m) { const ts = titulosProdutos(itens); m = new Map(itens.map((e, i) => [e, ts[i]])); if (_cacheTitulos) _cacheTitulos.set(itens, m); }
    return m.get(item) || escolherTitle(item, false);
  }
  /** texto limpo da descrição real: sem rótulos soltos ("Especificação:"), marcadores e quebras; vira uma linha com "; " */
  function excertoDescricao(desc) {
    return String(desc || '').split(/\r?\n/).map(l => l.replace(/^[\s\-–.•*]+/, '').replace(/^\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim())
      .map(l => l.replace(/[.;,\s]+$/, '')).filter(l => l && !/:$/.test(l)).join('; ').replace(/;\s*;/g, ';').replace(/[;,\s]+$/, '');
  }
  /** descrição real = existe, não é o próprio nome (nem está contida nele) e tem conteúdo */
  function descricaoSubstantiva(item) {
    const d = norm(excertoDescricao(item.p.desc)), n = norm(item.p.name);
    return d.length >= 3 && d !== n && (' ' + n + ' ').indexOf(' ' + d + ' ') < 0;
  }
  const listaPt = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1]);
  /** META: 120–160 quando os dados permitem; sem inventar; nunca promete disponibilidade (preço/estoque mudam) */
  function metaDescricaoProduto(item) {
    const p = item.p, cod = String(p.ref || '').trim(), MAX = 160;
    const marca = item.marca, cat = item.semGrupo ? '' : item.catRotulo;
    if (descricaoSubstantiva(item)) {
      const cab = cortarPalavra(p.name, 80) + (marca && !contemTermo(p.name, marca) ? ' ' + marca : '') + (cod ? ` (cód. ${cod})` : '') + ': ';
      const cauda = ' Catálogo B2B MR4 Distribuidora.';
      const sobra = MAX - cab.length - cauda.length;
      if (sobra >= 30) {
        const ex = cortarPalavra(excertoDescricao(p.desc), sobra);
        return cab + ex + (/[.…!?]$/.test(ex) ? '' : '.') + cauda;
      }
    }
    const fato = (nome) => `${nome}${cod ? `, código ${cod}` : ''}${marca ? `, da marca ${marca}` : ''}${cat ? `, na categoria ${cat}` : ''}.`;
    const caudas = [' Consulte preço e estoque atuais no catálogo B2B da MR4 Distribuidora.', ' Catálogo B2B da MR4 Distribuidora.', ' MR4 Distribuidora.'];
    for (const c of caudas) { const t = fato(p.name) + c; if (t.length <= MAX) return t; }
    const resto = fato('').length + caudas[2].length;
    return fato(cortarPalavra(p.name, Math.max(30, MAX - resto))) + caudas[2];
  }
  /** metadados de compartilhamento — sem preço e sem estoque (mudam a cada sync) */
  function metaProduto(item, origem, logo, titulo) {
    const p = item.p;
    return { title: titulo || tituloProduto(item), description: metaDescricaoProduto(item), url: origem + item.url, image: p.img || (origem + logo), imagemDoProduto: !!p.img };
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

  /** o texto digitado tem alguma palavra que existe no catálogo (nome/código/marca/categoria)? usado só para decidir se o termo de busca pode ser medido */
  function termoConhecido(itens, q) {
    const ks = tokens(q); if (!ks.length) return false;
    return (itens || []).some(e => { const t = norm(e.p.name + ' ' + e.p.ref + ' ' + (e.marca || '') + ' ' + (e.catRotulo || '')); return ks.some(k => t.indexOf(k) >= 0); });
  }
  /** item para o GA4 a partir de um item preparado (e): só dados públicos do catálogo — código, nome, marca, categoria e preço unitário */
  function itemAnalytics(e, qtd) {
    if (!e || !e.p) return null;
    const c = precoCentavos(e.p.price);
    const o = { item_id: String(e.p.ref), item_name: e.p.name };
    if (e.marca) o.item_brand = e.marca;
    if (!e.semGrupo && e.catRotulo) o.item_category = e.catRotulo;
    if (c != null) o.price = c / 100;
    if (qtd != null) o.quantity = normalizarQtd(qtd);
    return o;
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
    EDITORIAL_CAMPOS, validarEditorial, aplicarEditorial, aliasMarca, descricaoEditorialProblema,
    MAPA_MARCAS, MARCAS_INVALIDAS, marcaNormalizada, relatorioMarcas, marcasNaoUnificadas,
    ORDEM_CATEGORIAS, prioridadeCategoria, ehSemGrupo, rotuloCategoria, ROTULO_SEM_GRUPO, ordenarCategorias,
    precoNumerico, prepararCatalogo, buscar, ordenar, consultar, opcoesMarca, mensagemWhatsProduto, osa,
    slugify, slugNome, hash4, resolverProduto, atribuirTaxonomia, taxonomia, urlLimpa, BASE_CATEGORIA, BASE_MARCA, htmlRelacionadosEstatico, htmlListaProdutosSeo, titulosProdutos, tituloProduto, metaDescricaoProduto, descricaoSubstantiva, excertoDescricao, cortarPalavra, contemTermo, listaPt, SEO_TITLE_ALVO, relacionados, esc, htmlBreadcrumb, htmlProdutoInfo, descricaoCurta, metaProduto,
    copiarLink, compartilhar, BASE_PRODUTO, PLACEHOLDER_SVG, htmlCard, htmlAcao, MODOS, normalizarModo, htmlLinha, htmlCabecalhoLista, rapidoBuscar, rapidoMover, rapidoAcimaDoEstoque, rapidoFeedback,
    MAX_QTD, normalizarQtd, precoCentavos, formatarCentavos, resolverPedido, itemAnalytics, termoConhecido
  };
});

/* Medição (GA4): stub + carregador. Mantém Medicao.track() sempre disponível (fila) e baixa js/catalogo-medicao.js depois do load,
 * sem alterar o HTML das páginas. Guarda a URL de entrada ANTES de qualquer normalização (UTMs). Nunca quebra o catálogo. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.Medicao) return;
  try {
    window.__mr4url0 = location.href;
    const fila = [];
    window.Medicao = { q: fila, track: function (n, p) { if (fila.length < 60) fila.push([n, p]); return true; }, stub: true };
    const carregar = function () {
      try {
        const s = document.createElement('script');
        s.async = true; s.src = '/js/catalogo-medicao.js?v=ga1-1';
        document.head.appendChild(s);
      } catch (e) {}
    };
    if (document.readyState === 'complete') setTimeout(carregar, 0); else window.addEventListener('load', function () { setTimeout(carregar, 0); });
  } catch (e) {}
})();
