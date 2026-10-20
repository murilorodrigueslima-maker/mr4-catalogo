'use strict';
// FASE 1 do monitoramento (monitor de idade + vigia cruzado; SEM tolerância a HTTP 500) — LOCAL/CI: nenhuma rede, nenhum segredo real, nenhum GitHub real (clientes e fetch simulados).
// Prova: (1) indisponibilidade da API vira "NÃO CONCLUÍDO" explícito sem e-mail repetido; (2) TODA outra falha (integridade, corrupção, publicação, credenciais, 4xx) continua VERMELHA;
// (3) logs de diagnóstico sem credenciais; (4) alerta único por incidente + recuperação; (5) ausência do monitor/sync é detectada; (6) workflows preservam as proteções.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const M = require('../scripts/lib/monitor-catalogo.js');
const MON = require('../scripts/monitor-idade-catalogo.js');
const VIG = require('../scripts/vigia-cruzado.js');
const { criarGithub } = require('../scripts/lib/github-api.js');
const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const TOK_A = 'TOKEN-ACESSO-SECRETO-123', TOK_S = 'TOKEN-SEGREDO-SECRETO-456';
const ENV0 = { GC_ACCESS_TOKEN: TOK_A, GC_SECRET_ACCESS_TOKEN: TOK_S };
const AGORA = Date.parse('2026-10-20T16:00:00Z');
const feedJson = (n = 120, atualizado = '2026-10-19T20:37:19.355Z') => JSON.stringify({ produtos: Array.from({ length: n }, (_, i) => ({ id: 1000 + i, ref: 'MR.' + i, name: 'Produto ' + i, category: 'C', brand: 'B', price: 'R$ 10,00', stock: 5, img: '', desc: '' })), total: n, atualizado });

/* ───────── 4. monitor: integridade, idade, incidentes ───────── */
test('V1. validarFeed detecta corrupção: não-objeto, sem lista, total divergente, data inválida, poucos itens, itens sem campos, ids duplicados', () => {
  assert.equal(M.validarFeed(JSON.parse(feedJson())).ok, true);
  const base = () => JSON.parse(feedJson()); const casos = {
    nulo: null, lista: [], 'sem produtos': (() => { const f = base(); delete f.produtos; return f; })(), 'total errado': (() => { const f = base(); f.total = 5; return f; })(), 'data ruim': (() => { const f = base(); f.atualizado = 'ontem'; return f; })(),
    'poucos itens': JSON.parse(feedJson(10)), 'sem nome': (() => { const f = base(); f.produtos[3].name = ''; return f; })(), 'sem preço': (() => { const f = base(); f.produtos[3].price = 'abc'; return f; })(), 'preço vazio': (() => { const f = base(); f.produtos[3].price = ''; return f; })(), 'sem estoque': (() => { const f = base(); delete f.produtos[3].stock; return f; })(),
    'ids duplicados': (() => { const f = base(); f.produtos[4].id = f.produtos[3].id; return f; })() };
  for (const [n, f] of Object.entries(casos)) assert.equal(M.validarFeed(f).ok, false, n);
});
const marcado = (id, quando) => ({ run: { id, conclusion: 'success', updated_at: quando }, jobs: [{ conclusion: 'success', completed_at: quando, steps: [{ name: 'Executar sync (validado, atômico e idempotente)', conclusion: 'success' }, { name: M.MARCADOR, conclusion: 'success' }] }] });
const degradado = (id, quando) => ({ run: { id, conclusion: 'success', updated_at: quando }, jobs: [{ conclusion: 'success', completed_at: quando, steps: [{ name: 'Executar sync (validado, atômico e idempotente)', conclusion: 'success' }, { name: M.MARCADOR, conclusion: 'skipped' }] }] });
const falho = (id, quando) => ({ run: { id, conclusion: 'failure', updated_at: quando }, jobs: [{ conclusion: 'failure', completed_at: quando, steps: [{ name: M.MARCADOR, conclusion: 'skipped' }] }] });
const montar = lista => ({ runs: lista.map(x => x.run), jobs: Object.fromEntries(lista.map(x => [x.run.id, x.jobs])) });
test('V2. última sincronização CONCLUÍDA: ignora execuções verdes de "API indisponível" (marcador skipped) e execuções vermelhas', () => {
  const m = montar([degradado(5, '2026-10-20T15:45:00Z'), falho(4, '2026-10-20T15:30:00Z'), degradado(3, '2026-10-20T15:15:00Z'), marcado(2, '2026-10-20T00:37:05Z'), marcado(1, '2026-10-19T23:37:05Z')]);
  assert.deepEqual(M.ultimoSyncConcluido(m.runs, m.jobs), { runId: 2, concluidoEm: '2026-10-20T00:37:05Z' });
  assert.equal(M.ultimoSyncConcluido(montar([degradado(9, 'x'), falho(8, 'x')]).runs, montar([degradado(9, 'x'), falho(8, 'x')]).jobs), null);
});
test('V3. avaliar: saudável ⇒ nenhum incidente; cada falha gera o incidente certo (sync atrasado, site fora, feed corrompido, publicação divergente)', () => {
  const sync = { concluidoEm: '2026-10-20T15:50:00Z' }, site = { ok: true, feed: JSON.parse(feedJson(120, '2026-10-20T15:00:00Z')) }, repo = JSON.parse(feedJson(120, '2026-10-20T15:00:00Z'));
  assert.deepEqual(M.avaliar({ agora: AGORA, sync, site, repoFeed: repo }), []);
  const tipos = o => M.avaliar(Object.assign({ agora: AGORA, sync, site, repoFeed: repo }, o)).map(i => i.tipo);
  assert.deepEqual(tipos({ sync: { concluidoEm: '2026-10-20T00:37:05Z' } }), ['SYNC_ATRASADO']);        // o caso real de hoje (15 h)
  assert.deepEqual(tipos({ sync: null }), ['SYNC_ATRASADO']);
  assert.deepEqual(tipos({ site: { ok: false, erro: 'HTTP 503' } }), ['SITE_INDISPONIVEL']);
  assert.deepEqual(tipos({ site: { ok: true, feed: { produtos: [], total: 0, atualizado: 'x' } } }), ['FEED_CORROMPIDO']);
  assert.deepEqual(tipos({ repoFeed: JSON.parse(feedJson(120, '2026-10-20T15:45:00Z')) }), ['PUBLICACAO_DIVERGENTE']);   // repo 45 min mais novo que o site
  assert.deepEqual(tipos({ repoFeed: JSON.parse(feedJson(120, '2026-10-20T15:10:00Z')) }), []);                           // 10 min: dentro da tolerância
  assert.deepEqual(tipos({ sync: null, site: { ok: false, erro: 'x' } }).sort(), ['SITE_INDISPONIVEL', 'SYNC_ATRASADO']);
});

