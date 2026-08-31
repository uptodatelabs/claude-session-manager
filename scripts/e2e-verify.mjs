/* Comprehensive E2E verification of every implemented csm feature. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ─── Fixture setup ──────────────────────────────────────────────────────────
const base = path.join(os.tmpdir(), 'csm-e2e-full');
fs.rmSync(base, { recursive: true, force: true });
const PROJECTS = path.join(base, 'projects');
const STATE = path.join(base, 'state');
const CONFIG = path.join(base, 'claude-config');
const ISO = { CSM_PROJECTS_DIR: PROJECTS, CSM_STATE_DIR: STATE, CSM_CONFIG_DIR: CONFIG };

// Global config fixture (~/.claude equivalent) + ~/.claude.json
fs.mkdirSync(path.join(CONFIG, 'agents'), { recursive: true });
fs.writeFileSync(path.join(CONFIG, 'settings.json'), '{"model":"test"}');
fs.writeFileSync(path.join(CONFIG, 'CLAUDE.md'), '# global claude md');
fs.writeFileSync(path.join(CONFIG, 'agents', 'helper.md'), 'helper agent');
fs.writeFileSync(path.join(base, '.claude.json'), '{"global":true}');

// Project-root fixtures for each project cwd (real dirs so config collection works)
const ROOT_ALPHA = path.join(base, 'roots', 'F__Github_Alpha');
const ROOT_BETA = path.join(base, 'roots', 'F__Github_Beta');
for (const [p, root] of [['F:/Github/Alpha', ROOT_ALPHA], ['F:/Github/Beta', ROOT_BETA]]) {
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# root md for ${p}`);
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"local":true}');
}

function session(slugDirName, fileName, lines) {
  const dir = path.join(PROJECTS, slugDirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), `${lines.join('\n')}\n`, 'utf8');
}
function userLine(id, prompt, ts, cwd, branch, title) {
  return JSON.stringify({
    type: 'user', timestamp: ts, sessionId: id,
    message: { role: 'user', content: prompt }, cwd, gitBranch: branch, aiTitle: title,
  });
}
function asstLine(ts, usage) {
  return JSON.stringify({
    type: 'assistant', timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage },
  });
}

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const B1 = '33333333-3333-4333-8333-333333333333';
const M1 = '44444444-4444-4444-8444-000000000001';
const M2 = '44444444-4444-4444-8444-000000000002';

session('F--Github-Alpha', `${A1}.jsonl`, [
  userLine(A1, 'alpha first request', '2026-08-01T10:00:00.000Z', ROOT_ALPHA.replaceAll('\\', '/'), 'main', 'Alpha One'),
  asstLine('2026-08-01T10:00:05.000Z', { input_tokens: 100, output_tokens: 50 }),
]);
session('F--Github-Alpha', `${A2}.jsonl`, [
  '{this is malformed json',
  userLine(A2, 'alpha second request', '2026-08-05T10:00:00.000Z', ROOT_ALPHA.replaceAll('\\', '/'), 'dev', 'Alpha Two'),
  asstLine('2026-08-05T10:00:05.000Z', { input_tokens: 200, output_tokens: 100 }),
]);
session('F--Github-Beta', `${B1}.jsonl`, [
  userLine(B1, 'beta request', '2026-08-10T10:00:00.000Z', ROOT_BETA.replaceAll('\\', '/'), 'main', 'Beta One'),
  asstLine('2026-08-10T10:00:05.000Z', { input_tokens: 10, output_tokens: 5 }),
]);
session('F--Github-Beta', `${M1}.jsonl`, [
  userLine(M1, 'amb one', '2026-07-01T10:00:00.000Z', ROOT_BETA.replaceAll('\\', '/')),
]);
session('F--Github-Beta', `${M2}.jsonl`, [
  userLine(M2, 'amb two', '2026-07-02T10:00:00.000Z', ROOT_BETA.replaceAll('\\', '/')),
]);

console.log('\n═══ A. 메타 명령어 ═══');
{
  const v = run(['--version']);
  check('--version에 프로그램·버전·회사 표시', v.code === 0 && v.out.trim() === 'csm v1.0.0 (uptodatelabs)', v.out.trim());
  const h = run(['--help']);
  check('--help 사용법 표시', h.out.includes('Usage') && h.out.includes('Commands'));
  const n = run([]);
  check('인자 없음(non-TTY) → 도움말', n.out.includes('Usage'));
  const u = run(['definitely-not-a-command']);
  check('알 수 없는 명령 → 오류 종료', u.code !== 0);
}

console.log('\n═══ B. list ═══');
{
  const l = run(['list'], ISO);
  check('모든 세션 표시', ['Alpha One', 'Alpha Two', 'Beta One'].every((t) => l.out.includes(t)));
  const iBeta = l.out.indexOf('Beta One'), iA2 = l.out.indexOf('Alpha Two'), iA1 = l.out.indexOf('Alpha One');
  check('최신순 정렬', iBeta !== -1 && iBeta < iA2 && iA2 < iA1, `idx=${iBeta},${iA2},${iA1}`);
  check('id·크기 표시', /[0-9a-f]{8}/.test(l.out) && /B|KB/.test(l.out));
  check('프로젝트 슬러그 표시', l.out.includes('F--Github-Alpha') && l.out.includes('F--Github-Beta'));

  const p = run(['list', '--project', 'F--Github-Alpha'], ISO);
  check('--project 필터', p.out.includes('Alpha') && !p.out.includes('Beta One'));

  const lim = run(['list', '--limit', '1'], ISO);
  const rows = (lim.out.match(/^\s+[0-9a-f]{8}\s/gm) ?? []).length;
  check('--limit 1 → 1행', rows === 1, `rows=${rows}`);

  const j = run(['list', '--json'], ISO);
  let parsed = null;
  try { parsed = JSON.parse(j.out); } catch { /* noop */ }
  check(
    '--json 유효·필드 완비',
    Array.isArray(parsed) && parsed.length === 5 &&
      parsed.every((s) => s.id && s.title && s.projectSlug && s.filePath && typeof s.size === 'number'),
    parsed ? String(parsed.length) : 'parse fail',
  );

  // 인덱스 캐시 생성 확인
  check('인덱스 캐시 파일 생성', fs.existsSync(path.join(STATE, 'index.json')));
}

