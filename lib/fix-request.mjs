import { findingKey } from './audit.mjs';
import { manifestPath } from './config.mjs';
import { decodeRecord, registerLabel } from './register.mjs';

const checkbox = state => new RegExp('^- \\[' + state + '\\] Request a Codex fix\\r?$', 'gmi');
export function isFixRequest(event) {
  const before = event?.changes?.body?.from, after = event?.issue?.body;
  return event?.action === 'edited' && typeof before === 'string' && typeof after === 'string' &&
    (before.match(checkbox(' ')) || []).length === 1 && !checkbox('x').test(before) &&
    (after.match(checkbox('x')) || []).length === 1 && !checkbox(' ').test(after);
}

export function remediationRecord(issue, targets) {
  if (!issue || issue.pull_request || issue.state !== 'open' ||
      !issue.labels?.some(label => label.name === registerLabel)) throw new Error('Expected an open vulnerability register issue');
  const record = decodeRecord(issue);
  const target = targets.find(t => t.id === record?.targetId && t.repository === record.repository && t.directory === record.directory);
  if (!target || record.manifest !== manifestPath(target) ||
      !['open', 'pr-open', 'awaiting-verification'].includes(record.status) ||
      record.key !== findingKey(target, record.package, record.advisoryId)) throw new Error('Issue does not match an active allowlisted finding');
  return { record, target };
}

export async function authorizeFixRequest({ api, hub, actor, triggeringActor = actor, eventName, event, targets }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(hub) || event?.repository?.full_name !== hub) throw new Error('Wrong hub repository');
  if (eventName !== 'issues' || !isFixRequest(event) || event.sender?.type !== 'User') throw new Error('Expected a new checkbox request');
  const number = event.issue.number;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Enter a valid register issue number');
  // Check live repository access, not author_association, issue ownership, or UI visibility.
  for (const login of new Set([actor, triggeringActor])) {
    if (typeof login !== 'string' || !/^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(login)) throw new Error('Invalid request actor');
    const access = await api.get('/repos/' + hub + '/collaborators/' + encodeURIComponent(login) + '/permission');
    if (!['write', 'admin'].includes(access.permission)) throw new Error('Requesting a fix requires write access to the hub');
  }
  const issue = await api.get('/repos/' + hub + '/issues/' + number);
  const { record } = remediationRecord(issue, targets);
  const requested = remediationRecord(event.issue, targets).record;
  const previous = decodeRecord({ ...event.issue, body: event.changes.body.from });
  if (requested.key !== record.key || previous?.key !== record.key) throw new Error('Register identity changed during the request');
  return number;
}
