/**
 * MR4 Catálogo — camada de medição (GA4). UMA porta de entrada: Medicao.track(nome, params).
 *
 * Princípios (Fase GA4, 03/10/2026):
 *  - Analytics NUNCA é dependência do catálogo: tudo em try/catch; sem ID, sem rede ou com bloqueador ⇒ no-op silencioso.
 *  - PRIVACIDADE: lista fechada de eventos e de parâmetros por evento (o resto é descartado). Nunca entram: nome do cliente,
 *    telefone/WhatsApp (nem de vendedor), mensagem do WhatsApp, CNPJ/CPF/e-mail, endereço, texto livre sem filtro.
 *    Termo de busca: só passa pela política de `termoSeguro` (limite de tamanho, sem e-mail/URL/número longo, e só se casar com o catálogo).
 *  - URL: page_location/page_referrer são reescritos SEM query (some ?q=, ?cat=, ...); só utm_* são mantidos (aquisição).
 *  - `purchase` NÃO existe: não há confirmação de venda. A macroconversão observável é `whatsapp_order_click` (clique para enviar o
 *    pedido pelo WhatsApp) — não prova envio, recebimento, faturamento nem venda.
 *  - Google Signals e personalização de anúncios desligados; Consent Mode: só analytics_storage concedido.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const M = factory();
    const antigo = root.Medicao;
    root.Medicao = M.criar(root);
    root.Medicao.auto();                                                                                // page_view + cliques das páginas institucionais
    if (antigo && antigo.q) antigo.q.forEach(function (x) { root.Medicao.track(x[0], x[1]); });     // descarrega a fila do stub
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_MEDICAO = 'G-S2HWQDPSQW';   // Measurement ID da propriedade GA4 "MR4 Catálogo B2B" (público, não é segredo). null ⇒ medição desligada (no-op)

  /* ───────── política de dados ───────── */
  const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const URL_RE = /https?:\/\/|www\.|wa\.me|\.com\b|\.br\b/i;
  const TEL = /(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/;       // telefone BR (10–13 dígitos)
  const proibidoEmTexto = s => EMAIL.test(s) || URL_RE.test(s) || TEL.test(s) || (String(s).replace(/\D/g, '').length >= 9 && /\d[\s.-]?\d[\s.-]?\d/.test(s) && /\d{9}/.test(String(s).replace(/[\s.-]/g, '')));
  const MAX_TERMO = 40, MAX_PALAVRAS = 5, MAX_STR = 100, MAX_ITENS = 20;

  /** termo de busca digitado → termo seguro (string) ou null. `resultados` e `conhecido` vêm do catálogo. */
  function termoSeguro(q, o) {
    o = o || {};
    let t = String(q == null ? '' : q).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return null;
    if (EMAIL.test(t) || URL_RE.test(t)) return null;
    if (TEL.test(t) || t.replace(/\D/g, '').length >= 8) return null;                // telefone, CPF, CNPJ, EAN longos
    if (t.length > MAX_TERMO) t = t.slice(0, MAX_TERMO).replace(/\s+\S*$/, '');
    if (!t || t.split(' ').length > MAX_PALAVRAS) return null;
    // sem correspondência no catálogo e sem nenhuma palavra conhecida ⇒ pode ser nome de pessoa: não envia o texto
    if (o.resultados === 0 && o.conhecido === false) return null;
    return t;
  }

  /* ───────── esquema fechado: evento → { parâmetro: tipo } ─────────
   * s = string curta, n = número finito, b = booleano, i = itens (lista), t = texto livre já filtrado por termoSeguro */
  const ESQUEMA = {
    page_view: { page_type: 's', page_category: 's', page_brand: 's' },
    view_item: { currency: 's', value: 'n', items: 'i' },
    select_item: { item_list_name: 's', items: 'i' },
    search: { search_term: 't', search_term_length: 'n', results_count: 'n' },
    search_no_results: { search_term: 't', search_term_length: 'n' },
    filter_apply: { filter_type: 's', filter_value: 's', results_count: 'n' },
    view_mode_change: { mode: 's' },
    add_to_cart: { currency: 's', value: 'n', items: 'i', origin: 's' },
    remove_from_cart: { currency: 's', value: 'n', items: 'i', origin: 's' },
    quantity_change: { item_id: 's', quantity_from: 'n', quantity_to: 'n' },
    view_cart: { currency: 's', value: 'n', items: 'i', item_count: 'n' },
    salesperson_selection_view: { origin: 's' },
    salesperson_select: { salesperson_id: 's', context: 's' },
    whatsapp_order_click: { salesperson_id: 's', item_count: 'n', line_count: 'n', value: 'n', currency: 's', flow: 's', message_truncated: 'b' },
    whatsapp_contact_click: { salesperson_id: 's', origin: 's', item_id: 's' },
    phone_click: { origin: 's' },
    quick_order_open: { origin: 's' },
    quick_order_add: { item_id: 's', quantity: 'n' },
    quick_order_no_match: { search_term: 't', search_term_length: 'n' },
    quick_order_to_cart: { item_count: 'n' }
  };
  const CAMPOS_ITEM = { item_id: 's', item_name: 's', item_brand: 's', item_category: 's', price: 'n', quantity: 'n', index: 'n' };

  const str = v => { if (v == null) return undefined; const s = String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_STR); return s && !proibidoEmTexto(s) ? s : undefined; };
  const num = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : undefined; };

  function limparItem(it) {
    const o = {};
    Object.keys(CAMPOS_ITEM).forEach(k => {
      if (!it || it[k] == null) return;
      const v = CAMPOS_ITEM[k] === 'n' ? num(it[k]) : str(it[k]);
      if (v !== undefined) o[k] = v;
    });
    return o.item_id ? o : null;
  }
  /** valida e sanitiza: devolve { nome, params } ou null (evento desconhecido) */
  function limpar(nome, params) {
    const esq = ESQUEMA[nome];
    if (!esq) return null;
    const out = {};
    params = params || {};
    Object.keys(esq).forEach(k => {
      const v = params[k]; if (v == null) return;
      const tipo = esq[k];
      let r;
      if (tipo === 'n') r = num(v);
      else if (tipo === 'b') r = typeof v === 'boolean' ? v : undefined;
      else if (tipo === 'i') { const l = (Array.isArray(v) ? v : []).slice(0, MAX_ITENS).map(limparItem).filter(Boolean); r = l.length ? l : undefined; }
      else if (tipo === 't') r = typeof v === 'string' && v === termoSeguro(v) ? v : undefined;   // já deve vir de termoSeguro
      else r = str(v);
      if (r !== undefined) out[k] = r;
    });
    return { nome, params: out };
  }

  /* ───────── URL sem PII ───────── */
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'];
  function urlSegura(href, base) {
    try {
      const u = new URL(href, base || 'https://catalogo.mr4distribuidora.com.br/');
      const manter = new URLSearchParams();
      UTM.forEach(k => { const v = u.searchParams.get(k); if (v && v.length <= 80 && !proibidoEmTexto(v)) manter.set(k, v); });
      const s = manter.toString();
      return u.origin + u.pathname + (s ? '?' + s : '');
    } catch (e) { return undefined; }
  }
  function referrerSeguro(ref) {
    if (!ref) return undefined;
    try { const u = new URL(ref); return u.origin + u.pathname; } catch (e) { return undefined; }
  }

  /* ───────── instância (navegador) ───────── */
  function criar(win, opcoes) {
    opcoes = opcoes || {};
    const id = opcoes.id !== undefined ? opcoes.id : ID_MEDICAO;
    const doc = win.document;
    let ativo = false, carregado = false;
    const log = [];                                   // últimos eventos aceitos (diagnóstico/testes)
    const hrefInicial = win.__mr4url0 || (win.location && win.location.href) || '';

    function gtag() { try { (win.dataLayer = win.dataLayer || []).push(arguments); } catch (e) {} }
    /** inicialização SÍNCRONA e sem rede (consent + config na dataLayer): eventos já nascem na fila e saem quando o gtag.js carregar */
    function iniciar() {
      if (ativo || !id || !/^G-[A-Z0-9]{6,}$/.test(id) || win.__mr4ga) return;
      win.__mr4ga = true; ativo = true;                // uma instalação por página
      try {
        win.gtag = win.gtag || gtag;
        win.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
        win.gtag('js', new Date());
        win.gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      } catch (e) {}
    }
    /** download do gtag.js só depois do load + ociosidade (não disputa com LCP) */
    function carregarScript() {
      if (!ativo || carregado) return; carregado = true;
      try {
        const s = doc.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
        doc.head.appendChild(s);                       // bloqueado/offline: a fila na dataLayer simplesmente nunca sai
      } catch (e) {}
    }
    const refSeguro = referrerSeguro(doc.referrer);
    /** TODO evento leva page_location/page_referrer reescritos: o gtag usaria document.location (com ?q= digitado) por padrão */
    function base() {
      const b = { page_location: urlSegura((win.location && win.location.href) || hrefInicial) };
      if (refSeguro) b.page_referrer = refSeguro;
      return b;
    }
    function enviar(nome, params) {
      try {
        const l = limpar(nome, params); if (!l) return false;
        Object.assign(l.params, base());
        log.push(l); if (log.length > 50) log.shift();
        if (!ativo) return true;
        (win.gtag || gtag)('event', l.nome, l.params);
        return true;
      } catch (e) { return false; }
    }
    function track(nome, params) {
      try {
        if (nome === 'page_view') return pageView(params);
        return enviar(nome, params);
      } catch (e) { return false; }
    }
    function pageView(extra) {
      try {
        const l = limpar('page_view', extra || {}); if (!l) return false;
        const p = l.params;
        p.page_location = urlSegura(hrefInicial);                               // URL de ENTRADA sem query (mantém utm_* para aquisição)
        if (refSeguro) p.page_referrer = refSeguro;
        p.page_title = String(doc.title || '').slice(0, 120);
        log.push({ nome: 'page_view', params: p });
        if (ativo) (win.gtag || gtag)('event', 'page_view', p);
        return true;
      } catch (e) { return false; }
    }
    function quandoOcioso(f) {
      try { if (win.requestIdleCallback) win.requestIdleCallback(f, { timeout: 3000 }); else win.setTimeout(f, 1200); } catch (e) { try { f(); } catch (x) {} }
    }
    // gtag.js só depois do load + ociosidade (não disputa com LCP/renderização)
    if (id) {
      iniciar();                                                                // já: dataLayer/consent/config (sem rede)
      const subir = function () { quandoOcioso(carregarScript); };
      if (doc.readyState === 'complete') subir(); else win.addEventListener('load', subir);
    }
    /** tipo da página a partir do que o HTML já declara (sem ler nada digitado pelo usuário) */
    function tipoPagina() {
      const b = doc.body, d = (b && b.dataset) || {}, path = (win.location && win.location.pathname) || '';
      if (/^\/produto\//.test(path)) return 'produto';
      if (/^\/(sobre|contato|privacidade)\//.test(path)) return 'institucional';
      if (d.pagina === '404') return 'erro_404';
      return d.pagina || 'home';
    }
    let automatico = false;
    function auto() {
      if (automatico) return; automatico = true;
      try {
        const b = doc.body, d = (b && b.dataset) || {};
        pageView({ page_type: tipoPagina(), page_category: d.cat || undefined, page_brand: d.marca || undefined });
        if (b && b.classList.contains('pagina-inst')) {                         // páginas institucionais não têm o JS do catálogo
          doc.addEventListener('click', function (e) {
            const a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (!a) return;
            const h = a.getAttribute('href') || '';
            if (/^https:\/\/wa\.me\//.test(h)) enviar('whatsapp_contact_click', { origin: 'pagina_institucional' });
            else if (/^tel:/.test(h)) enviar('phone_click', { origin: 'pagina_institucional' });
          });
        }
      } catch (e) {}
    }
    return { track, id, log, termoSeguro, ativo: () => ativo, auto, __iniciar: iniciar, __carregar: carregarScript };
  }

  return { criar, limpar, termoSeguro, urlSegura, referrerSeguro, ESQUEMA, CAMPOS_ITEM, proibidoEmTexto, ID_MEDICAO };
});
