#!/usr/bin/env node
'use strict';
/**
 * Vigia cruzado (último passo do sync-produtos.yml): detecta a AUSÊNCIA do monitor de idade do catálogo. Se o workflow do monitor não completou nenhuma execução nos últimos
 * LIMITES.monitorMaxMin minutos (parado, desativado ou sem agendamento), abre UM alerta MONITOR_PARADO (e fecha quando voltar). Nunca derruba o sync (sempre exit 0).
 */
const { criarGithub } = require('./lib/github-api');
const M = require('./lib/monitor-catalogo');
async function executar({ env = process.env, fetchFn = fetch, github = null, agora = Date.now(), log = console.log } = {}) {
  const gh = github || criarGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetchFn });
  const runs = await gh.runsConcluidos(env.MONITOR_WORKFLOW || 'monitor-idade-catalogo.yml', 5);
  const ultimo = runs[0] && (runs[0].updated_at || runs[0].run_started_at);
  const idade = ultimo ? Math.round((agora - Date.parse(ultimo)) / 60000) : null;
  const incidentes = idade === null || idade > M.LIMITES.monitorMaxMin ? [{ tipo: 'MONITOR_PARADO', detalhe: idade === null ? 'o workflow do monitor de idade do catálogo nunca completou uma execução' : `o monitor de idade do catálogo não completa uma execução há ${M.fmtIdade(idade)} (limite ${M.fmtIdade(M.LIMITES.monitorMaxMin)}): a vigilância da idade do catálogo está AUSENTE` }] : [];
  const acoes = await M.reconciliar({ incidentes, github: gh, agora, escopo: ['MONITOR_PARADO'] });
  log(JSON.stringify({ evento: 'vigia_cruzado', monitorIdadeMin: idade, incidentes: incidentes.map(i => i.tipo), acoes }));
  return { incidentes, acoes };
}
module.exports = { executar };
if (require.main === module) executar().catch(e => { console.error(`VIGIA_CRUZADO_INDISPONIVEL: ${e.message}`); process.exit(0); });     // nunca derruba o sync