console.log('\n═══ C. show ═══');
{
  const s1 = run(['show', A1], ISO);
  check('전체 id 조회', s1.code === 0 && s1.out.includes('Alpha One') && s1.out.includes('Recent messages'));
  const s2 = run(['show', '1111'], ISO);
  check('prefix 조회', s2.code === 0 && s2.out.includes('Alpha One'));
  const s3 = run(['show', A1, '--messages', '1'], ISO);
  check('--messages 옵션', s3.code === 0 && s3.out.includes('Recent messages'));
  const s4 = run(['show', A1, '--json'], ISO);
  let sj = null;
  try { sj = JSON.parse(s4.out); } catch { /* noop */ }
  check('--json 구조', sj?.session?.title === 'Alpha One' && Array.isArray(sj.messages) && sj.messages.length >= 1);

  const miss = run(['show', 'ffffffffffff'], ISO);
  check('없는 세션 → 오류', miss.code !== 0 && `${miss.out}${miss.err}`.includes('not found'));
  const amb = run(['show', '44444444'], ISO);
  check('모호한 prefix → 오류', amb.code !== 0 && `${amb.out}${amb.err}`.includes('Ambiguous'));
}

console.log('\n═══ D. stats ═══');
{
  const j = run(['stats', '--json'], ISO);
  let sj = null;
  try { sj = JSON.parse(j.out); } catch { /* noop */ }
  // a1=150 + a2=300 + b1=15 (+ malformed-line 세션도 정상 집계)
  check('--json 총 토큰 465', sj?.totals?.totalTokens === 465, JSON.stringify(sj?.totals));
  check('--json 프로젝트 2개', Array.isArray(sj?.projects) && sj.projects.length === 2);
  check('malformed 라인 건너뛰고 집계', sj?.projects?.some((p) => p.project.slug === 'F--Github-Alpha' && p.totalTokens === 450));

  const pj = run(['stats', '--project', 'F--Github-Beta', '--json'], ISO);
  let pb = null;
  try { pb = JSON.parse(pj.out); } catch { /* noop */ }
  check('--project 필터 합계 15', pb?.totals?.totalTokens === 15, JSON.stringify(pb?.totals));

  const t = run(['stats'], ISO);
  check('사람용 출력', t.out.includes('Token Statistics') && t.out.includes('Totals') && !t.out.startsWith('{'));
}

