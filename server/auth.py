"""Opaque, revocable sessions; no external credentials or signing secret required."""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from server.db import db, day

router = APIRouter(prefix='/api/auth')

class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=10, max_length=256)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(value.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ':' + value


def limit(bucket, count=30):
    now = int(time.time())
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('DELETE FROM rate_limits WHERE until < ?', (now,))
        row = c.execute('SELECT count FROM rate_limits WHERE bucket=?', (bucket,)).fetchone()
        if row and row['count'] >= count:
            raise HTTPException(429, 'Çok fazla deneme. 10 dakika sonra tekrar deneyin.')
        c.execute('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1', (bucket, now + 600))


def current_user(request: Request):
    token = request.cookies.get('armut_session', '')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>?', (digest(token), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, 'Oturum açmanız gerekiyor.')
        if row['credit_day'] != day():
            c.execute('UPDATE users SET credits=20,credit_day=? WHERE id=?', (day(), row['id']))
            row = c.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        return dict(row)


def public_user(user):
    import json
    return {k: user[k] for k in ('id', 'email', 'credits', 'credit_day')} | {'survey': json.loads(user['survey']) if user['survey'] else None}


def session(response, user_id):
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute('DELETE FROM sessions WHERE expires < ?', (int(time.time()),))
        c.execute('INSERT INTO sessions VALUES (?,?,?)', (digest(token), user_id, int(time.time()) + 30 * 86400))
    response.set_cookie('armut_session', token, httponly=True, secure=os.getenv('COOKIE_SECURE', 'true') == 'true', samesite='lax', max_age=30 * 86400, path='/')


@router.post('/register')
def register(data: Credentials, request: Request, response: Response):
    limit('register:' + request.client.host)
    email = data.email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'Geçerli bir e-posta girin.')
    user_id = uuid.uuid4().hex
    try:
        with db() as c:
            c.execute('INSERT INTO users(id,email,password,credit_day) VALUES (?,?,?,?)', (user_id, email, password_hash(data.password), day()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Bu e-posta kayıtlı. Giriş yapın.')
    session(response, user_id)
    return {'ok': True}


@router.post('/login')
def login(data: Credentials, request: Request, response: Response):
    limit('login:' + request.client.host)
    with db() as c:
        row = c.execute('SELECT * FROM users WHERE email=?', (data.email.strip().lower(),)).fetchone()
    stored = row['password'] if row and row['password'] else password_hash('dummy-password')
    valid = hmac.compare_digest(stored, password_hash(data.password, stored.split(':')[0]))
    if not row or not row['password'] or not valid:
        raise HTTPException(401, 'E-posta veya şifre hatalı.')
    session(response, row['id'])
    return {'ok': True}


@router.get('/me')
def me(user=Depends(current_user)):
    return public_user(user)


@router.get('/session')
def get_session(request: Request):
    try:
        return {'user': public_user(current_user(request))}
    except HTTPException as error:
        if error.status_code == 401:
            return {'user': None}
        raise


class GithubLogin(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


@router.post('/github')
async def github_login(data: GithubLogin, request: Request, response: Response):
    import httpx
    from server.integrations import request_json
    limit('github-login:' + request.client.host)
    async with httpx.AsyncClient(timeout=20, headers={'Authorization': 'Bearer ' + data.token, 'Accept': 'application/vnd.github+json'}) as client:
        identity = await request_json(client, 'GET', 'https://api.github.com/user')
        with db() as c:
            linked = c.execute('SELECT user_id FROM identities WHERE provider=\'github\' AND subject=?', (str(identity['id']),)).fetchone()
        if linked:
            session(response, linked['user_id'])
            return {'ok': True}
        emails = await request_json(client, 'GET', 'https://api.github.com/user/emails')
    email = next((e['email'].lower() for e in emails if e.get('primary') and e.get('verified')), None)
    if not email:
        raise HTTPException(422, 'GitHub hesabında doğrulanmış birincil e-posta ve token için e-posta okuma izni gerekiyor.')
    user_id = uuid.uuid4().hex
    try:
        with db() as c:
            c.execute('INSERT INTO users(id,email,credit_day) VALUES (?,?,?)', (user_id, email, day()))
            c.execute('INSERT INTO identities(provider,subject,user_id,login) VALUES (\'github\',?,?,?)', (str(identity['id']), user_id, identity['login']))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Bu e-posta zaten kayıtlı. Önce şifrenle giriş yapıp AI Ayarları’ndan GitHub tokenını doğrulayarak hesabını bağla.')
    session(response, user_id)
    return {'ok': True}


@router.post('/logout')
def logout(request: Request, response: Response):
    with db() as c:
        c.execute('DELETE FROM sessions WHERE token_hash=?', (digest(request.cookies.get('armut_session', '')),))
    response.delete_cookie('armut_session', path='/')
    return {'ok': True}
