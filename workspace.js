import { $, files, activeFile, referenceFile, initEditor, setFiles, changed, showLog } from './app.js';
import { initTools } from './editor-tools.js';

let user = null, project = null, modelCatalog = {}, keys = {}, githubToken = '';
let githubOwner = '', githubRepo = '', pendingAction = null, isRegister = false;
let dirty = 0, saved = 0, saveTimer, saving = null, busy = false, toastTimer;
const modal = (id, open) => $(id).classList.toggle('active', open);
function status(text) { $('saveStatus').textContent = text; }
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(path, method = 'GET', data) {
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Armut-Request': '1' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    let result;
    try { result = await response.json(); } catch { throw Error('Sunucuya ulaşılamadı. Tekrar deneyin.'); }
    if (!response.ok) {
        const message = typeof result.detail === 'string' ? result.detail : 'Girilen bilgiler geçersiz. Alanları kontrol edin.';
        throw Error(message);
    }
    return result;
}
function preferences() {
    try { return JSON.parse(localStorage.getItem('armut-preferences-' + user.id) || '{}'); } catch { return {}; }
}
function savePreferences() {
    localStorage.setItem('armut-preferences-' + user.id, JSON.stringify({ thinking: $('thinkingLevel').value, systemPrompt: $('systemPrompt').value, model: $('modelSelect').value, mode: document.body.dataset.mode, githubOwner, githubRepo }));
}
function setMode(mode) {
    if (!['ai', 'half', 'code'].includes(mode)) mode = 'half';
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    if (user) savePreferences();
}
function ask({ title, label = '', value = '', options, note = '', submit = 'Uygula', action }) {
    $('toolTitle').textContent = title; $('toolLabelText').textContent = label;
    $('toolInput').value = value; $('toolInput').hidden = !!options; $('toolInput').required = !!label && !options;
    $('toolSelect').hidden = !options; $('toolLabel').hidden = !label;
    $('toolSelect').replaceChildren(...(options || []).map(([v, text]) => new Option(text, v)));
    $('toolNote').textContent = note; $('toolError').textContent = ''; $('toolSubmit').textContent = submit;
    $('toolForm').onsubmit = async event => {
        event.preventDefault(); $('toolSubmit').disabled = true;
        try { await action(options ? $('toolSelect').value : $('toolInput').value.trim()); $('toolModal').close(); }
        catch (error) { $('toolError').textContent = error.message; }
        finally { $('toolSubmit').disabled = false; }
    };
    $('toolModal').showModal();
}
$('toolCancel').onclick = () => $('toolModal').close();
function markDirty() {
    if (!project || busy) return;
    dirty++; status('Kaydedilmemiş değişiklikler…');
    clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(error => status('⚠ ' + error.message)), 700);
}
async function flush() {
    clearTimeout(saveTimer);
    if (saving) { await saving; if (dirty > saved) return flush(); return; }
    if (!project || dirty === saved) return;
    const generation = dirty;
    const id = project.id;
    const payload = { name: project.name, files: { ...files }, revision: project.revision };
    status('Kaydediliyor…');
    saving = api('/projects/' + id, 'PUT', payload).then(result => {
        project.revision = result.revision; project.ai_named = result.ai_named; saved = generation;
        status(dirty === saved ? '✓ Özel projene kaydedildi' : 'Kaydedilmemiş değişiklikler…');
    }).catch(error => { status('⚠ ' + error.message); throw error; }).finally(() => { saving = null; });
    await saving;
    if (dirty > saved) return flush();
}
function lock(value) {
    busy = value;
    $('codeEditor').disabled = value;
    for (const id of ['btnNewProject', 'btnRenameProject', 'projectSelect', 'btnSendAi', 'btnLogout', 'btnImport', 'btnAddFolder', 'btnAddFile', 'btnRenameFile', 'btnFormat', 'btnTemplates', 'btnVersions', 'btnReplaceAll']) $(id).disabled = value;
    $('fileTree').inert = value; $('tabsHeader').inert = value;
}
async function projectList() {
    const list = await api('/projects');
    $('projectSelect').replaceChildren(...list.map(p => new Option(p.name, p.id)));
    if (project) $('projectSelect').value = project.id;
    return list;
}
function renderMessages(messages) {
    $('chatHistory').replaceChildren();
    if (!messages.length) addMessage('Selam! Ben NOMI AI. Aklındaki projeyi anlat; ilk adını birlikte belirleyelim. Başlamak için AI Ayarları’ndan kendi sağlayıcı anahtarını gir.', 'ai');
    messages.forEach(message => addMessage(message.content, message.role));
}
function addMessage(text, role) {
    const item = document.createElement('div'); item.className = 'message ' + (role === 'user' ? 'user' : 'ai'); item.textContent = text;
    $('chatHistory').append(item); $('chatHistory').scrollTop = $('chatHistory').scrollHeight; return item;
}
function setPending(action) {
    pendingAction = action; $('pendingAction').hidden = !action;
    $('pendingLabel').textContent = ({ push: 'GitHub’a gönderme onayı bekliyor.', 'create-repo': 'Özel depo oluşturma onayı bekliyor.', pages: 'GitHub Pages yayınlama onayı bekliyor.' })[action] || '';
}
async function loadProject(id) {
    const result = await api('/projects/' + id);
    project = result; dirty = saved = 0;
    setFiles(result.files, 'index.html');
    renderMessages(result.messages || []); setPending(result.pending_action);
    $('projectSelect').value = result.id; $('consolePanel').replaceChildren(); $('userInput').value = '';
    localStorage.setItem('armut-project-' + user.id, result.id);
    status('✓ Özel projene kaydedildi');
}
async function updateUser() {
    user = await api('/auth/me'); $('credits').textContent = user.credits + ' / 20 kredi'; $('accountEmail').textContent = user.email;
}
async function enterWorkspace() {
    modal('surveyModal', false);
    const list = await projectList();
    if (!list.length) { const result = await api('/projects', 'POST'); await projectList(); await loadProject(result.id); }
    else { const id = localStorage.getItem('armut-project-' + user.id); await loadProject(list.some(p => p.id === id) ? id : list[0].id); }
    const prefs = preferences();
    $('thinkingLevel').value = prefs.thinking || 'medium'; $('systemPrompt').value = prefs.systemPrompt || '';
    $('modelSelect').value = Object.hasOwn(modelCatalog, prefs.model) ? prefs.model : 'gemini';
    githubOwner = prefs.githubOwner || ''; githubRepo = prefs.githubRepo || '';
    setMode(prefs.mode || 'half');
    document.body.classList.remove('locked');
}
async function afterLogin() {
    $('githubLoginToken').value = '';
    await updateUser();
    if (!user.survey) { modal('authModal', false); modal('surveyModal', true); }
    else { await enterWorkspace(); modal('authModal', false); }
}
initEditor(markDirty);
initTools({ ask, checkpoint, status: toast });