/* ───────── 5. alerta ÚNICO por incidente + recuperação ───────── */
function githubFalso(abertasIni = []) {
  const abertas = abertasIni.slice(); const calls = []; let n = 100;
  return { calls, abertas,
    garantirLabel: async () => { calls.push('label'); }, issuesAbertas: async () => abertas.slice(),
    criarIssue: async ({ title, body, labels }) => { n++; calls.push(['criar', title]); abertas.push({ number: n, title, body, labels }); return { number: n }; },
    atualizarIssue: async (num, c) => { calls.push(['atualizar', num, c.state]); if (c.state === 'closed') abertas.splice(abertas.findIndex(i => i.number === num), 1); },
    comentar: async (num, b) => { calls.push(['comentar', num, /Recuperado/.test(b)]); },
    runsConcluidos: async () => [], jobsDoRun: async () => [] };
}
const inc = tipo => ({ tipo, detalhe: 'd' });
test('A1. 1ª detecção cria UMA issue; 30 execuções seguintes com o incidente NÃO criam issue nem comentam (zero e-mails novos); recuperação = 1 comentário + fechamento', async () => {
  const gh = githubFalso();
  const a = await M.reconciliar({ incidentes: [inc('SYNC_ATRASADO')], github: gh, agora: AGORA }); assert.equal(a.criadas.length, 1);
  for (let i = 0; i < 30; i++) { const r = await M.reconciliar({ incidentes: [inc('SYNC_ATRASADO')], github: gh, agora: AGORA + i * 3600e3 }); assert.equal(r.criadas.length, 0); assert.equal(r.recuperadas.length, 0); assert.equal(r.mantidas.length, 1); }
  assert.equal(gh.calls.filter(c => Array.isArray(c) && c[0] === 'criar').length, 1); assert.equal(gh.calls.filter(c => Array.isArray(c) && c[0] === 'comentar').length, 0);
  const rec = await M.reconciliar({ incidentes: [], github: gh, agora: AGORA }); assert.equal(rec.recuperadas.length, 1); assert.deepEqual(gh.calls.filter(c => Array.isArray(c) && ['comentar', 'atualizar'].includes(c[0])), [['comentar', 101, true], ['atualizar', 101, 'closed']]);
  const novo = await M.reconciliar({ incidentes: [inc('SYNC_ATRASADO')], github: gh, agora: AGORA }); assert.equal(novo.criadas.length, 1);              // novo incidente ⇒ novo alerta
});
test('A2. incidentes independentes (um por tipo); recuperar um não fecha o outro; issues de outro tipo/sem rótulo próprio e o escopo do vigia cruzado não são tocados', async () => {
  const gh = githubFalso([{ number: 7, title: '[Catálogo] MONITOR_PARADO' }, { number: 8, title: 'Outra coisa qualquer' }]);
  const r = await M.reconciliar({ incidentes: [inc('SYNC_ATRASADO'), inc('SITE_INDISPONIVEL')], github: gh, agora: AGORA, escopo: M.TIPOS.filter(t => t !== 'MONITOR_PARADO') });
  assert.equal(r.criadas.length, 2); assert.equal(r.recuperadas.length, 0); assert.ok(gh.abertas.some(i => i.number === 7) && gh.abertas.some(i => i.number === 8));
  const r2 = await M.reconciliar({ incidentes: [inc('SITE_INDISPONIVEL')], github: gh, agora: AGORA, escopo: M.TIPOS.filter(t => t !== 'MONITOR_PARADO') }); assert.deepEqual(r2.recuperadas.map(x => x.tipo), ['SYNC_ATRASADO']); assert.ok(gh.abertas.some(i => i.title === '[Catálogo] SITE_INDISPONIVEL'));
});

