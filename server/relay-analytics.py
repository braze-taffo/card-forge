"""只读查询同机 New API 账本；不读取密钥、用户信息或对话内容。"""
import argparse
import datetime
import json
import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
parser.add_argument('--db', required=True)
parser.add_argument('--period', choices=['today', '7d', '30d', 'all'], default='all')
parser.add_argument('--timezone', default='Asia/Singapore')
parser.add_argument('--token-name', default='card-forge-free-deepseek-step')
parser.add_argument('--now', type=int)
args = parser.parse_args()
db = sqlite3.connect(Path(args.db).resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
db.execute('PRAGMA query_only=ON')
now = datetime.datetime.fromtimestamp(args.now, ZoneInfo(args.timezone)) if args.now else datetime.datetime.now(ZoneInfo(args.timezone))
start = 0 if args.period == 'all' else int((now.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(days={'today': 0, '7d': 6, '30d': 29}[args.period])).timestamp())
end = int(now.timestamp())
token = db.execute('SELECT id FROM tokens WHERE name=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', (args.token_name,)).fetchone()

def aggregate(token_id=None):
    clause = 'type=2 AND created_at>=? AND created_at<=?'
    params = [start, end]
    if token_id is not None:
        clause += ' AND token_id=?'
        params.append(token_id)
    rows = db.execute('SELECT model_name,COUNT(*),COALESCE(SUM(prompt_tokens),0),COALESCE(SUM(completion_tokens),0) FROM logs WHERE ' + clause + ' GROUP BY model_name ORDER BY COUNT(*) DESC', params).fetchall()
    models = [{'id': model, 'calls': calls, 'promptTokens': prompt, 'completionTokens': completion, 'totalTokens': prompt + completion} for model, calls, prompt, completion in rows]
    summary = {key: sum(model[key] for model in models) for key in ['calls', 'promptTokens', 'completionTokens', 'totalTokens']}
    summary['logsWithIp'] = db.execute("SELECT COUNT(*) FROM logs WHERE " + clause + " AND ip IS NOT NULL AND ip<>''", params).fetchone()[0]
    return {'summary': summary, 'models': models}

first = db.execute('SELECT MIN(created_at) FROM logs WHERE type=2').fetchone()[0]
print(json.dumps({'available': True, 'checkedAt': end * 1000, 'firstLogAt': first * 1000 if first else None, 'period': args.period,
    'site': aggregate(token[0]) if token else None, 'total': aggregate(), 'siteTokenFound': bool(token)}, ensure_ascii=False))
db.close()
