'use strict';
/**
 * Lógica PURA do monitoramento do catálogo (testável sem rede):
 *  · validarFeed        — integridade do data/produtos.json (corrupção/forma);
 *  · ultimoSyncConcluido — última execução do sync que CONCLUIU de verdade (marcador de passo), ignorando execuções "API indisponível";
 *  · avaliar            — transforma observações em incidentes (SYNC_ATRASADO, SITE_INDISPONIVEL, FEED_CORROMPIDO, PUBLICACAO_DIVERGENTE, MONITOR_PARADO);
 *  · reconciliar        — UM alerta (Issue) por incidente: cria na 1ª detecção, não repete enquanto durar, avisa e fecha na recuperação.
 */
const MARCADOR = 'Sincronização concluída (marcador)';          // nome do passo no workflow sync-produtos.yml (teste estático garante a existência)
const LABEL = 'monitor-catalogo';
const PREFIXO = '[Catálogo] ';
const LIMITES = Object.freeze({ syncMaxMin: 120, publicacaoMaxMin: 30, feedMinItens: 100, monitorMaxMin: 180 });
const TIPOS = Object.freeze(['SYNC_ATRASADO', 'SITE_INDISPONIVEL', 'FEED_CORROMPIDO', 'PUBLICACAO_DIVERGENTE', 'MONITOR_PARADO']);
const min = (a, b) => Math.round((a - b) / 60000);
const fmtIdade = m => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

function validarFeed(f, limites = LIMITES) {
  const p = [];
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, problemas: ['JSON não é um objeto'] };
  if (!Array.isArray(f.produtos)) p.push('"produtos" ausente ou não é lista');
  if (!Number.isInteger(f.total)) p.push('"total" ausente ou inválido'); else if (Array.isArray(f.produtos) && f.total !== f.produtos.length) p.push(`"total" (${f.total}) diverge do tamanho da lista (${f.produtos.length})`);
  if (!Number.isFinite(Date.parse(f.atualizado))) p.push('"atualizado" ausente ou não é data');
  if (Array.isArray(f.produtos)) {
    if (f.produtos.length < limites.feedMinItens) p.push(`apenas ${f.produtos.length} produtos (mínimo ${limites.feedMinItens})`);
    const ruins = f.produtos.filter(x => !x || typeof x !== 'object' || x.id == null || typeof x.name !== 'string' || !x.name || !(typeof x.price === 'string' ? /\d/.test(x.price) : Number(x.price) >= 0) || !Number.isFinite(Number(x.stock))).length;
    if (ruins > 0) p.push(`${ruins} produto(s) sem id/nome/preço/estoque válidos`);
    const ids = new Set(f.produtos.map(x => x && x.id)); if (ids.size !== f.produtos.length) p.push('ids duplicados');
  }
  return { ok: p.length === 0, problemas: p };
}

/** `runs`: lista de runs concluídos (mais novo primeiro); `jobsPorRun`: id → jobs. Conta SÓ run cujo passo-marcador teve conclusão "success". */
function ultimoSyncConcluido(runs, jobsPorRun) {
  for (const r of runs || []) {
    if (r.conclusion !== 'success') continue;
    const jobs = jobsPorRun[r.id] || [];
    const marcou = jobs.some(j => j.conclusion === 'success' && (j.steps || []).some(s => s.name === MARCADOR && s.conclusion === 'success'));
    if (marcou) { const quando = (jobs.find(j => j.completed_at) || {}).completed_at || r.updated_at; return { runId: r.id, concluidoEm: quando }; }
  }
  return null;
}