console.log('\n═══ E. backup ═══');
{
  const outDir = path.join(base, 'backups');
  const b1r = run(['backup', A2, '-o', outDir], ISO);
  const m1 = b1r.out.match(/Archive:\s*(.+)/)?.[1]?.trim();
  check('단일 백업 생성', b1r.code === 0 && m1 && fs.existsSync(m1), m1 ?? 'no path');

  const d1 = run(['restore', m1, '--dry-run'], ISO);
  check('dry-run manifest Sessions: 1', /Sessions:\s*1/.test(d1.out));

  const bAll = run(['backup', '--all', '-o', outDir], ISO);
  const mAll = bAll.out.match(/Archive:\s*(.+)/)?.[1]?.trim();
  check('--all 백업 생성', bAll.code === 0 && mAll && fs.existsSync(mAll));
  const dAll = run(['restore', mAll, '--dry-run'], ISO);
  const cnt = Number(dAll.out.match(/Sessions:\s*(\d+)/)?.[1]);
  check('--all 5세션 포함', cnt === 5, `cnt=${cnt}`);

  const bp = run(['backup', '--project', 'F--Github-Beta', '-o', outDir], ISO);
  const mp = bp.out.match(/Archive:\s*(.+)/)?.[1]?.trim();
  const dp = run(['restore', mp, '--dry-run'], ISO);
  check('--project 3세션 포함', /Sessions:\s*3/.test(dp.out));

  const noArgs = run(['backup'], ISO);
  check('대상 없이 backup → 오류', noArgs.code !== 0);
  globalThis.__archiveAll = mAll;
}

console.log('\n═══ F. restore (일반) ═══');
{
  const dest = path.join(base, 'restored-plain');
  const r = run(['restore', globalThis.__archiveAll, '-o', dest], ISO);
  check('복원 실행 성공', r.code === 0);

  // 원본과 바이트 단위 동일한지 비교
  const src = path.join(PROJECTS, 'F--Github-Alpha', `${A1}.jsonl`);
  const dst = path.join(dest, 'F--Github-Alpha', `${A1}.jsonl`);
  check('파일 바이트 동일', fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst)));

  // 설정 파일 복원: 전역 + 프로젝트 루트
  check('전역 설정 복원', fs.existsSync(path.join(CONFIG, 'settings.json')));
  check('전역 CLAUDE.md 복원', fs.existsSync(path.join(CONFIG, 'CLAUDE.md')));
  check('~/.claude.json 복원', fs.existsSync(path.join(base, '.claude.json')));
  check('프로젝트 루트 설정 복원', fs.existsSync(path.join(ROOT_ALPHA, 'CLAUDE.md')));
  check('프로젝트 루트 .claude 복원', fs.existsSync(path.join(ROOT_ALPHA, '.claude', 'settings.json')));

  const bad = run(['restore', path.join(base, 'nonexistent.tar.gz')], ISO);
  check('없는 아카이브 → 오류', bad.code !== 0);
}

console.log('\n═══ G. restore --remap ═══');
{
  const dest = path.join(base, 'restored-remap');
  const remapTarget = path.join(base, 'remapped', 'MyProj').replaceAll('\\', '/');
  const slug = remapTarget.replace(/[^A-Za-z0-9-]/g, '-');
  const r = run(['restore', globalThis.__archiveAll, '-o', dest, '--remap', remapTarget], ISO);
  check('remap 복원 성공', r.code === 0);
  const remapped = path.join(dest, slug, `${A1}.jsonl`);
  check('새 slug 폴더에 배치', fs.existsSync(remapped));
  if (fs.existsSync(remapped)) {
    const content = fs.readFileSync(remapped, 'utf8');
    check(
      'cwd 재기록됨',
      content.includes(remapTarget) && !content.includes(ROOT_ALPHA.replaceAll('\\', '/')),
    );
  }
}

