"""Check first-party project files without printing matched sensitive values."""
import ipaddress
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'.git', 'node_modules', '_gui-test', '__pycache__', 'dist', 'artifacts'}
KEY = re.compile(r'(?<![\w-])(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})')
IP = re.compile(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])')
URL = re.compile(r'https?://[^\s<>"\x27`]+')
IDENTITY = re.compile(r'VM-\d+-\d+-ubuntu|\bserver-\d+\b|C:[\\/]+Users[\\/]+(?!USER\b)[^\\/\s]+|/(?:home)/(?!user/|example/|app/)[^/\s]+/')


def inspect(relative, text):
    findings = set()
    for match in KEY.finditer(text):
        value = match.group()
        # Explicit dummy examples used by config and card-export regression tests.
        if re.fullmatch(r'sk-x+', value) or value == 'sk-' + 'abcdef' * 4:
            continue
        findings.add((text.count('\n', 0, match.start()) + 1, 'credential-pattern'))
    for match in IP.finditer(text):
        value = match.group()
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_unspecified or value.startswith(('192.0.2.', '198.51.100.', '203.0.113.')):
            continue
        findings.add((text.count('\n', 0, match.start()) + 1, 'non-example-ip'))
    for match in URL.finditer(text):
        try:
            parts = urlsplit(match.group())
            host = parts.hostname or ''
        except ValueError:
            continue
        if parts.username or parts.password or host.endswith(('.internal', '.lan', '.corp', '.local')):
            findings.add((text.count('\n', 0, match.start()) + 1, 'private-url'))
        if re.search(r'(?i)[?&](?:api[_-]?key|token|secret|password)=[A-Za-z0-9_/-]{16,}', match.group()):
            findings.add((text.count('\n', 0, match.start()) + 1, 'credential-in-url'))
    for match in IDENTITY.finditer(text):
        findings.add((text.count('\n', 0, match.start()) + 1, 'deployment-identity'))
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----', text):
        findings.add((1, 'private-key'))
    return sorted(findings)


def main():
    total = 0
    failures = []
    for base, directories, names in os.walk(ROOT):
        directories[:] = [name for name in directories if name not in SKIP]
        for name in names:
            path = Path(base) / name
            if path.suffix in ('.png', '.woff2', '.gz', '.pyc'):
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                continue
            total += 1
            relative = path.relative_to(ROOT)
            for line, kind in inspect(relative, text):
                failures.append(f'{relative}:{line}: {kind}')
    if failures:
        print('\n'.join(failures))
        return 1
    print(f'Sensitive-data check passed for {total} first-party text files; matched values are never printed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
