import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApplicationTests, assertTestsPassed } from '../lib/verification-sandbox.mjs';
import { run } from '../lib/process.mjs';

const fixture = async t => {
  const root = await mkdtemp(join(tmpdir(), 'hub-verifier-test-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await chmod(root, 0o755);
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'package.json'), '{"name":"verification-fixture","version":"1.0.0","type":"module"}');
  await writeFile(join(root, 'package-lock.json'), '{"name":"verification-fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"verification-fixture","version":"1.0.0"}}}');
  return root;
};

test('the verifier rejects an actual Node run where every test is skipped', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'test/app.test.mjs'), "import test from 'node:test'; test.skip('not executed', () => {});");
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const skipped = await run(process.execPath, ['--test', '--test-reporter=tap'], {cwd:root, env});
  assert.equal(skipped.code, 0);
  assert.match(skipped.stdout, /^# tests 1$/m);
  assert.throws(() => assertTestsPassed(skipped), /no tests passed/);
  await writeFile(join(root, 'test/app.test.mjs'), "import test from 'node:test'; test('executed', () => {});");
  assertTestsPassed(await run(process.execPath, ['--test', '--test-reporter=tap'], {cwd:root, env}));
});

test('container prevents audit/receipt tampering and credential access while allowing local HTTP tests',
  {skip:process.env.HUB_CONTAINER_TESTS !== 'true', timeout:600000}, async t => {
    const root = await fixture(t);
    const outside = await mkdtemp(join(tmpdir(), 'hub-trusted-evidence-'));
    t.after(() => rm(outside, {recursive:true, force:true}));
    const receipt = join(outside, 'verification.json');
    await writeFile(receipt, 'trusted evidence');
    const manifest = await readFile(join(root, 'package-lock.json'), 'utf8');
    await writeFile(join(root, 'test/app.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, readFile, access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {networkInterfaces} from 'node:os';
test('protect evidence and credentials', async () => {
  assert.equal(process.getuid(), 1000);
  assert.equal(process.env.HUB_REVIEW_CANARY, undefined);
  for (const name of ['GITHUB_TOKEN','OPENAI_API_KEY','ACTIONS_RUNTIME_TOKEN','GITHUB_ENV','GITHUB_OUTPUT']) assert.equal(process.env[name], undefined);
  await assert.rejects(writeFile('package-lock.json', '{}'), {code:'EROFS'});
  await assert.rejects(writeFile(${JSON.stringify(receipt)}, 'forged evidence'));
  await assert.rejects(readFile(${JSON.stringify(receipt)}));
  await assert.rejects(access('/var/run/docker.sock'));
  assert.ok(Object.values(networkInterfaces()).flat().every(n => n.internal));
});
test('local HTTP remains available', async t => {
  const server=createServer((request,response)=>response.end('ok')).listen(0,'127.0.0.1');
  await once(server,'listening'); t.after(()=>server.close());
  assert.equal(await (await fetch('http://127.0.0.1:'+server.address().port)).text(),'ok');
});
`);
    process.env.HUB_REVIEW_CANARY = 'do-not-forward-to-container';
    t.after(() => delete process.env.HUB_REVIEW_CANARY);
    const result = await runApplicationTests(root);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assertTestsPassed(result);
    assert.equal(await readFile(receipt, 'utf8'), 'trusted evidence');
    assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), manifest);
    // An uncaught attempt to rewrite audit inputs must fail the verification gate.
    await writeFile(join(root, 'test/app.test.mjs'), "import test from 'node:test'; import {writeFile} from 'node:fs/promises'; test('tamper', () => writeFile('package-lock.json', '{}'));");
    const tamper = await runApplicationTests(root);
    assert.notEqual(tamper.code, 0);
    assert.throws(() => assertTestsPassed(tamper), /tests failed/);
    assert.match(tamper.stdout, /EROFS/);
  });