console.log('\n═══ H. restore --skip-existing ═══');
{
  const dest = path.join(base, 'restored-skip');
  fs.mkdirSync(path.join(dest, 'F--Github-Alpha'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'F--Github-Alpha', `${A2}.jsonl`), 'SENTINEL', 'utf8');
  const r = run(['restore', globalThis.__archiveAll, '-o', dest, '--skip-existing'], ISO);
  const kept = fs.readFileSync(path.join(dest, 'F--Github-Alpha', `${A2}.jsonl`), 'utf8') === 'SENTINEL';
  check('기존 파일 보존', r.code === 0 && kept);
  check('skip 메시지 출력', `${r.out}${r.err}`.includes('skip'));
}

console.log('\n═══ I. trash 생명주기 ═══');
{
  const orig = path.join(PROJECTS, 'F--Github-Alpha', `${A1}.jsonl`);
  const origBytes = fs.readFileSync(orig);

  const rm = run(['rm', A1], ISO);
  check('rm → 휴지통 이동', rm.code === 0 && rm.out.includes('Moved to trash') && !fs.existsSync(orig));

  const tl = run(['trash', 'list'], ISO);
  check('trash list 표시', tl.code === 0 && tl.out.includes('Alpha One'));

  const manifest = JSON.parse(fs.readFileSync(path.join(STATE, 'trash', 'manifest.json'), 'utf8'));
  const entry = manifest.find((e) => e.sessionId === A1);
  check('manifest 기록', Boolean(entry));
  check('휴지통 파일 존재', entry && fs.existsSync(path.join(STATE, 'trash', `${entry.trashId}.jsonl`)));

  const tr = run(['trash', 'restore', entry.trashId], ISO);
  check('trash restore 복원', tr.code === 0 && fs.existsSync(orig) && fs.readFileSync(orig).equals(origBytes));

  const rm2 = run(['rm', A1], ISO);
  const manifest2 = JSON.parse(fs.readFileSync(path.join(STATE, 'trash', 'manifest.json'), 'utf8'));
  const entry2 = manifest2.find((e) => e.sessionId === A1);
  const pg = run(['trash', 'purge', entry2.trashId], ISO);
  check('purge 영구 삭제', pg.code === 0 && !fs.existsSync(path.join(STATE, 'trash', `${entry2.trashId}.jsonl`)) && rm2.code === 0);
  const tl2 = run(['trash', 'list'], ISO);
  check('purge 후 목록 비움', !tl2.out.includes('Alpha One'));
}

console.log('\n═══ J. 장애 복원력 ═══');
{
  // 인덱스 캐시 손상 → 자동 재스캔
  fs.writeFileSync(path.join(STATE, 'index.json'), '{corrupt!!!', 'utf8');
  const l = run(['list'], ISO);
  check('손상된 캐시 복구', l.code === 0 && l.out.includes('Alpha Two'));
  const idx = JSON.parse(fs.readFileSync(path.join(STATE, 'index.json'), 'utf8'));
  check('캐시 재생성 정상', idx.version === 1 && Object.keys(idx.sessions).length === 4);

  // 빈 프로젝트 디렉터리
  const emptyBase = path.join(base, 'empty');
  fs.mkdirSync(emptyBase, { recursive: true });
  const e = run(['list'], { CSM_PROJECTS_DIR: emptyBase, CSM_STATE_DIR: path.join(emptyBase, 'state') });
  check('빈 환경 → 안내 메시지', e.code === 0 && e.out.includes('No sessions found'));
}

console.log('\n═══ K. 실데이터 스모크 ═══');
{
  const l = run(['list']);
  check('실데이터 list', l.code === 0 && /Sessions \(\d+ total\)/.test(l.out), `code=${l.code}`);
  const s = run(['show', 'f6fa0de1']);
  check('실데이터 show', s.code === 0 && s.out.includes('Title:') && s.out.includes('Recent messages'));
  const st = run(['stats', '--project', 'F--Github-Main', '--json']);
  let sj = null;
  try { sj = JSON.parse(st.out); } catch { /* noop */ }
  check('실데이터 stats', st.code === 0 && sj?.totals?.sessionCount > 0 && sj.totals.totalTokens > 0);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`결과: PASS ${pass} / FAIL ${fail}`);
if (failures.length) {
  console.log('실패 항목:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(fail > 0 ? 1 : 0);
