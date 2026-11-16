"""Admission policy: four live previews, three waiting, one cold start at a time."""
MAX_ACTIVE = 4
MAX_QUEUED = 3

def next_start(sessions):
    values = list(sessions)
    if any(s['status'] == 'starting' for s in values):
        return None
    if sum(s['status'] in ['starting', 'ready'] for s in values) >= MAX_ACTIVE:
        return None
    queued = sorted((s for s in values if s['status'] == 'queued'), key=lambda s:s['createdAt'])
    return queued[0] if queued else None

def has_capacity(sessions):
    return sum(s['status'] in ['queued', 'starting', 'ready'] for s in sessions) < MAX_ACTIVE + MAX_QUEUED
