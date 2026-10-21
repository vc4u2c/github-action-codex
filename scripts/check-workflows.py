"""Validate workflow YAML and meaningful orchestration boundaries (requires PyYAML)."""
import pathlib
import yaml

root = pathlib.Path(__file__).resolve().parents[1]
workflows = list((root / '.github/workflows').glob('*.yml'))
workflows += list((root.parent / 'vulnerable-node-demo/.github/workflows').glob('*.yml'))
for path in workflows:
    data = yaml.load(path.read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
    assert data.get('on'), f'{path}: missing trigger'
    assert data.get('jobs'), f'{path}: missing jobs'
    jobs = data['jobs']
    for name, job in jobs.items():
        needs = job.get('needs', [])
        if isinstance(needs, str):
            needs = [needs]
        assert all(n in jobs for n in needs), f'{path}: unknown dependency for {name}'
        for step in job['steps']:
            assert ('uses' in step) != ('run' in step), f'{path}: ambiguous step'
    print('Valid workflow:', path.name)
data = yaml.load((root / '.github/workflows/remediate.yml').read_text(), Loader=yaml.BaseLoader)
assert data['jobs']['publish']['needs'] == ['prepare', 'verify']
assert data['jobs']['propose']['permissions'] == {'contents': 'read'}
assert data['jobs']['verify']['permissions'] == {'contents': 'read'}
assert 'pull_request_target' not in data['on']
print('Remediation job boundaries verified')