$('authToggle').onclick = () => {
    isRegister = !isRegister;
    $('authTitle').textContent = isRegister ? 'Yeni bir başlangıç' : 'Tekrar hoş geldin';
    $('authSubmit').textContent = isRegister ? 'Kayıt ol' : 'Giriş yap';
    $('authToggle').textContent = isRegister ? 'Zaten hesabın var mı? Giriş yap' : 'Hesabın yok mu? Kayıt ol';
    $('authPassword').autocomplete = isRegister ? 'new-password' : 'current-password'; $('authError').textContent = '';
};
$('authForm').onsubmit = async e => {
    e.preventDefault(); $('authSubmit').disabled = true; $('authError').textContent = '';
    try { await api('/auth/' + (isRegister ? 'register' : 'login'), 'POST', { email: $('authEmail').value, password: $('authPassword').value }); $('authPassword').value = ''; await afterLogin(); }
    catch (error) { $('authError').textContent = error.message; }
    finally { $('authSubmit').disabled = false; }
};
$('githubLoginForm').onsubmit = async e => {
    e.preventDefault(); $('githubLoginSubmit').disabled = true; $('authError').textContent = '';
    try { await api('/auth/github', 'POST', { token: $('githubLoginToken').value.trim() }); $('githubLoginToken').value = ''; await afterLogin(); }
    catch (error) { $('authError').textContent = error.message; }
    finally { $('githubLoginSubmit').disabled = false; }
};
$('surveyForm').onsubmit = async e => {
    e.preventDefault(); const button = e.submitter; button.disabled = true; $('surveyError').textContent = '';
    try { await api('/survey', 'POST', { coding: $('surveyCoding').value, ai: $('surveyAi').value, source: $('surveySource').value.trim() }); await enterWorkspace(); }
    catch (error) { modal('surveyModal', true); $('surveyError').textContent = error.message; }
    finally { button.disabled = false; }
};
$('btnLogout').onclick = async () => {
    try {
        await flush(); await api('/auth/logout', 'POST');
        keys = {}; githubToken = ''; user = project = null; dirty = saved = 0;
        document.querySelectorAll('#aiSettingsModal input').forEach(el => el.value = '');
        $('systemPrompt').value = ''; $('authPassword').value = ''; $('chatHistory').replaceChildren();
        $('preview-frame').srcdoc = ''; $('fs-preview-frame').srcdoc = ''; $('codeEditor').value = '';
        setFiles({ 'index.html': '' }); $('fileTree').replaceChildren(); $('tabsHeader').replaceChildren();
        document.body.classList.add('locked'); modal('authModal', true);
    } catch (error) { toast(error.message); }
};
window.addEventListener('beforeunload', e => { if (dirty !== saved || busy) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('online', () => flush().catch(error => status(error.message)));
$('projectSelect').onchange = async e => {
    const id = e.target.value; lock(true);
    try { await flush(); await loadProject(id); } catch (error) { e.target.value = project?.id || ''; toast(error.message); }
    finally { lock(false); }
};
$('btnNewProject').onclick = async () => {
    lock(true);
    try { await flush(); const result = await api('/projects', 'POST'); await projectList(); await loadProject(result.id); }
    catch (error) { toast(error.message); } finally { lock(false); }
};
$('btnRenameProject').onclick = () => ask({ title: 'Proje adını değiştir', label: 'Proje adı', value: project.name, submit: 'Kaydet', action: async name => {
    if (!name || name.length > 100) throw Error('Proje adı 1–100 karakter olmalı.');
    project.name = name; markDirty(); await flush(); await projectList();
} });
document.querySelectorAll('.mode-tabs button').forEach(button => button.onclick = () => setMode(button.dataset.mode));
$('btnAiFullscreen').onclick = () => setMode(document.body.dataset.mode === 'ai' ? 'half' : 'ai');
$('btnEditProject').onclick = () => setMode('half');
$('modelSelect').onchange = savePreferences;
function openSettings() {
    Object.keys(modelCatalog).forEach(provider => $('key-' + provider).value = keys[provider] || '');
    $('githubPat').value = githubToken; $('githubOwner').value = githubOwner; $('githubRepo').value = githubRepo;
    $('settingsStatus').textContent = ''; modal('aiSettingsModal', true);
}
$('btnAiSettings').onclick = openSettings;
$('btnCloseAiSettings').onclick = () => {
    document.querySelectorAll('#aiSettingsModal input[type=password]').forEach(input => input.value = '');
    modal('aiSettingsModal', false);
};
$('btnSaveAiSettings').onclick = () => {
    Object.keys(modelCatalog).forEach(provider => keys[provider] = $('key-' + provider).value.trim());
    githubToken = $('githubPat').value.trim(); githubOwner = $('githubOwner').value.trim(); githubRepo = $('githubRepo').value.trim();
    savePreferences(); modal('aiSettingsModal', false);
    document.querySelectorAll('#aiSettingsModal input[type=password]').forEach(input => input.value = '');
    toast('Ayarlar uygulandı. Anahtarlar yalnızca açık sayfanın belleğinde.');
};
$('btnConnectGithub').onclick = async () => {
    const token = $('githubPat').value.trim();
    if (!token) { $('settingsStatus').textContent = 'GitHub PAT tokenını gir.'; return; }
    $('btnConnectGithub').disabled = true;
    try { const result = await api('/github/connect', 'POST', { token }); $('githubOwner').value ||= result.login; $('settingsStatus').textContent = '✓ GitHub hesabı doğrulandı: ' + result.login + '. Ayarları uygula düğmesine bas.'; }
    catch (error) { $('settingsStatus').textContent = error.message; }
    finally { $('btnConnectGithub').disabled = false; }
};
async function sendMessage() {
    if (busy) return;
    const prompt = $('userInput').value.trim(); if (!prompt) return;
    const provider = $('modelSelect').value;
    if (!keys[provider]) { openSettings(); $('settingsStatus').textContent = modelCatalog[provider].label + ' için API anahtarını gir.'; return; }
    lock(true); let loading;
    try {
        await flush();
        addMessage(prompt, 'user'); loading = addMessage('NOMI AI düşünüyor…', 'ai');
        await api('/projects/' + project.id + '/ai', 'POST', { provider, key: keys[provider], prompt, thinking: $('thinkingLevel').value, system_prompt: $('systemPrompt').value, reference: referenceFile, revision: project.revision });
        await loadProject(project.id); await projectList();
    } catch (error) { if (loading) loading.textContent = '⚠ ' + error.message; else toast(error.message); }
    finally { try { await updateUser(); } catch {} lock(false); }
}
$('btnSendAi').onclick = sendMessage;
$('userInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
function github(action) {
    if (busy) return;
    setPending(action);
    if (!githubToken || !githubOwner || !githubRepo) { openSettings(); $('settingsStatus').textContent = 'Devam etmek için GitHub tokenını, kullanıcı/organizasyon ve depo adını girip ayarları uygula.'; return; }
    const note = action === 'pages' ? 'GitHub Pages sitenin içeriğini herkese açık yayınlayabilir. Yayınlanması birkaç dakika sürebilir.' : action === 'push' ? 'Projedeki dosyalar bu depoya tek commit olarak gönderilir; aynı adlı dosyalar güncellenir. Depodaki diğer dosyalar silinmez.' : 'Hesabında veya yetkili olduğun organizasyonda özel bir depo oluşturulur.';
    ask({ title: ({ push: 'GitHub’a gönder', 'create-repo': 'GitHub deposu oluştur', pages: 'GitHub Pages isteği gönder' })[action], note: githubOwner + '/' + githubRepo + ' — ' + note, submit: 'Onayla', action: async () => {
        lock(true);
        try {
            await flush(); const result = await api('/projects/' + project.id + '/github', 'POST', { action, token: githubToken, owner: githubOwner, repo: githubRepo });
            addMessage(result.message || ('GitHub işlemi tamamlandı: ' + result.url), 'ai'); setPending(null);
        } finally { lock(false); }
    } });
}
$('btnGitRepo').onclick = () => github('create-repo'); $('btnGitPush').onclick = () => github('push'); $('btnGitPages').onclick = () => github('pages'); $('btnPendingAction').onclick = () => github(pendingAction);
async function checkpoint(label = 'Elle kaydedildi') { await flush(); await api('/projects/' + project.id + '/versions', 'POST', { label }); }
async function renderVersions() {
    const versions = await api('/projects/' + project.id + '/versions'); $('versionList').replaceChildren();
    if (!versions.length) $('versionList').textContent = 'Henüz bir sürüm yok. İlk sürümünü kaydet.';
    versions.forEach(version => {
        const row = document.createElement('div'); row.className = 'version-row';
        const label = document.createElement('span'); label.textContent = version.label + ' · ' + new Date(version.created_at.replace(' ', 'T') + 'Z').toLocaleString('tr-TR');
        const button = document.createElement('button'); button.textContent = 'Geri yükle';
        button.onclick = () => ask({ title: 'Bu sürüme dön?', note: 'Mevcut çalışma önce ayrı bir sürüm olarak saklanır.', submit: 'Geri yükle', action: async () => {
            await flush(); await api('/projects/' + project.id + '/versions/' + version.id + '/restore', 'POST'); await loadProject(project.id); await projectList(); modal('versionsModal', false); toast('Sürüm geri yüklendi.');
        } });
        row.append(label, button); $('versionList').append(row);
    });
}
$('btnVersions').onclick = async () => { try { await flush(); await renderVersions(); modal('versionsModal', true); } catch (error) { toast(error.message); } };
$('btnCloseVersions').onclick = () => modal('versionsModal', false);
$('btnCheckpoint').onclick = async () => {
    $('btnCheckpoint').disabled = true;
    try { await checkpoint(); await renderVersions(); toast('Sürüm kaydedildi.'); } catch (error) { toast(error.message); }
    finally { $('btnCheckpoint').disabled = false; }
};
async function boot() {
    try {
        // Previous builds stored keys persistently. Do not carry them into shared accounts.
        localStorage.removeItem('nomi_ai_settings');
        modelCatalog = await api('/models');
        $('modelSelect').replaceChildren(...Object.entries(modelCatalog).map(([key, value]) => new Option(value.label + ' · ' + value.cost + ' kredi', key)));
        Object.entries(modelCatalog).forEach(([key, value]) => {
            const card = document.createElement('div'); card.className = 'provider-card';
            const label = document.createElement('label'); label.textContent = value.label; label.htmlFor = 'key-' + key;
            const input = document.createElement('input'); input.id = 'key-' + key; input.type = 'password'; input.placeholder = 'API anahtarın'; input.autocomplete = 'off'; input.maxLength = 1024;
            card.append(label, input); $('providerGrid').append(card);
        });
        const session = await api('/auth/session');
        if (session.user) await afterLogin();
    } catch (error) { $('authError').textContent = error.message; }
}
boot();
