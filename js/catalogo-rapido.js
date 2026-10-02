/* MR4 Catálogo — Pedido Rápido: digitar → escolher → quantidade → Enter → próximo produto.
 * Reutiliza a busca/ranking (CatalogoCore.rapidoBuscar → consultar), o pedido (Cesta.add soma ao que já existe),
 * o preço/estoque atuais do catálogo e o componente de quantidade. Não tem estado comercial próprio:
 * a única memória é a lista "Adicionados agora" (apenas em memória, some ao recarregar). Nenhuma foto. */
(function () {
  'use strict';
  const C = window.CatalogoCore, Cesta = window.Cesta;
  const $ = id => document.getElementById(id);
  const esc = C.esc;
  const LIMITE = 8;

  let itens = null, criado = false, aberto = false;
  let resultados = [], ativo = 0, selecionado = null, recentes = [];
  let compondo = false, fbTimer = null, ultimoFoco = null;
  const modal = () => window.matchMedia('(max-width:640px)').matches;

  const MARKUP = `
<section class="rapido" id="rapido" role="region" aria-labelledby="rapidoTit" hidden>
  <div class="rapido-cab">
    <h2 id="rapidoTit">Pedido rápido</h2>
    <button type="button" class="rapido-fechar" id="rapidoFechar" aria-label="Fechar pedido rápido">✕</button>
  </div>
  <div class="rapido-busca">
    <label class="sr-only" for="rapidoBusca">Digite produto ou código</label>
    <input id="rapidoBusca" type="text" role="combobox" aria-expanded="false" aria-controls="rapidoLista" aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant="" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Digite produto ou código…">
  </div>
  <ul class="rq-lista" id="rapidoLista" role="listbox" aria-label="Resultados do pedido rápido" hidden></ul>
  <p class="rq-msg" id="rapidoMsg" hidden></p>
  <div class="rq-sel" id="rapidoSel" hidden>
    <div class="rq-sel-info" id="rapidoSelInfo"></div>
    <div class="rq-sel-acao">
      <div class="qtd" role="group" aria-label="Quantidade">
        <button type="button" class="qb" data-rq="-1" aria-label="Diminuir quantidade">−</button>
        <input class="qi" id="rapidoQtd" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="1" aria-label="Quantidade">
        <button type="button" class="qb" data-rq="1" aria-label="Aumentar quantidade">+</button>
      </div>
      <button type="button" class="btn-add-cart rq-add" id="rapidoAdd">Adicionar <kbd>Enter</kbd></button>
    </div>
    <p class="rq-aviso" id="rapidoAviso" hidden></p>
  </div>
  <p class="rq-feedback" id="rapidoFeedback" role="status" aria-live="polite"></p>
  <div class="rq-recentes" id="rapidoRecentes" hidden><span class="rq-rec-tit">Adicionados agora</span><ul id="rapidoRecLista"></ul></div>
  <div class="rapido-rodape">
    <span class="rq-dica">↑↓ escolhe · Enter seleciona e adiciona · Esc volta</span>
    <button type="button" class="rq-ver" id="rapidoVer"><span id="rapidoResumo">Pedido vazio</span> <b>Ver pedido ›</b></button>
  </div>
  <div class="sr-only" id="rapidoStatus" role="status" aria-live="polite"></div>
</section>`;

  /* ───────── resultados ───────── */
  function rotuloEstoque(p) { return p.stock > 0 ? `${p.stock} em estoque` : 'Sem estoque'; }
  const classeEstoque = p => (p.stock > 10 ? 'ok' : p.stock > 0 ? 'low' : 'out');
  function buscar() {
    const q = $('rapidoBusca').value;
    const lista = $('rapidoLista'), msg = $('rapidoMsg'), campo = $('rapidoBusca');
    selecionado = null; $('rapidoSel').hidden = true;
    if (!itens) { resultados = []; lista.hidden = true; msg.hidden = false; msg.textContent = 'Carregando catálogo…'; return; }
    resultados = C.rapidoBuscar(itens, q, LIMITE);
    ativo = 0;
    if (!resultados.length) {
      lista.hidden = true; lista.innerHTML = '';
      campo.setAttribute('aria-expanded', 'false'); campo.setAttribute('aria-activedescendant', '');
      msg.hidden = !C.norm(q);
      if (C.norm(q)) { msg.textContent = 'Nenhum produto encontrado'; $('rapidoStatus').textContent = 'Nenhum produto encontrado'; }
      return;
    }
    msg.hidden = true;
    lista.innerHTML = resultados.map((e, i) => {
      const p = e.p, no = Cesta.qtdDe(p.id);
      return `<li role="option" id="rq-opt-${i}" class="rq-opt" aria-selected="${i === 0 ? 'true' : 'false'}" data-i="${i}">
        <span class="rq-nome">${esc(p.name)}</span>
        <span class="rq-meta">Cód. <b>${esc(p.ref)}</b>${e.marca ? ' · ' + esc(e.marca) : ''}${no ? ` · <span class="rq-no">${no} no pedido</span>` : ''}</span>
        <span class="rq-est ${classeEstoque(p)}">${rotuloEstoque(p)}</span>
        <span class="rq-preco">${esc(p.price)}</span>
      </li>`;
    }).join('');
    lista.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
    pintarAtivo();
    $('rapidoStatus').textContent = `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`;
  }
  function pintarAtivo() {
    document.querySelectorAll('#rapidoLista .rq-opt').forEach((li, i) => {
      const on = i === ativo;
      li.setAttribute('aria-selected', on ? 'true' : 'false'); li.classList.toggle('ativo', on);
      if (on) { $('rapidoBusca').setAttribute('aria-activedescendant', li.id); try { li.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    });
  }

  /* ───────── seleção e quantidade ───────── */
  function selecionar(i) {
    const e = resultados[i]; if (!e) return;
    selecionado = e;
    const p = e.p, no = Cesta.qtdDe(p.id);
    $('rapidoLista').hidden = true; $('rapidoBusca').setAttribute('aria-expanded', 'false'); $('rapidoBusca').setAttribute('aria-activedescendant', '');
    $('rapidoSelInfo').innerHTML = `<strong>${esc(p.name)}</strong>
      <span>Cód. <b>${esc(p.ref)}</b>${e.marca ? ' · ' + esc(e.marca) : ''}</span>
      <span><b class="rq-preco-sel">${esc(p.price)}</b> · <span class="rq-est ${classeEstoque(p)}">${rotuloEstoque(p)}</span></span>
      ${no ? `<span class="rq-no">Já no pedido: ${no} un. (a quantidade será somada)</span>` : ''}`;
    $('rapidoQtd').value = '1';
    $('rapidoSel').hidden = false;
    avisoEstoque();
    $('rapidoStatus').textContent = `Selecionado: ${p.name}. Digite a quantidade e tecle Enter.`;
    const q = $('rapidoQtd'); q.focus(); try { q.select(); } catch (err) {}
  }
  const qtdAtual = () => C.normalizarQtd($('rapidoQtd').value);
  function avisoEstoque() {
    const el = $('rapidoAviso');
    if (!selecionado) { el.hidden = true; return; }
    const p = selecionado.p;
    const acima = C.rapidoAcimaDoEstoque(p.stock, Cesta.qtdDe(p.id), qtdAtual());
    el.hidden = !acima;
    if (acima) el.textContent = `Pedido ficará acima do estoque atual (${p.stock}). O atendimento confirma a disponibilidade.`;
  }
  function limparSelecao() { selecionado = null; $('rapidoSel').hidden = true; $('rapidoAviso').hidden = true; }

  /* ───────── adicionar (soma ao que já está no pedido) ───────── */
  function adicionar() {
    if (!selecionado) return;
    const p = selecionado.p, qtd = qtdAtual();
    const antes = Cesta.qtdDe(p.id);
    Cesta.add(p, qtd);                                   // Cesta soma e respeita o teto de 9.999
    const agora = Cesta.qtdDe(p.id), adicionado = agora - antes;
    let texto = C.rapidoFeedback(p.name, adicionado, agora);
    if (agora > p.stock) texto += ` · acima do estoque atual (${p.stock})`;
    const fb = $('rapidoFeedback'); fb.textContent = texto; fb.classList.toggle('alerta', agora > p.stock);
    clearTimeout(fbTimer); fbTimer = setTimeout(() => { fb.textContent = ''; }, 8000);
    recentes.unshift({ nome: p.name, ref: p.ref, qtd: adicionado }); recentes = recentes.slice(0, 5);
    pintarRecentes();
    // pronto para o próximo: seleção e busca limpas, foco de volta na busca
    limparSelecao();
    const campo = $('rapidoBusca'); campo.value = ''; buscar();
    campo.focus();
  }
  function pintarRecentes() {
    const box = $('rapidoRecentes');
    box.hidden = !recentes.length;
    $('rapidoRecLista').innerHTML = recentes.map(r => `<li>${esc(r.nome)} <b>×${r.qtd}</b></li>`).join('');
  }
  function resumoPedido() {
    const r = Cesta.resumo();
    const n = r.totalItens;
    $('rapidoResumo').textContent = n ? `Pedido: ${n} ${n === 1 ? 'item' : 'itens'}${r.carregado && r.totalCent ? ' · ' + C.formatarCentavos(r.totalCent) : ''}` : 'Pedido vazio';
  }

  /* ───────── abrir / fechar ───────── */
  function criar() {
    const ancora = document.querySelector('.barra');
    ancora.insertAdjacentHTML('afterend', MARKUP);
    criado = true;
    const painel = $('rapido'), campo = $('rapidoBusca');
    campo.addEventListener('input', buscar);
    campo.addEventListener('compositionstart', () => { compondo = true; });
    campo.addEventListener('compositionend', () => { compondo = false; buscar(); });
    painel.addEventListener('keydown', aoTeclar);
    $('rapidoLista').addEventListener('mousedown', e => e.preventDefault());       // clicar numa opção não tira o foco do campo antes da hora
    $('rapidoLista').addEventListener('click', e => { const li = e.target.closest('.rq-opt'); if (li) { ativo = Number(li.dataset.i); pintarAtivo(); selecionar(ativo); } });
    painel.addEventListener('click', e => {
      const b = e.target.closest('[data-rq]');
      if (b) { $('rapidoQtd').value = String(Math.max(1, Math.min(C.MAX_QTD, qtdAtual() + Number(b.dataset.rq)))); avisoEstoque(); return; }
    });
    $('rapidoQtd').addEventListener('input', e => { const l = e.target.value.replace(/\D/g, '').slice(0, 4); if (l !== e.target.value) e.target.value = l; avisoEstoque(); });
    $('rapidoAdd').addEventListener('click', adicionar);
    $('rapidoFechar').addEventListener('click', fechar);
    $('rapidoVer').addEventListener('click', () => { if (modal()) fechar(true); Cesta.abrirPedido(); });
    Cesta.aoMudar(() => { resumoPedido(); if (aberto && selecionado) avisoEstoque(); });
    resumoPedido();
  }
  function aoTeclar(e) {
    if (compondo || e.isComposing || e.keyCode === 229) return;                    // não age durante composição (IME/acentos)
    const emBusca = e.target === $('rapidoBusca'), emQtd = e.target === $('rapidoQtd');
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (selecionado) { limparSelecao(); buscar(); $('rapidoBusca').focus(); }                               // 2) limpa a seleção
      else if (!$('rapidoLista').hidden) { $('rapidoLista').hidden = true; $('rapidoBusca').setAttribute('aria-expanded', 'false'); $('rapidoBusca').setAttribute('aria-activedescendant', ''); }   // 1) fecha os resultados
      else fechar();                                                                                          // 3) fecha o painel
      return;
    }
    if (emBusca && !selecionado && resultados.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if ($('rapidoLista').hidden) { $('rapidoLista').hidden = false; $('rapidoBusca').setAttribute('aria-expanded', 'true'); }
        else ativo = C.rapidoMover(ativo, e.key === 'ArrowDown' ? 1 : -1, resultados.length);
        pintarAtivo(); return;
      }
      if (e.key === 'Enter') { e.preventDefault(); if (!$('rapidoLista').hidden) selecionar(ativo); return; }       // nunca adiciona sozinho: só seleciona o destacado
    }
    if (emQtd && e.key === 'Enter') { e.preventDefault(); adicionar(); return; }
    if (e.key === 'Tab' && modal()) {                                                                         // celular: diálogo de verdade
      const f = [...$('rapido').querySelectorAll('button:not([disabled]),input:not([disabled])')].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const primeiro = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
  }
  function abrir() {
    if (!criado) criar();
    const painel = $('rapido');
    ultimoFoco = document.activeElement;
    painel.hidden = false; aberto = true;
    if (modal()) { painel.setAttribute('role', 'dialog'); painel.setAttribute('aria-modal', 'true'); document.body.style.overflow = 'hidden'; }
    else { painel.setAttribute('role', 'region'); painel.removeAttribute('aria-modal'); }
    const b = $('btnRapido'); if (b) b.setAttribute('aria-expanded', 'true');
    resumoPedido();
    setTimeout(() => $('rapidoBusca').focus(), 30);
  }
  function fechar(semFoco) {
    if (!criado) return;
    $('rapido').hidden = true; aberto = false; document.body.style.overflow = '';
    const b = $('btnRapido'); if (b) b.setAttribute('aria-expanded', 'false');
    if (semFoco !== true) { const alvo = b || ultimoFoco; if (alvo) { try { alvo.focus(); } catch (e) {} } }
  }
  function alternar() { if (aberto) fechar(); else abrir(); }

  document.addEventListener('keydown', e => {                                     // atalho secundário: Alt+Q (o botão visível continua sendo o acesso principal)
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyQ') { e.preventDefault(); if (document.querySelector('.cart-sidebar.open:not(.dock),.vendedor-modal.open,.sheet-bg.open')) return; if (aberto) $('rapidoBusca').focus(); else abrir(); }
  });

  window.Rapido = {
    definirCatalogo(lista) { itens = lista; if (criado && aberto && $('rapidoBusca').value) buscar(); },
    abrir, fechar, alternar, aberto: () => aberto
  };
})();
