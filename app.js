const PROVIDERS = {
            gemini: { label: 'Google Gemini API', models: [['gemini-3.6-flash','Gemini 3.6 Flash'], ['gemini-3.5-flash','Gemini 3.5 Flash'], ['gemini-3.1-pro-preview','Gemini 3.1 Pro']] },
            openai: { label: 'OpenAI ChatGPT', models: [['gpt-6-astra','GPT-6 Astra'], ['gpt-5.6-sol','GPT-5.6 Sol'], ['gpt-5.4-mini','GPT-5.4 mini']] },
            anthropic: { label: 'Anthropic Claude', models: [['claude-opus-5','Claude Opus 5'], ['claude-sonnet-5','Claude Sonnet 5'], ['claude-haiku-4-5','Claude Haiku 4.5']] },
            xai: { label: 'xAI Grok', models: [['grok-4.7','Grok 4.7'], ['grok-4.6','Grok 4.6'], ['grok-4.5','Grok 4.5']] },
            deepseek: { label: 'DeepSeek', models: [['deepseek-v4-flash','DeepSeek V4 Flash'], ['deepseek-v4-pro','DeepSeek V4 Pro']] }
        };

        const LANGUAGE_MAP = { html:'html', css:'css', js:'javascript', json:'json', py:'python', java:'java', c:'c', cpp:'cpp', go:'go', rs:'rust', txt:'plaintext' };
        const MEDIA_TYPES = { mp3:'audio', wav:'audio', m4a:'audio', mp4:'video', webm:'video', png:'image', jpg:'image', jpeg:'image' };
        const BINARY_TYPES = ['zip','rar','exe','apk', '7z', 'tar', 'gz'];

        let fileStructure = {
            folders: { src: ['src/style.css', 'src/script.js'] },
            files: {
                'index.html': "<!DOCTYPE html>\n<html><head><meta charset='UTF-8'></head><body><h1>🍐 Armut Pen v7.1</h1><p>NOMI AI ile üret.</p></body></html>",
                'src/style.css': 'body { background:#1e1e1e; color:#a6e22e; font-family:Arial; text-align:center; padding:50px; }',
                'src/script.js': "console.log('Çalışıyor!');"
            }
        };

        let activeFile = 'index.html';
        let referenceFile = null;
        let binaryFiles = {};
        let consoleLogs = [];

        const $ = (id) => document.getElementById(id);
        const codeEditor = $('codeEditor');
        const codeHighlight = $('highlightCode');
        const fileTree = $('fileTree');
        const tabsHeader = $('tabsHeader');
        const refSelect = $('refSelect');
        const consolePanel = $('consolePanel');

        window.addEventListener('DOMContentLoaded', () => {
            try {
                const savedStruct = localStorage.getItem('armut_v7_struct');
                if (savedStruct) fileStructure = JSON.parse(savedStruct);
            } catch (e) {}

            bindUI();
            loadSettingsIntoForm();
            openFile(activeFile);
            updateFileTree();
            updateRefSelect();
            setupConsoleInterception();
        });

        function bindUI() {
            $('btnAiSettings').onclick = () => toggleModal('aiSettingsModal', true);
            $('btnCloseAiSettings').onclick = () => toggleModal('aiSettingsModal', false);
            $('btnSaveAiSettings').onclick = saveAiSettings;
            $('btnConnectGithub').onclick = connectGitHub;
            $('btnDownloadZip').onclick = downloadZip;
            $('btnRefresh').onclick = runPreview;
            $('btnAddFolder').onclick = createNewFolder;
            $('btnAddFile').onclick = createNewFileRoot;
            $('btnFullscreen').onclick = () => toggleFullscreen(true);
            $('btnCloseFs').onclick = () => toggleFullscreen(false);
            $('btnAiFullscreen').onclick = () => document.body.classList.toggle('ai-fullscreen');
            $('btnSendAi').onclick = sendMessage;
            $('btnGitPush').onclick = () => triggerGitHubAction('push');
            $('btnGitRepo').onclick = () => triggerGitHubAction('create-repo');
            $('btnGitPages').onclick = () => triggerGitHubAction('pages');
            $('btnClearRef').onclick = clearReference;
            $('btnImport').onclick = () => $('fileImport').click();
            $('fileImport').onchange = handleImport;
            $('btnTheme').onclick = () => document.body.classList.toggle('light-theme');
            $('btnFindReplace').onclick = () => toggleModal('findReplaceModal', true);
            $('btnCloseFindReplace').onclick = () => toggleModal('findReplaceModal', false);
            $('btnFindAll').onclick = findAll;
            $('btnReplaceAll').onclick = replaceAll;
            $('searchFiles').oninput = filterFileTree;
            $('userInput').onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };
            refSelect.onchange = (e) => setReferenceFile(e.target.value);

            codeEditor.oninput = () => {
                fileStructure.files[activeFile] = codeEditor.value;
                persist();
                updateLineNumbers();
                highlightCode();
                runPreview();
            };

            codeEditor.onscroll = () => {
                $('lineNumbers').scrollTop = codeEditor.scrollTop;
                $('codeHighlight').scrollTop = codeEditor.scrollTop;
            };

            renderProviderSettings();
        }

        function toggleModal(id, show) {
            $(id).classList.toggle('active', show);
        }

        function renderProviderSettings() {
            const saved = JSON.parse(localStorage.getItem('nomi_ai_settings') || '{}');
            $('providerGrid').innerHTML = Object.entries(PROVIDERS).map(([key, provider]) => {
                const selectedModel = saved.models && saved.models[key] ? saved.models[key] : provider.models[0][0];
                return `
                    <div class="provider-card">
                        <label><input type="radio" name="provider" value="${key}" ${saved.provider === key ? 'checked' : ''}> ${provider.label}</label>
                        <input type="password" id="key-${key}" placeholder="API key" value="${saved.keys && saved.keys[key] ? saved.keys[key] : ''}">
                        <select id="model-${key}">
                            ${provider.models.map(([value, label]) => `<option value="${value}" ${selectedModel === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                `;
            }).join('');
        }

        function loadSettingsIntoForm() {
            const s = JSON.parse(localStorage.getItem('nomi_ai_settings') || '{}');
            $('githubPat').value = s.githubPat || '';
            $('githubClientId').value = s.githubClientId || '';
            $('githubOwner').value = s.githubOwner || '';
            $('githubRepo').value = s.githubRepo || '';
        }

        function saveAiSettings() {
            const provider = document.querySelector('input[name=provider]:checked')?.value;
            if (!provider) return alert('Bir AI sağlayıcısı seçin.');

            const keys = {};
            const models = {};
            Object.keys(PROVIDERS).forEach((k) => {
                keys[k] = $(`key-${k}`).value.trim();
                models[k] = $(`model-${k}`).value;
            });

            if (!keys[provider]) return alert('Seçilen sağlayıcı için API anahtarı girin.');

            const settings = {
                provider,
                keys,
                models,
                githubPat: $('githubPat').value.trim(),
                githubClientId: $('githubClientId').value.trim(),
                githubOwner: $('githubOwner').value.trim(),
                githubRepo: $('githubRepo').value.trim()
            };

            localStorage.setItem('nomi_ai_settings', JSON.stringify(settings));
            toggleModal('aiSettingsModal', false);
            addMessage(`✅ ${PROVIDERS[provider].label} / ${models[provider]} hazır.`, 'ai');
        }

        function getSettings() {
            return JSON.parse(localStorage.getItem('nomi_ai_settings') || '{}');
        }

        function setupConsoleInterception() {
            const originalLog = console.log;
            const originalError = console.error;
            console.log = (...args) => {
                consoleLogs.push({ type: 'log', content: args.join(' ') });
                updateConsolePanel();
                originalLog.apply(console, args);
            };
            console.error = (...args) => {
                consoleLogs.push({ type: 'error', content: args.join(' ') });
                updateConsolePanel();
                originalError.apply(console, args);
            };
        }

        function updateConsolePanel() {
            consolePanel.innerHTML = consoleLogs.map(log => `<div class="console-log console-${log.type}">${escapeHtml(log.content)}</div>`).join('');
            consolePanel.scrollTop = consolePanel.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function persist() {
            localStorage.setItem('armut_v7_struct', JSON.stringify(fileStructure));
        }

        function updateLineNumbers() {
            $('lineNumbers').innerHTML = codeEditor.value.split('\n').map((_, index) => (index + 1) + '<br>').join('');
        }

        function highlightCode() {
            const ext = activeFile.split('.').pop().toLowerCase();
            const lang = LANGUAGE_MAP[ext] || 'plaintext';
            codeHighlight.textContent = codeEditor.value;
            codeHighlight.className = `language-${lang}`;
            hljs.highlightElement(codeHighlight);
        }

        function openFile(filepath) {
            if (fileStructure.files[filepath] === undefined) return;
            activeFile = filepath;
            codeEditor.value = fileStructure.files[filepath];
            updateLineNumbers();
            highlightCode();
            renderTabs();
            updateFileTree();
            runPreview();
        }

        function renderTabs() {
            tabsHeader.innerHTML = Object.keys(fileStructure.files).map((filepath) => `
                <div class="tab ${filepath === activeFile ? 'active' : ''}" data-tab="${filepath}">${filepath.split('/').pop()}</div>
            `).join('');

            tabsHeader.querySelectorAll('[data-tab]').forEach((el) => {
                el.onclick = () => openFile(el.dataset.tab);
            });
        }

        function updateFileTree() {
            fileTree.innerHTML = '';

            Object.keys(fileStructure.folders).forEach((folder) => {
                const folderDiv = document.createElement('div');
                folderDiv.className = 'tree-item folder';
                folderDiv.innerHTML = `<span>📁 ${folder}</span><span class="add-file-btn">➕</span>`;
                folderDiv.onclick = (e) => {
                    if (e.target.classList.contains('add-file-btn')) createNewFileInFolder(folder);
                };
                fileTree.appendChild(folderDiv);

                const childBox = document.createElement('div');
                childBox.className = 'folder-children';
                (fileStructure.folders[folder] || []).forEach((childPath) => {
                    const child = document.createElement('div');
                    child.className = `tree-item ${childPath === activeFile ? 'active' : ''}`;
                    child.innerHTML = `<span>📄 ${childPath.split('/').pop()}</span><span class="del-btn">✖</span>`;
                    child.onclick = (e) => {
                        if (e.target.classList.contains('del-btn')) return deleteItem(childPath);
                        openFile(childPath);
                    };
                    childBox.appendChild(child);
                });
                fileTree.appendChild(childBox);
            });

            Object.keys(fileStructure.files).forEach((filepath) => {
                const inFolder = Object.values(fileStructure.folders).some((arr) => arr.includes(filepath));
                if (!inFolder) {
                    const item = document.createElement('div');
                    item.className = `tree-item ${filepath === activeFile ? 'active' : ''}`;
                    item.innerHTML = `<span>📄 ${filepath}</span><span class="del-btn">✖</span>`;
                    item.onclick = (e) => {
                        if (e.target.classList.contains('del-btn')) return deleteItem(filepath);
                        openFile(filepath);
                    };
                    fileTree.appendChild(item);
                }
            });
        }

        function updateRefSelect() {
            refSelect.innerHTML = '<option value="">📎 Dosya Bağla...</option>' + Object.keys(fileStructure.files).map((filepath) => `<option value="${filepath}">${filepath}</option>`).join('');
        }

        function setReferenceFile(filepath) {
            if (!filepath) return clearReference();
            referenceFile = filepath;
            $('refFileName').textContent = `📄 ${filepath}`;
            $('refFileBox').style.display = 'flex';
        }

        function clearReference() {
            referenceFile = null;
            refSelect.value = '';
            $('refFileBox').style.display = 'none';
        }

        function createNewFolder() {
            const folderName = prompt('Yeni Klasör Adı:');
            if (!folderName) return;
            if (fileStructure.folders[folderName]) return alert('Bu klasör zaten var!');
            fileStructure.folders[folderName] = [];
            saveAndRefresh();
        }

        function createNewFileRoot() {
            const fileName = prompt('Dosya Adı (örn: script.js):');
            if (!fileName) return;
            addFileToSystem(fileName);
        }

        function createNewFileInFolder(folderName) {
            const fileName = prompt(`[${folderName}] klasörüne dosya adı:`);
            if (!fileName) return;
            const fullPath = `${folderName}/${fileName}`;
            if (!fileStructure.folders[folderName]) fileStructure.folders[folderName] = [];
            fileStructure.folders[folderName].push(fullPath);
            addFileToSystem(fullPath);
        }

        function addFileToSystem(filepath) {
            if (fileStructure.files[filepath] !== undefined) return;
            fileStructure.files[filepath] = '';
            saveAndRefresh();
            openFile(filepath);
        }

        function deleteItem(filepath) {
            if (!confirm('Dosyayı silmek istediğine emin misin?')) return;
            delete fileStructure.files[filepath];
            delete binaryFiles[filepath];
            Object.keys(fileStructure.folders).forEach((folder) => {
                fileStructure.folders[folder] = (fileStructure.folders[folder] || []).filter((x) => x !== filepath);
            });
            const next = Object.keys(fileStructure.files)[0];
            if (next) openFile(next);
            saveAndRefresh();
        }

        function saveAndRefresh() {
            persist();
            updateFileTree();
            updateRefSelect();
            renderTabs();
            runPreview();
        }

        function filterFileTree() {
            const q = $('searchFiles').value.toLowerCase();
            document.querySelectorAll('.tree-item').forEach((node) => {
                node.style.display = node.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        }

        function downloadZip() {
            if (typeof JSZip === 'undefined') return alert('JSZip yüklenemedi!');
            const zip = new JSZip();
            Object.keys(fileStructure.files).forEach((filepath) => zip.file(filepath, fileStructure.files[filepath]));
            zip.generateAsync({ type: 'blob' }).then((content) => saveAs(content, 'armut-pen-proje.zip'));
        }

        function runPreview() {
            const ext = activeFile.split('.').pop().toLowerCase();
            if (MEDIA_TYPES[ext]) {
                updateMediaPreview();
                return;
            }

            let html = fileStructure.files['index.html'] || '';
            Object.keys(fileStructure.files).forEach((path) => {
                if (path.endsWith('.css')) html += `<style>${fileStructure.files[path]}</style>`;
                if (path.endsWith('.js') && !path.includes('node_modules')) html += `<script>${fileStructure.files[path]}<\/script>`;
            });

            try {
                const frameDoc = $('preview-frame').contentDocument || $('preview-frame').contentWindow.document;
                frameDoc.open();
                frameDoc.write(html);
                frameDoc.close();

                const fsFrame = $('fs-preview-frame');
                const fsDoc = fsFrame.contentDocument || fsFrame.contentWindow.document;
                fsDoc.open();
                fsDoc.write(html);
                fsDoc.close();

                $('previewTitle').textContent = '🌐 Canlı Önizleme';
            } catch (e) {
                console.error('Preview error:', e);
            }
        }

        function updateMediaPreview() {
            const ext = activeFile.split('.').pop().toLowerCase();
            const mediaType = MEDIA_TYPES[ext];
            if (!mediaType) return;

            const player = document.createElement('div');
            player.className = 'media-player';

            if (mediaType === 'audio') {
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = `data:audio/${ext};base64,${btoa(fileStructure.files[activeFile])}`;
                player.appendChild(audio);
            } else if (mediaType === 'video') {
                const video = document.createElement('video');
                video.controls = true;
                video.src = `data:video/${ext};base64,${btoa(fileStructure.files[activeFile])}`;
                player.appendChild(video);
            } else if (mediaType === 'image') {
                const imgWrap = document.createElement('div');
                imgWrap.className = 'media-viewer';
                const img = document.createElement('img');
                img.src = `data:image/${ext};base64,${btoa(fileStructure.files[activeFile])}`;
                imgWrap.appendChild(img);
                player.appendChild(imgWrap);
            }

            $('preview-container').innerHTML = '';
            $('preview-container').appendChild(player);
            $('previewTitle').textContent = `${activeFile}`;
        }

        function toggleFullscreen(show) {
            $('fullscreen-modal').classList.toggle('active', show);
            if (show) runPreview();
        }

        async function handleImport(e) {
            const files = e.target.files;
            for (const file of files) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (BINARY_TYPES.includes(ext) || file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        binaryFiles[file.name] = event.target.result;
                        fileStructure.files[file.name] = `[Binary: ${ext.toUpperCase()}] - ${file.size} bytes`;
                        saveAndRefresh();
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        fileStructure.files[file.name] = event.target.result;
                        saveAndRefresh();
                    };
                    reader.readAsText(file);
                }
            }
            e.target.value = '';
        }

        function addMessage(text, sender) {
            const chatHistory = $('chatHistory');
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${sender}`;
            msgDiv.innerHTML = text;
            chatHistory.appendChild(msgDiv);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }

        async function sendMessage() {
            const input = $('userInput');
            const prompt = input.value.trim();
            const s = getSettings();

            if (!prompt) return;
            if (!s.provider || !s.keys?.[s.provider]) {
                return alert('Önce NOMI AI Ayarları bölümünden sağlayıcı, API key ve modeli seçin.');
            }

            addMessage(prompt, 'user');
            input.value = '';

            const loading = document.createElement('div');
            loading.className = 'message ai';
            loading.textContent = '⚡️ NOMI AI çalışıyor...';
            $('chatHistory').appendChild(loading);

            const project = JSON.stringify(fileStructure).substring(0, 12000);
            const refs = referenceFile ? `\nREFERANS DOSYASI:\n${fileStructure.files[referenceFile].substring(0, 2000)}` : '';
            const system = `Sen NOMI AI'sın. Girdileri güvenli şekilde yönet. JSON döndür: {"summary":"...","updateFiles":{},"action":null}. PROJE:${project} İSTEK:${prompt}${refs}`;

            try {
                const raw = await callProvider(s, system);
                const clean = raw.replace(/```json|```/g, '').trim();
                const aiAction = JSON.parse(clean);

                if (aiAction.updateFiles) {
                    Object.entries(aiAction.updateFiles).forEach(([path, content]) => {
                        fileStructure.files[path] = content;
                    });
                }

                saveAndRefresh();

                if (aiAction.action === 'create-repo') {
                    loading.innerHTML = `✅ <b>${escapeHtml(aiAction.summary || 'Tamamlandı')}</b><br><button class="secondary" onclick="window.triggerGithubAction('create-repo')">GitHub Repo Oluştur</button>`;
                } else if (aiAction.action === 'push') {
                    loading.innerHTML = `✅ <b>${escapeHtml(aiAction.summary || 'Tamamlandı')}</b><br><button class="secondary" onclick="window.triggerGithubAction('push')">GitHub Push</button>`;
                } else if (aiAction.action === 'pages') {
                    loading.innerHTML = `✅ <b>${escapeHtml(aiAction.summary || 'Tamamlandı')}</b><br><button class="secondary" onclick="window.triggerGithubAction('pages')">GitHub Pages</button>`;
                } else {
                    loading.innerHTML = `✅ <b>${escapeHtml(aiAction.summary || 'Tamamlandı')}</b>`;
                }
            } catch (e) {
                loading.textContent = '⚠️ ' + e.message;
            }
        }

        async function callProvider(settings, prompt) {
            const provider = settings.provider;
            const key = settings.keys[provider];
            const model = settings.models[provider];

            if (provider === 'gemini') {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }

            if (provider === 'anthropic') {
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
                });
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                return data.content?.[0]?.text || '';
            }

            if (provider === 'openai' || provider === 'xai' || provider === 'deepseek') {
                const base = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : provider === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
                const response = await fetch(base, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
                });
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                return data.choices?.[0]?.message?.content || '';
            }

            throw new Error('Desteklenmeyen sağlayıcı.');
        }

        function findAll() {
            const q = $('searchInput').value;
            if (!q) return alert('Aranan metni gir.');
            alert(`${(codeEditor.value.split(q).length - 1)} eşleşme bulundu.`);
        }

        function replaceAll() {
            const q = $('searchInput').value;
            if (!q) return;
            codeEditor.value = codeEditor.value.split(q).join($('replaceInput').value);
            codeEditor.dispatchEvent(new Event('input'));
            toggleModal('findReplaceModal', false);
        }

        function connectGitHub() {
            const settings = getSettings();
            const clientId = settings.githubClientId || $('githubClientId').value.trim();
            if (!clientId) {
                alert('GitHub OAuth Client ID yok. Ayarlar ekranından ekleyin.');
                return;
            }
            const backendStart = '/api/github?action=start';
            window.open(backendStart, '_blank', 'width=650,height=700');
            alert('GitHub izin sayfası açıldı. Gerekli izinleri verdikten sonra otomatik dönecek.');
        }

        async function triggerGitHubAction(action) {
            const settings = getSettings();
            const owner = settings.githubOwner || $('githubOwner').value.trim();
            const repo = settings.githubRepo || $('githubRepo').value.trim();
            if (!owner || !repo) {
                alert('GitHub Owner ve Repo alanlarını doldur.');
                return;
            }

            try {
                const payload = { action, owner, repo, files: fileStructure.files };
                const response = await fetch('/api/github', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'GitHub işlemi başarısız');
                addMessage(`✅ GitHub işlem başarılı: ${data.url || 'GitHub'}`, 'ai');
            } catch (err) {
                addMessage(`⚠️ GitHub hata: ${err.message}`, 'ai');
            }
        }

        window.triggerGithubAction = triggerGitHubAction;