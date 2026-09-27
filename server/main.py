import json
import time
import uuid
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, field_validator
from server.db import db, migrate, day, DEFAULT_FILES, serialize_project
from server.auth import router, current_user, public_user, limit
from server.integrations import MODELS, generate, github_identity, github_action


@asynccontextmanager
async def lifespan(app):
    migrate()
    # A development reload may interrupt a request: return its reserved credits.
    with db() as c:
        for job in c.execute('SELECT * FROM ai_jobs').fetchall():
            c.execute('UPDATE users SET credits=MIN(20,credits+?) WHERE id=? AND credit_day=?', (job['cost'], job['user_id'], job['credit_day']))
        c.execute('DELETE FROM ai_jobs')
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def invalid_request(request, error):
    # Do not echo validation inputs: they may include passwords or provider tokens.
    return JSONResponse({'detail': 'Girilen bilgiler geçersiz. Alan uzunluklarını ve dosya yollarını kontrol edin.'}, status_code=422)


@app.middleware('http')
async def protect(request: Request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        if request.headers.get('x-armut-request') != '1' or request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail': 'İstek doğrulanamadı.'}, status_code=403)
        try:
            if int(request.headers.get('content-length', '0')) > 3_000_000:
                return JSONResponse({'detail': 'İstek çok büyük (en fazla 3 MB).'}, status_code=413)
        except ValueError:
            return JSONResponse({'detail': 'Geçersiz istek.'}, status_code=400)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/api/models')
def models():
    return MODELS


class Survey(BaseModel):
    coding: Literal['beginner', 'intermediate', 'advanced']
    ai: Literal['new', 'sometimes', 'often']
    source: str = Field(min_length=1, max_length=200)


@app.post('/api/survey')
def survey(data: Survey, user=Depends(current_user)):
    with db() as c:
        c.execute('UPDATE users SET survey=? WHERE id=?', (data.model_dump_json(), user['id']))
    return {'ok': True}


def validate_files(files):
    if not isinstance(files, dict) or not 1 <= len(files) <= 200:
        raise ValueError('Projede 1–200 metin dosyası olmalı.')
    for path, content in files.items():
        if (not isinstance(path, str) or not path or len(path) > 240 or path.startswith('/') or '\\' in path
            or any(part in ('', '.', '..', '.git') for part in path.split('/')) or any(ord(char) < 32 for char in path)
            or not isinstance(content, str)):
            raise ValueError('Geçersiz dosya yolu veya içeriği.')
    if len(json.dumps(files).encode()) > 2_000_000:
        raise ValueError('Proje en fazla 2 MB olabilir.')
    return files


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    files: dict[str, str]
    revision: int = Field(ge=0)
    @field_validator('files')
    @classmethod
    def files_valid(cls, value):
        return validate_files(value)


class VersionCreate(BaseModel):
    label: str = Field(default='Elle kaydedildi', min_length=1, max_length=100)


def owned(c, project_id, user):
    row = c.execute('SELECT * FROM projects WHERE id=? AND user_id=?', (project_id, user['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'Proje bulunamadı.')
    return row


def snapshot(c, project, label):
    c.execute('INSERT INTO versions(id,project_id,name,files,label) VALUES (?,?,?,?,?)', (uuid.uuid4().hex, project['id'], project['name'], project['files'], label))
    c.execute('DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30)', (project['id'], project['id']))


def ensure_idle(c, project_id):
    if c.execute('SELECT 1 FROM ai_jobs WHERE project_id=?', (project_id,)).fetchone():
        raise HTTPException(409, 'AI yanıtını bekleyin; proje şu an düzenleniyor.')


@app.get('/api/projects')
def projects(user=Depends(current_user)):
    with db() as c:
        return [dict(r) for r in c.execute('SELECT id,name,updated_at,revision FROM projects WHERE user_id=? ORDER BY updated_at DESC,rowid DESC', (user['id'],))]


@app.post('/api/projects')
def create_project(user=Depends(current_user)):
    project_id = uuid.uuid4().hex
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT count(*) FROM projects WHERE user_id=?', (user['id'],)).fetchone()[0] >= 50:
            raise HTTPException(409, 'En fazla 50 proje oluşturabilirsiniz.')
        c.execute('INSERT INTO projects(id,user_id,name,files) VALUES (?,?,?,?)', (project_id, user['id'], 'Yeni proje · AI adlandıracak', json.dumps(DEFAULT_FILES)))
        return serialize_project(owned(c, project_id, user))


@app.get('/api/projects/{project_id}')
def get_project(project_id: str, user=Depends(current_user)):
    with db() as c:
        project = serialize_project(owned(c, project_id, user))
        project['messages'] = [dict(r) for r in c.execute('SELECT role,content FROM (SELECT * FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 100) ORDER BY id', (project_id,))]
        return project


@app.put('/api/projects/{project_id}')
def save_project(project_id: str, data: ProjectUpdate, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = owned(c, project_id, user)
        ensure_idle(c, project_id)
        if row['revision'] != data.revision:
            raise HTTPException(409, 'Bu proje başka bir sekmede değişti. Önce ZIP indirerek değişikliklerinizi yedekleyin, sonra sayfayı yenileyin.')
        c.execute('UPDATE projects SET name=?,ai_named=?,files=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (data.name.strip() or row['name'], int(row['ai_named'] or data.name != row['name']), json.dumps(data.files), project_id))
        return serialize_project(owned(c, project_id, user))


@app.get('/api/projects/{project_id}/versions')
def versions(project_id: str, user=Depends(current_user)):
    with db() as c:
        owned(c, project_id, user)
        return [dict(r) for r in c.execute('SELECT id,label,name,created_at FROM versions WHERE project_id=? ORDER BY created_at DESC,rowid DESC', (project_id,))]


@app.post('/api/projects/{project_id}/versions')
def checkpoint(project_id: str, data: VersionCreate, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = owned(c, project_id, user)
        ensure_idle(c, project_id)
        snapshot(c, row, data.label)
    return {'ok': True}


@app.post('/api/projects/{project_id}/versions/{version_id}/restore')
def restore(project_id: str, version_id: str, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = owned(c, project_id, user)
        ensure_idle(c, project_id)
        version = c.execute('SELECT * FROM versions WHERE id=? AND project_id=?', (version_id, project_id)).fetchone()
        if not version:
            raise HTTPException(404, 'Sürüm bulunamadı.')
        snapshot(c, row, 'Geri yükleme öncesi')
        c.execute('UPDATE projects SET files=?,name=?,ai_named=1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (version['files'], version['name'], project_id))
        return serialize_project(owned(c, project_id, user))


class AiRequest(BaseModel):
    provider: Literal['gemini', 'openai', 'anthropic', 'deepseek']
    key: str = Field(min_length=1, max_length=1024)
    prompt: str = Field(min_length=1, max_length=12000)
    thinking: Literal['low', 'medium', 'high'] = 'medium'
    system_prompt: str = Field(default='', max_length=6000)
    reference: str | None = None
    revision: int


@app.post('/api/projects/{project_id}/ai')
async def ai(project_id: str, data: AiRequest, user=Depends(current_user)):
    cost = MODELS[data.provider]['cost']
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = owned(c, project_id, user)
        if row['revision'] != data.revision:
            raise HTTPException(409, 'Proje değişmiş. Yenileyip tekrar deneyin.')
        ensure_idle(c, project_id)
        if not c.execute('UPDATE users SET credits=credits-? WHERE id=? AND credits>=?', (cost, user['id'], cost)).rowcount:
            raise HTTPException(402, 'Günlük krediniz yetersiz. Krediler İstanbul saatine göre 00:00’da 20’ye yenilenir.')
        c.execute('INSERT INTO ai_jobs VALUES (?,?,?,?,?)', (project_id, user['id'], cost, day(), int(time.time())))
        history = [dict(r) for r in c.execute('SELECT role,content FROM (SELECT * FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 12) ORDER BY id', (project_id,))]
    try:
        prompt = json.dumps({'project': json.loads(row['files']), 'conversation': history, 'request': data.prompt, 'referenceFile': data.reference}, ensure_ascii=False)
        result = await generate(data.provider, data.key, prompt, data.thinking, data.system_prompt)
        updates = result.get('updateFiles', {})
        if not isinstance(updates, dict):
            raise ValueError('Geçersiz dosya güncellemesi.')
        files = validate_files(json.loads(row['files']) | updates)
        action = result.get('action') if result.get('action') in ('push', 'pages', 'create-repo') else None
        new_name = result.get('projectName')
        name = str(new_name).strip()[:100] if not row['ai_named'] and isinstance(new_name, str) and new_name.strip() else row['name']
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            snapshot(c, row, 'AI değişikliği öncesi')
            c.execute('UPDATE projects SET files=?,name=?,ai_named=?,pending_action=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(files), name, int(row['ai_named'] or name != row['name']), action, project_id))
            c.execute('INSERT INTO messages(project_id,role,content) VALUES (?,\'user\',?)', (project_id, data.prompt))
            c.execute('INSERT INTO messages(project_id,role,content) VALUES (?,\'ai\',?)', (project_id, result['summary'][:30000]))
            c.execute('DELETE FROM ai_jobs WHERE project_id=?', (project_id,))
        return {'ok': True, 'action': action}
    except Exception as error:
        with db() as c:
            job = c.execute('SELECT * FROM ai_jobs WHERE project_id=?', (project_id,)).fetchone()
            if job:
                c.execute('UPDATE users SET credits=MIN(20,credits+?) WHERE id=? AND credit_day=?', (cost, user['id'], job['credit_day']))
                c.execute('DELETE FROM ai_jobs WHERE project_id=?', (project_id,))
        if isinstance(error, HTTPException):
            raise error
        raise HTTPException(502, 'AI yanıtı uygulanamadı. Projeniz korunuyor, kredi iade edildi.')


class GithubToken(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


@app.post('/api/github/connect')
async def connect(data: GithubToken, user=Depends(current_user)):
    identity = await github_identity(data.token)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        linked = c.execute('SELECT user_id FROM identities WHERE provider=\'github\' AND subject=?', (identity['id'],)).fetchone()
        if linked and linked['user_id'] != user['id']:
            raise HTTPException(409, 'Bu GitHub hesabı başka bir Armut Pen hesabına bağlı.')
        existing = c.execute('SELECT subject FROM identities WHERE provider=\'github\' AND user_id=?', (user['id'],)).fetchone()
        if existing and existing['subject'] != identity['id']:
            raise HTTPException(409, 'Hesabına farklı bir GitHub hesabı zaten bağlı.')
        c.execute('INSERT OR IGNORE INTO identities(provider,subject,user_id,login) VALUES (\'github\',?,?,?)', (identity['id'], user['id'], identity['login']))
    return identity


class GithubAction(GithubToken):
    action: Literal['push', 'create-repo', 'pages']
    owner: str = Field(max_length=100)
    repo: str = Field(max_length=100)


@app.post('/api/projects/{project_id}/github')
async def github(project_id: str, data: GithubAction, user=Depends(current_user)):
    with db() as c:
        row = owned(c, project_id, user)
        files = json.loads(row['files'])
    limit('github:' + user['id'], 30)
    result = await github_action(data.token, data.action, data.owner, data.repo, files)
    with db() as c:
        c.execute('UPDATE projects SET pending_action=NULL WHERE id=? AND user_id=?', (project_id, user['id']))
    return result