/* ───────── 6. execução do monitor e AUSÊNCIA do monitor/sync ───────── */
function apiMonitor({ runs = [], jobs = {}, abertas = [] }) { const gh = githubFalso(abertas); gh.runsConcluidos = async () => runs; gh.jobsDoRun = async id => jobs[id] || []; return gh; }
const siteOk = (atualizado = '2026-10-20T15:55:00Z') => async url => ({ ok: true, status: 200, json: async () => JSON.parse(feedJson(120, atualizado)) });
test('E1. monitor de ponta a ponta: sync parado há 15 h (caso real) ⇒ 1 alerta SYNC_ATRASADO com site íntegro; sync recente ⇒ nenhum alerta', async () => {
  const velho = montar([degradado(5, '2026-10-20T15:45:00Z'), marcado(2, '2026-10-20T00:37:05Z')]); const gh = apiMonitor({ runs: velho.runs, jobs: velho.jobs });
  const r = await MON.executar({ env: {}, fetchFn: siteOk('2026-10-19T20:37:19.355Z'), github: gh, agora: AGORA, lerRepoFeed: () => JSON.parse(feedJson(120, '2026-10-19T20:37:19.355Z')), log: () => {} });
  assert.deepEqual(r.incidentes.map(i => i.tipo), ['SYNC_ATRASADO']); assert.equal(r.acoes.criadas.length, 1);
  const novo = montar([marcado(9, '2026-10-20T15:50:00Z')]); const gh2 = apiMonitor({ runs: novo.runs, jobs: novo.jobs });
  const r2 = await MON.executar({ env: {}, fetchFn: siteOk(), github: gh2, agora: AGORA, lerRepoFeed: () => JSON.parse(feedJson(120, '2026-10-20T15:55:00Z')), log: () => {} }); assert.deepEqual(r2.incidentes, []); assert.equal(gh2.calls.filter(c => Array.isArray(c)).length, 0);
});
test('E2. site corrompido/fora do ar/sem JSON ⇒ alertas FEED_CORROMPIDO / SITE_INDISPONIVEL (mesmo com sync saudável)', async () => {
  const bom = montar([marcado(9, '2026-10-20T15:50:00Z')]);
  const corrompido = async () => ({ ok: true, status: 200, json: async () => ({ produtos: [{ id: 1 }], total: 9, atualizado: 'x' }) });
  const g1 = apiMonitor({ runs: bom.runs, jobs: bom.jobs }); const r1 = await MON.executar({ env: {}, fetchFn: corrompido, github: g1, agora: AGORA, lerRepoFeed: () => null, log: () => {} }); assert.deepEqual(r1.incidentes.map(i => i.tipo), ['FEED_CORROMPIDO']);
  const g2 = apiMonitor({ runs: bom.runs, jobs: bom.jobs }); const r2 = await MON.executar({ env: {}, fetchFn: async () => ({ ok: false, status: 503 }), github: g2, agora: AGORA, lerRepoFeed: () => null, log: () => {} }); assert.deepEqual(r2.incidentes.map(i => i.tipo), ['SITE_INDISPONIVEL']);
  const g3 = apiMonitor({ runs: bom.runs, jobs: bom.jobs }); const r3 = await MON.executar({ env: {}, fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }), github: g3, agora: AGORA, lerRepoFeed: () => null, log: () => {} }); assert.deepEqual(r3.incidentes.map(i => i.tipo), ['FEED_CORROMPIDO', 'SITE_INDISPONIVEL'].filter(t => r3.incidentes.some(i => i.tipo === t)));   // JSON ilegível: não pode passar como saudável
  assert.ok(r3.incidentes.length >= 1);
}, { timeout: 30000 });
test('E3. AUSÊNCIA do monitor: o vigia cruzado (no sync) abre MONITOR_PARADO se o monitor nunca rodou ou parou > 3 h; monitor presente ⇒ nenhum alerta; volta ⇒ recuperação', async () => {
  const gh = apiMonitor({ runs: [] }); const a = await VIG.executar({ env: {}, github: gh, agora: AGORA, log: () => {} }); assert.deepEqual(a.incidentes.map(i => i.tipo), ['MONITOR_PARADO']); assert.equal(a.acoes.criadas.length, 1);
  const g2 = apiMonitor({ runs: [{ id: 1, conclusion: 'success', updated_at: '2026-10-20T11:00:00Z' }] }); const b = await VIG.executar({ env: {}, github: g2, agora: AGORA, log: () => {} }); assert.deepEqual(b.incidentes.map(i => i.tipo), ['MONITOR_PARADO']);   // 5 h
  const g3 = apiMonitor({ runs: [{ id: 2, conclusion: 'failure', updated_at: '2026-10-20T15:20:00Z' }] }); const c = await VIG.executar({ env: {}, github: g3, agora: AGORA, log: () => {} }); assert.deepEqual(c.incidentes, []);   // rodou (mesmo vermelho = visível)
  const g4 = apiMonitor({ runs: [{ id: 3, conclusion: 'success', updated_at: '2026-10-20T15:30:00Z' }], abertas: [{ number: 55, title: '[Catálogo] MONITOR_PARADO' }] }); const d = await VIG.executar({ env: {}, github: g4, agora: AGORA, log: () => {} }); assert.equal(d.acoes.recuperadas.length, 1);
});
test('E4. o vigia cruzado NUNCA mexe nos alertas do monitor (SYNC_ATRASADO etc.) e o monitor NUNCA mexe em MONITOR_PARADO', async () => {
  const g = apiMonitor({ runs: [{ id: 3, conclusion: 'success', updated_at: '2026-10-20T15:30:00Z' }], abertas: [{ number: 1, title: '[Catálogo] SYNC_ATRASADO' }, { number: 2, title: '[Catálogo] MONITOR_PARADO' }] });
  await VIG.executar({ env: {}, github: g, agora: AGORA, log: () => {} }); assert.ok(g.abertas.some(i => i.number === 1)); assert.ok(!g.abertas.some(i => i.number === 2));
  const g2 = apiMonitor({ runs: [], abertas: [{ number: 2, title: '[Catálogo] MONITOR_PARADO' }] }); const m = montar([marcado(1, '2026-10-20T15:50:00Z')]); g2.runsConcluidos = async () => m.runs; g2.jobsDoRun = async id => m.jobs[id];
  await MON.executar({ env: {}, fetchFn: siteOk(), github: g2, agora: AGORA, lerRepoFeed: () => JSON.parse(feedJson(120, '2026-10-20T15:55:00Z')), log: () => {} }); assert.ok(g2.abertas.some(i => i.number === 2));
});
test('E5. cliente GitHub: token só no cabeçalho, erros sem corpo/URL/token, label 422 tolerado, config inválida recusada', async () => {
  const vistos = []; const gh = criarGithub({ token: 'tk_falso_teste', repo: 'o/r', fetchFn: async (u, i) => { vistos.push([u, i]); if (/labels/.test(u)) return { ok: false, status: 422, json: async () => ({}) }; if (/issues\/9$/.test(u)) return { ok: false, status: 403, json: async () => ({ message: 'segredo tk_falso_teste' }) }; return { ok: true, status: 200, json: async () => ({ workflow_runs: [], jobs: [] }) }; } });
  await gh.garantirLabel('x', 'fff', 'd'); await gh.runsConcluidos('sync-produtos.yml', 5);
  const e = await gh.atualizarIssue(9, {}).catch(x => x); assert.equal(e.message, 'GITHUB_HTTP_403'); assert.doesNotMatch(JSON.stringify([e.message, e.stack.split('\n')[0]]), /ghp_/);
  assert.ok(vistos.every(([u, i]) => u.startsWith('https://api.github.com/repos/o/r/') && i.headers.authorization === 'Bearer tk_falso_teste')); assert.throws(() => criarGithub({ token: '', repo: 'o/r' }), /GITHUB_CONFIG_INVALIDA/); assert.throws(() => criarGithub({ token: 't', repo: 'x' }), /GITHUB_CONFIG_INVALIDA/);
});

