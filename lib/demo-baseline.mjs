import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { git } from './process.mjs';
import { demoTarget, planReset } from './demo-reset.mjs';
export async function materializeBaseline(source, destination, target) {
  await demoTarget(target.id, [target]);
  const safe = ['-c', 'safe.directory=' + resolve(source).replaceAll('\\', '/')];
  const raw = await git([...safe, 'ls-tree', '-rz', target.demo.baselineCommit], {cwd:source});
  const tree = raw.split('\0').filter(Boolean).map(line => {
    const tab=line.indexOf('\t'), [mode,type,sha]=line.slice(0,tab).split(' ');
    return {mode,type,sha,path:line.slice(tab+1)};
  });
  const changes=planReset({tree},{tree:[]});
  // A new private folder prevents old files, symlinks or node_modules entering the fixture.
  await mkdir(destination);
  for (const entry of changes) {
    const file=resolve(destination,entry.path);
    if (!file.startsWith(resolve(destination)+sep)) throw new Error('Baseline file escapes fixture');
    await mkdir(dirname(file),{recursive:true});
    await writeFile(file,(await git([...safe,'show',target.demo.baselineCommit+':'+entry.path],{cwd:source}))+'\n');
  }
  return changes.map(e=>e.path);
}
