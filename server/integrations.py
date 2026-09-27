"""User-supplied keys are used per request, never persisted or returned."""
import json
import re
from urllib.parse import quote
import httpx
from fastapi import HTTPException

MODELS = {
    'gemini': {'label': 'Gemini 3.1 Pro', 'model': 'gemini-3.1-pro-preview', 'cost': 5},
    'openai': {'label': 'ChatGPT 5.6 Luna', 'model': 'gpt-5.6-luna', 'cost': 2},
    'anthropic': {'label': 'Claude Sonnet 5', 'model': 'claude-sonnet-5', 'cost': 5},
    'deepseek': {'label': 'DeepSeek V4.1 Flash', 'model': 'deepseek-v4.1-flash', 'cost': 4},
}

async def request_json(client, method, url, **kwargs):
    try:
        response = await client.request(method, url, **kwargs)
    except httpx.RequestError:
        raise HTTPException(502, 'Sağlayıcıya ulaşılamadı. Daha sonra tekrar deneyin.')
    if response.status_code >= 400:
        messages = {401: 'Anahtar geçersiz veya süresi dolmuş.', 403: 'Anahtarın bu işlem için yetkisi yok.', 404: 'Model veya depo bulunamadı; erişim izninizi kontrol edin.', 429: 'Sağlayıcı kotası veya hız sınırı aşıldı.', 422: 'Sağlayıcı isteği kabul etmedi; depo adı, model ve ayarları kontrol edin.'}
        raise HTTPException(502, messages.get(response.status_code, f'Sağlayıcı hatası ({response.status_code}). Model erişiminizi ve API bakiyenizi kontrol edin.'))
    return response.json() if response.content else {}


async def generate(provider, key, prompt, thinking, system_prompt):
    model = MODELS[provider]['model']
    system = ('Sen NOMI AI, bir web proje asistanısın. Yalnızca JSON döndür: '
              '{"summary":"Türkçe yanıt", "projectName":"kısa proje adı", "updateFiles":{"dosya/yolu":"tam içerik"}, "action":null}. '
              'action yalnızca null, create-repo, push veya pages olabilir; bu işlemler kullanıcı onayı ister. '
              'Silme isteğini açıklayarak belirt, dosya içeriklerini eksiltme. Projeyi değiştirmiyorsan updateFiles boş olsun. '
              'Kullanıcı tercihi: ' + system_prompt)
    async with httpx.AsyncClient(timeout=90) as client:
        if provider == 'gemini':
            data = await request_json(client, 'POST', f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                headers={'x-goog-api-key': key}, json={'systemInstruction': {'parts': [{'text': system}]}, 'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                'generationConfig': {'responseMimeType': 'application/json', 'thinkingConfig': {'thinkingLevel': thinking.upper()}}})
            raw = ''.join(p.get('text', '') for p in data.get('candidates', [{}])[0].get('content', {}).get('parts', []) if not p.get('thought'))
        elif provider == 'anthropic':
            body = {'model': model, 'max_tokens': 12000, 'system': system, 'messages': [{'role': 'user', 'content': prompt}],
                    'thinking': {'type': 'enabled', 'budget_tokens': {'low': 1024, 'medium': 2048, 'high': 4096}[thinking]}}
            data = await request_json(client, 'POST', 'https://api.anthropic.com/v1/messages', headers={'x-api-key': key, 'anthropic-version': '2023-06-01'}, json=body)
            raw = ''.join(p.get('text', '') for p in data.get('content', []) if p.get('type') == 'text')
        else:
            url = 'https://api.openai.com/v1/chat/completions' if provider == 'openai' else 'https://api.deepseek.com/chat/completions'
            body = {'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}], 'response_format': {'type': 'json_object'}}
            if provider == 'openai':
                body['reasoning_effort'] = thinking
            else:
                body['thinking'] = {'type': 'enabled' if thinking != 'low' else 'disabled'}
            data = await request_json(client, 'POST', url, headers={'Authorization': 'Bearer ' + key}, json=body)
            raw = data.get('choices', [{}])[0].get('message', {}).get('content', '')
    try:
        result = json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip()))
        if not isinstance(result, dict) or not isinstance(result.get('summary'), str):
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise HTTPException(502, 'Model geçerli proje yanıtı üretmedi. Krediniz iade edildi.')


async def github_identity(token):
    async with httpx.AsyncClient(timeout=20, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}) as client:
        user = await request_json(client, 'GET', 'https://api.github.com/user')
        return {'login': user['login'], 'id': str(user['id'])}


async def github_action(token, action, owner, repo, files):
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', owner) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}', repo):
        raise HTTPException(422, 'Geçerli GitHub kullanıcı/organizasyon ve depo adı girin.')
    base = f'https://api.github.com/repos/{owner}/{repo}'
    async with httpx.AsyncClient(timeout=45, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}) as client:
        if action == 'create-repo':
            identity = await request_json(client, 'GET', 'https://api.github.com/user')
            endpoint = 'https://api.github.com/user/repos' if owner.lower() == identity['login'].lower() else f'https://api.github.com/orgs/{owner}/repos'
            result = await request_json(client, 'POST', endpoint, json={'name': repo, 'private': True, 'auto_init': True, 'description': 'Armut Pen projesi'})
            return {'url': result['html_url']}
        metadata = await request_json(client, 'GET', base)
        branch = metadata['default_branch']
        if action == 'pages':
            await request_json(client, 'POST', base + '/pages', json={'source': {'branch': branch, 'path': '/'}})
            return {'url': f'https://{owner}.github.io/{repo}/', 'message': 'GitHub Pages isteği gönderildi; yayının tamamlanması birkaç dakika sürebilir. Özel depolar için ücretli GitHub planı gerekebilir.'}
        ref = await request_json(client, 'GET', base + '/git/ref/heads/' + quote(branch, safe=''))
        sha = ref['object']['sha']
        commit = await request_json(client, 'GET', base + '/git/commits/' + sha)
        tree = await request_json(client, 'POST', base + '/git/trees', json={'base_tree': commit['tree']['sha'], 'tree': [{'path': p, 'mode': '100644', 'type': 'blob', 'content': v} for p, v in files.items()]})
        new_commit = await request_json(client, 'POST', base + '/git/commits', json={'message': 'Update project from Armut Pen', 'tree': tree['sha'], 'parents': [sha]})
        await request_json(client, 'PATCH', base + '/git/refs/heads/' + quote(branch, safe=''), json={'sha': new_commit['sha'], 'force': False})
        return {'url': metadata['html_url']}