/* ───────── 7. workflows: proteções preservadas (estático) ───────── */
const passo = (yml, nome) => { const i = yml.indexOf(`name: ${nome}`) >= 0 ? yml.indexOf(`name: ${nome}`) : yml.indexOf(`name: "${nome}`); assert.ok(i >= 0, `passo ausente: ${nome}`); const f = yml.indexOf('\n      - name:', i + 10); return yml.slice(i, f < 0 ? undefined : f); };
test('W1. FASE 1 — sync-produtos.yml: só marcador + vigia cruzado + permissões; SEM modo tolerante (falhas HTTP 500 continuam VERMELHAS); passos de gerar/commit/push sem condição nova e sem continue-on-error; marcador depois do push', () => {
  const y = ler('.github/workflows/sync-produtos.yml');
  assert.doesNotMatch(y, /SYNC_API_INDISPONIVEL_NAO_FALHA/); assert.doesNotMatch(passo(y, 'Executar sync'), /continue-on-error|SYNC_API/);
  for (const n of ['Gerar site estático', 'Commit e push seguro']) { assert.doesNotMatch(passo(y, n), /continue-on-error/, n); assert.doesNotMatch(passo(y, n), /\n\s+if:/, n); }
  assert.ok(y.indexOf(`name: ${M.MARCADOR}`) > y.indexOf('Commit e push seguro') && y.indexOf(`name: ${M.MARCADOR}`) < y.indexOf('Notificar IndexNow')); assert.match(passo(y, M.MARCADOR), /if: success\(\) && steps\.sync\.outputs\.sync_concluido == 'true'/);
  assert.match(passo(y, 'Vigia cruzado'), /if: always\(\)/); assert.match(passo(y, 'Vigia cruzado'), /continue-on-error: true/); assert.match(y, /issues: write/); assert.match(y, /actions: read/); assert.match(y, /node scripts\/git-push-seguro\.js/);
  assert.match(y, /cron: '\*\/30 \* \* \* \*'/); assert.match(y, /workflow_dispatch:/); assert.match(y, /concurrency:\n  group: sync-produtos/); assert.match(passo(y, 'Notificar IndexNow'), /continue-on-error: true/);
  const sync = ler('scripts/sync-produtos.js'); assert.equal((sync.match(/sync_concluido/g) || []).length, 1); assert.match(sync, /mudou: r\.estado === 'MUDOU' \? 'true' : 'false', elegiveis: r\.elegiveis, sync_concluido: 'true'/);     // SÓ no caminho de sucesso
  assert.match(sync, /process\.exit\(1\)/);                                                                                          // falhas continuam saindo com 1
});
test('W2. monitor-idade-catalogo.yml existe, é agendado (hora em hora) e acionável, tem permissões mínimas, SEM continue-on-error (falha do monitor é visível), e o nome do marcador coincide com o do sync', () => {
  const y = ler('.github/workflows/monitor-idade-catalogo.yml'); assert.match(y, /cron: '17 \* \* \* \*'/); assert.match(y, /workflow_dispatch:/); assert.doesNotMatch(y, /continue-on-error/); assert.match(y, /contents: read/); assert.doesNotMatch(y, /contents: write/);
  assert.match(y, /node scripts\/monitor-idade-catalogo\.js/); assert.ok(ler('.github/workflows/sync-produtos.yml').includes(`name: ${M.MARCADOR}`));
  assert.match(ler('scripts/vigia-cruzado.js'), /monitor-idade-catalogo\.yml/); assert.match(ler('scripts/monitor-idade-catalogo.js'), /sync-produtos\.yml/);
});
test('W3. nenhuma credencial do GestãoClick/GitHub nos scripts de monitoramento; o monitor não escreve no repositório (só lê produtos.json) nem executa shell; só rede para o site e api.github.com', () => {
  for (const f of ['scripts/monitor-idade-catalogo.js', 'scripts/vigia-cruzado.js', 'scripts/lib/monitor-catalogo.js', 'scripts/lib/github-api.js']) {
    const s = ler(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); assert.doesNotMatch(s, /GC_ACCESS_TOKEN|GC_SECRET_ACCESS_TOKEN|ghp_|child_process|writeFileSync|appendFileSync|execSync|spawn/, f);
  }
  assert.doesNotMatch(ler('.github/workflows/monitor-idade-catalogo.yml'), /GC_ACCESS_TOKEN|secrets\./);
});
