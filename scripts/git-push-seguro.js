#!/usr/bin/env node
/**
 * Push seguro do sync (Fase A). NUNCA usa force. Estratégia:
 *  1) tenta `git push` normal (caso comum: ~99 % das execuções);
 *  2) se o remoto avançou durante o run (~25 s): busca o remoto e compara os arquivos:
 *       - se o remoto mexeu em algo que o gerador usa (scripts/, templates/, js/) ou em arquivos que este commit também alterou ⇒ ABORTA
 *         (o snapshot gerado pode estar velho; a próxima execução regenera a partir do main novo — nada humano é descartado);
 *       - senão (arquivos disjuntos: testes, docs, workflow...) ⇒ `git rebase` (sem conflito possível) e um novo push;
 *  3) qualquer outra falha ⇒ aborta com código 1. Conflito de rebase ⇒ `rebase --abort`.
 * Sai com 0 se não há nada a publicar.
 */
'use strict';
const { spawnSync } = require('child_process');

const ENTRADAS_DO_GERADOR = /^(scripts|templates|js)\//;     // mudanças aqui tornam o snapshot gerado potencialmente velho

function criarGit(cwd, run) {
  const exec = run || spawnSync;
  return (...args) => { const r = exec('git', args, { cwd, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
}

function publicarSeguro(opts) {
  opts = opts || {};
  const git = opts.git || criarGit(opts.cwd || process.cwd(), opts.run);
  const log = opts.log || (t => console.log(t));
  const remoto = opts.remoto || 'origin', ramo = opts.ramo || 'main';

  const aFrente = git('rev-list', '--count', `${remoto}/${ramo}..HEAD`);
  if (aFrente.code === 0 && aFrente.out === '0') { log('[push] nada a publicar'); return { estado: 'NADA' }; }

  let r = git('push', remoto, `HEAD:${ramo}`);
  if (r.code === 0) { log('[push] publicado'); return { estado: 'PUBLICADO' }; }
  log(`[push] push direto recusado (${(r.err || r.out).split('\n').pop().slice(0, 140)}) — avaliando o remoto`);

  const f = git('fetch', remoto, ramo);
  if (f.code !== 0) { log('[push] PUSH_ABORTED_FETCH_FAILED'); return { estado: 'ABORTADO', motivo: 'fetch' }; }
  const base = git('merge-base', 'HEAD', `${remoto}/${ramo}`).out;
  const remotoNovo = git('rev-parse', `${remoto}/${ramo}`).out;
  if (!base || base === remotoNovo) { log('[push] PUSH_ABORTED_NOT_A_RACE: remoto não avançou; falha do push é outra (permissão/rede)'); return { estado: 'ABORTADO', motivo: 'nao-corrida' }; }

  const doRemoto = git('diff', '--name-only', base, `${remoto}/${ramo}`).out.split('\n').filter(Boolean);
  const nossos = new Set(git('diff', '--name-only', base, 'HEAD').out.split('\n').filter(Boolean));
  const gerador = doRemoto.filter(x => ENTRADAS_DO_GERADOR.test(x));
  const choque = doRemoto.filter(x => nossos.has(x));
  if (gerador.length || choque.length) {
    log(`[push] PUSH_ABORTED_REMOTE_CHANGED: o remoto alterou ${gerador.length ? 'entradas do gerador (' + gerador.slice(0, 3).join(', ') + ')' : 'arquivos que este commit também altera (' + choque.slice(0, 3).join(', ') + ')'} — nada descartado; a próxima execução regenera a partir do main novo`);
    return { estado: 'ABORTADO', motivo: 'remoto-alterou' };
  }
  const rb = git('rebase', `${remoto}/${ramo}`);
  if (rb.code !== 0) { git('rebase', '--abort'); log('[push] PUSH_ABORTED_REBASE_CONFLICT (rebase abortado; nada perdido)'); return { estado: 'ABORTADO', motivo: 'rebase' }; }
  r = git('push', remoto, `HEAD:${ramo}`);
  if (r.code === 0) { log('[push] publicado após rebase seguro (arquivos disjuntos)'); return { estado: 'PUBLICADO_APOS_REBASE' }; }
  log('[push] PUSH_ABORTED_SECOND_PUSH_FAILED');
  return { estado: 'ABORTADO', motivo: 'segundo-push' };
}

module.exports = { publicarSeguro, criarGit, ENTRADAS_DO_GERADOR };

if (require.main === module) {
  const r = publicarSeguro();
  process.exit(r.estado === 'ABORTADO' ? 1 : 0);
}