/** observações → incidentes */
function avaliar({ agora, sync, site, repoFeed, limites = LIMITES }) {
  const inc = [];
  const idadeSync = sync && sync.concluidoEm ? min(agora, Date.parse(sync.concluidoEm)) : null;
  if (idadeSync === null || idadeSync > limites.syncMaxMin) inc.push({ tipo: 'SYNC_ATRASADO', detalhe: idadeSync === null ? `nenhuma sincronização CONCLUÍDA nas últimas execuções verificadas (limite ${limites.syncMaxMin} min)` : `última sincronização concluída há ${fmtIdade(idadeSync)} (limite ${fmtIdade(limites.syncMaxMin)}); o feed no ar está desatualizado em relação ao GestãoClick` });
  if (!site || !site.ok) inc.push({ tipo: 'SITE_INDISPONIVEL', detalhe: `catálogo público inacessível ou sem feed legível (${(site && site.erro) || 'sem detalhe'})` });
  else {
    const v = validarFeed(site.feed, limites);
    if (!v.ok) inc.push({ tipo: 'FEED_CORROMPIDO', detalhe: `feed público inválido: ${v.problemas.join('; ')}` });
    else if (repoFeed && validarFeed(repoFeed, limites).ok) {
      const atraso = min(Date.parse(repoFeed.atualizado), Date.parse(site.feed.atualizado));
      if (atraso > limites.publicacaoMaxMin) inc.push({ tipo: 'PUBLICACAO_DIVERGENTE', detalhe: `o repositório tem dados ${fmtIdade(atraso)} mais novos que o site publicado (limite ${limites.publicacaoMaxMin} min): publicação travada?` });
    }
  }
  return inc;
}

const tituloDe = tipo => `${PREFIXO}${tipo}`;
const tipoDe = titulo => { const m = new RegExp(`^${PREFIXO.replace(/[[\]]/g, '\\$&')}([A-Z_]+)`).exec(String(titulo || '')); return m ? m[1] : null; };
const corpoDe = (i, agora) => `**Incidente:** ${i.tipo}\n\n${i.detalhe}\n\n- Detectado em: ${new Date(agora).toISOString()}\n- Este é o **único** aviso deste incidente; quando normalizar, um comentário de recuperação será postado e a issue fechada.\n- Dados sensíveis nunca são incluídos neste alerta.`;

/** UM alerta por incidente. `escopo` limita quais tipos esta execução pode abrir/fechar (o vigia cruzado só mexe em MONITOR_PARADO). */
async function reconciliar({ incidentes, github, agora = Date.now(), escopo = TIPOS }) {
  await github.garantirLabel(LABEL, 'b60205', 'Alertas automáticos do monitoramento do catálogo');
  const abertas = (await github.issuesAbertas(LABEL)).filter(i => !i.pull_request);
  const porTipo = new Map(abertas.map(i => [tipoDe(i.title), i]).filter(([t]) => t && escopo.includes(t)));
  const acoes = { criadas: [], recuperadas: [], mantidas: [] };
  for (const i of incidentes.filter(x => escopo.includes(x.tipo))) {
    const ex = porTipo.get(i.tipo);
    if (!ex) { const c = await github.criarIssue({ title: tituloDe(i.tipo), body: corpoDe(i, agora), labels: [LABEL] }); acoes.criadas.push({ tipo: i.tipo, numero: c && c.number }); }
    else acoes.mantidas.push({ tipo: i.tipo, numero: ex.number });                          // sem novo e-mail: nem comentário, nem nova issue
  }
  const ativos = new Set(incidentes.map(x => x.tipo));
  for (const [tipo, ex] of porTipo) if (!ativos.has(tipo)) {
    await github.comentar(ex.number, `✅ **Recuperado** em ${new Date(agora).toISOString()}: o incidente ${tipo} não é mais detectado.`);
    await github.atualizarIssue(ex.number, { state: 'closed', state_reason: 'completed' }); acoes.recuperadas.push({ tipo, numero: ex.number });
  }
  return acoes;
}
module.exports = { MARCADOR, LABEL, LIMITES, TIPOS, validarFeed, ultimoSyncConcluido, avaliar, reconciliar, tipoDe, tituloDe, fmtIdade };
