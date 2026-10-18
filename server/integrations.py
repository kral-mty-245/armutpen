"""User-supplied keys are used per request, never persisted or returned."""
import json
import re
from urllib.parse import quote
import httpx
from fastapi import HTTPException

MODELS = {
    # Google Gemini
    'gemini': {'label': 'Gemini 3.1 Pro', 'model': 'gemini-3.1-pro-preview', 'provider': 'gemini', 'provider_label': 'Google Gemini'},
    'gemini-flash': {'label': 'Gemini 3.1 Flash', 'model': 'gemini-3.1-flash-preview', 'provider': 'gemini', 'provider_label': 'Google Gemini'},
    'gemini-ultra': {'label': 'Gemini 3.1 Ultra Think', 'model': 'gemini-3.1-ultra-preview', 'provider': 'gemini', 'provider_label': 'Google Gemini'},
    'gemini-2.5-pro': {'label': 'Gemini 2.5 Pro', 'model': 'gemini-2.5-pro', 'provider': 'gemini', 'provider_label': 'Google Gemini'},
    'gemini-2.5-flash': {'label': 'Gemini 2.5 Flash', 'model': 'gemini-2.5-flash', 'provider': 'gemini', 'provider_label': 'Google Gemini'},
    # OpenAI
    'openai': {'label': 'ChatGPT 5.6 Luna', 'model': 'gpt-5.6-luna', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    'gpt-5.4-pro': {'label': 'GPT-5.4 Pro', 'model': 'gpt-5.4-pro', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    'gpt-5.4-mini': {'label': 'GPT-5.4 Mini', 'model': 'gpt-5.4-mini', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    'o3-pro': {'label': 'OpenAI o3 Pro (Reasoning)', 'model': 'o3-pro', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    'o4-mini': {'label': 'OpenAI o4-mini (Reasoning)', 'model': 'o4-mini', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    'gpt-4.1': {'label': 'GPT-4.1', 'model': 'gpt-4.1', 'provider': 'openai', 'provider_label': 'OpenAI (ChatGPT)'},
    # Anthropic Claude
    'anthropic': {'label': 'Claude Sonnet 5', 'model': 'claude-sonnet-5', 'provider': 'anthropic', 'provider_label': 'Anthropic (Claude)'},
    'claude-opus-5': {'label': 'Claude Opus 5', 'model': 'claude-opus-5', 'provider': 'anthropic', 'provider_label': 'Anthropic (Claude)'},
    'claude-haiku-5': {'label': 'Claude Haiku 5 Fast', 'model': 'claude-haiku-5', 'provider': 'anthropic', 'provider_label': 'Anthropic (Claude)'},
    'claude-4.5-sonnet': {'label': 'Claude 4.5 Sonnet', 'model': 'claude-sonnet-4-5', 'provider': 'anthropic', 'provider_label': 'Anthropic (Claude)'},
    # DeepSeek
    'deepseek': {'label': 'DeepSeek V4.1 Flash', 'model': 'deepseek-v4.1-flash', 'provider': 'deepseek', 'provider_label': 'DeepSeek'},
    'deepseek-r2': {'label': 'DeepSeek R2 (Reasoner)', 'model': 'deepseek-r2', 'provider': 'deepseek', 'provider_label': 'DeepSeek'},
    'deepseek-v3': {'label': 'DeepSeek V3 Chat', 'model': 'deepseek-chat', 'provider': 'deepseek', 'provider_label': 'DeepSeek'},
    'deepseek-r1': {'label': 'DeepSeek R1 (Reasoner)', 'model': 'deepseek-reasoner', 'provider': 'deepseek', 'provider_label': 'DeepSeek'},
    # xAI Grok
    'grok-4': {'label': 'Grok 4', 'model': 'grok-4', 'provider': 'xai', 'provider_label': 'xAI (Grok)'},
    'grok-4-mini': {'label': 'Grok 4 Mini Fast', 'model': 'grok-4-mini', 'provider': 'xai', 'provider_label': 'xAI (Grok)'},
    'grok-3': {'label': 'Grok 3', 'model': 'grok-3', 'provider': 'xai', 'provider_label': 'xAI (Grok)'},
    # Mistral / Codestral
    'codestral': {'label': 'Codestral 25.08 (Kod Uzmanı)', 'model': 'codestral-latest', 'provider': 'mistral', 'provider_label': 'Mistral / Codestral'},
    'mistral-large': {'label': 'Mistral Large 3', 'model': 'mistral-large-latest', 'provider': 'mistral', 'provider_label': 'Mistral / Codestral'},
    # Groq
    'llama-4-maverick': {'label': 'Llama 4 Maverick (Groq)', 'model': 'meta-llama/llama-4-maverick-17b-128e-instruct', 'provider': 'groq', 'provider_label': 'Groq (Ultra Hızlı)'},
    'qwen-3-coder': {'label': 'Qwen 3 Coder 480B (Groq)', 'model': 'qwen/qwen3-coder-480b', 'provider': 'groq', 'provider_label': 'Groq (Ultra Hızlı)'},
    # OpenRouter
    'openrouter-auto': {'label': 'OpenRouter Auto (Tüm Modeller)', 'model': 'openrouter/auto', 'provider': 'openrouter', 'provider_label': 'OpenRouter'},
}

OPENAI_COMPAT_URLS = {
    'openai': 'https://api.openai.com/v1/chat/completions',
    'deepseek': 'https://api.deepseek.com/chat/completions',
    'xai': 'https://api.x.ai/v1/chat/completions',
    'mistral': 'https://api.mistral.ai/v1/chat/completions',
    'groq': 'https://api.groq.com/openai/v1/chat/completions',
    'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
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


async def generate(model_key, key, prompt, thinking, system_prompt):
    info = MODELS[model_key]
    model = info['model']
    provider = info.get('provider', model_key)
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
            url = OPENAI_COMPAT_URLS.get(provider, 'https://api.openai.com/v1/chat/completions')
            body = {'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}], 'response_format': {'type': 'json_object'}}
            if provider == 'openai':
                body['reasoning_effort'] = thinking
            elif provider == 'deepseek':
                body['thinking'] = {'type': 'enabled' if thinking != 'low' else 'disabled'}
            data = await request_json(client, 'POST', url, headers={'Authorization': 'Bearer ' + key}, json=body)
            raw = data.get('choices', [{}])[0].get('message', {}).get('content', '')
    try:
        result = json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip()))
        if not isinstance(result, dict) or not isinstance(result.get('summary'), str):
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise HTTPException(502, 'Model geçerli proje yanıtı üretmedi.')


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
