import hljs from 'highlight.js';
import JSZip from 'jszip';
import 'highlight.js/styles/atom-one-dark.css';

export const $ = (id) => document.getElementById(id);
export let files = {};
export let activeFile = '';
export let referenceFile = null;
let onChange = () => {};
let previewTimer;
const languages = { html: 'xml', css: 'css', js: 'javascript', json: 'json', py: 'python', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rs: 'rust', txt: 'plaintext' };
const media = /\.(png|jpg|jpeg|gif|webp|mp3|mp4|wav|m4a|webm)$/i;

export function safePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(p => p && !['.', '..', '.git'].includes(p));
}
export function setFiles(value, preferred = activeFile) {
    files = Object.assign(Object.create(null), value);
    activeFile = Object.hasOwn(files, preferred) ? preferred : Object.keys(files)[0];
    if (!Object.hasOwn(files, referenceFile)) clearReference();
    refresh();
}
export function changed() { onChange(); }
export function refresh() { renderTree(); renderTabs(); renderReferences(); openFile(activeFile); }
export function updateFile(path, content) { files[path] = content; activeFile = path; changed(); refresh(); }
export function showLog(message, error = false) {
    const line = document.createElement('div');
    line.className = error ? 'console-error' : 'console-info';
    line.textContent = message;
    $('consolePanel').append(line);
    while ($('consolePanel').children.length > 100) $('consolePanel').firstChild.remove();
    $('consolePanel').scrollTop = $('consolePanel').scrollHeight;
}
function highlight() {
    const value = $('codeEditor').value;
    const lang = languages[activeFile?.split('.').pop()] || 'plaintext';
    $('highlightCode').innerHTML = hljs.highlight(value, { language: lang, ignoreIllegals: true }).value + '\n';
    $('lineNumbers').textContent = value.split('\n').map((_, i) => i + 1).join('\n');
}
export function openFile(path) {
    if (!Object.hasOwn(files, path)) return;
    activeFile = path;
    $('codeEditor').value = files[path];
    $('codeEditor').readOnly = files[path].startsWith('data:') && media.test(path);
    highlight(); renderTabs(); renderTree(); runPreview();
}
function renderTabs() {
    $('tabsHeader').replaceChildren();
    Object.keys(files).forEach(path => {
        const button = document.createElement('button');
        button.className = 'tab ' + (path === activeFile ? 'active' : '');
        button.textContent = path.split('/').pop(); button.title = path;
        button.onclick = () => openFile(path);
        $('tabsHeader').append(button);
    });
}
function renderTree() {
    $('fileTree').replaceChildren();
    const search = $('searchFiles').value.toLowerCase();
    Object.keys(files).sort().filter(path => path.toLowerCase().includes(search)).forEach(path => {
        const row = document.createElement('div'); row.className = 'tree-item ' + (path === activeFile ? 'active' : '');
        const name = document.createElement('button'); name.className = 'file-name'; name.textContent = '📄 ' + path;
        name.onclick = () => openFile(path);
        const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Dosyayı sil';
        remove.onclick = () => {
            if (Object.keys(files).length === 1) return showLog('Son dosyayı silemezsiniz.', true);
            if (!confirm(`${path} silinsin mi?`)) return;
            delete files[path];
            if (referenceFile === path) clearReference();
            if (activeFile === path) activeFile = Object.keys(files)[0];
            changed(); refresh();
        };
        row.append(name, remove); $('fileTree').append(row);
    });
}
function renderReferences() {
    $('refSelect').replaceChildren(new Option('📎 Dosya Bağla...', ''));
    Object.keys(files).forEach(path => $('refSelect').add(new Option(path, path)));
    $('refSelect').value = referenceFile || '';
}
export function clearReference() { referenceFile = null; $('refSelect').value = ''; $('refFileBox').hidden = true; }
export function runPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        let html;
        if (media.test(activeFile) && files[activeFile]?.startsWith('data:')) {
            const type = /\.(mp3|wav|m4a)$/i.test(activeFile) ? 'audio' : /\.(mp4|webm)$/i.test(activeFile) ? 'video' : 'img';
            const element = document.createElement(type);
            element.src = files[activeFile]; element.setAttribute('controls', ''); element.style.maxWidth = '100%';
            html = element.outerHTML;
        } else {
            const doc = new DOMParser().parseFromString(files['index.html'] || files[activeFile] || '', 'text/html');
            doc.querySelectorAll('script[src],link[rel="stylesheet"]').forEach(el => {
                const source = (el.getAttribute('src') || el.getAttribute('href') || '').replace(/^\.\//, '');
                if (Object.hasOwn(files, source)) el.remove();
            });
            Object.entries(files).forEach(([path, content]) => {
                if (path.endsWith('.css')) { const style = doc.createElement('style'); style.textContent = content.replace(/<\/style/gi, '<\\/style'); doc.head.append(style); }
                if (path.endsWith('.js')) { const script = doc.createElement('script'); script.textContent = content.replace(/<\/script/gi, '<\\/script'); doc.body.append(script); }
            });
            const bridge = doc.createElement('script');
            bridge.textContent = `for(const kind of ['log','warn','error']) { const original=console[kind]; console[kind]=(...args)=>{parent.postMessage({armutConsole:true,kind,text:args.map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' ')},'*');original.apply(console,args)} } window.addEventListener('error',e=>parent.postMessage({armutConsole:true,kind:'error',text:e.message+' (satır '+e.lineno+')'},'*'));`;
            doc.head.prepend(bridge);
            html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
        }
        $('preview-frame').srcdoc = html;
        if ($('fullscreen-modal').classList.contains('active')) $('fs-preview-frame').srcdoc = html;
    }, 250);
}
export function downloadZip() {
    const zip = new JSZip();
    Object.entries(files).forEach(([path, content]) => {
        if (media.test(path) && content.startsWith('data:')) zip.file(path, content.split(',')[1], { base64: true });
        else zip.file(path, content);
    });
    zip.generateAsync({ type: 'blob' }).then(blob => {
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'armut-pen-proje.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch(error => showLog(error.message, true));
}
export function initEditor(callback) {
    onChange = callback;
    $('codeEditor').oninput = () => { files[activeFile] = $('codeEditor').value; highlight(); changed(); runPreview(); };
    $('codeEditor').onscroll = () => { $('lineNumbers').scrollTop = $('codeEditor').scrollTop; $('codeHighlight').scrollTop = $('codeEditor').scrollTop; $('codeHighlight').scrollLeft = $('codeEditor').scrollLeft; };
    $('codeEditor').onkeydown = e => {
        if (e.key !== 'Tab') return;
        e.preventDefault(); const editor = $('codeEditor'); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input'));
    };
    $('searchFiles').oninput = renderTree;
    $('btnRefresh').onclick = runPreview;
    $('btnDownloadZip').onclick = downloadZip;
    $('refSelect').onchange = e => { referenceFile = e.target.value || null; $('refFileBox').hidden = !referenceFile; $('refFileName').textContent = referenceFile || ''; };
    $('btnClearRef').onclick = clearReference;
    $('btnFullscreen').onclick = () => { $('fullscreen-modal').classList.add('active'); runPreview(); };
    $('btnCloseFs').onclick = () => { $('fullscreen-modal').classList.remove('active'); $('fs-preview-frame').srcdoc = ''; };
    $('btnTheme').onclick = () => document.body.classList.toggle('light-theme');
    $('btnFindReplace').onclick = () => $('findReplaceModal').classList.add('active');
    $('btnCloseFindReplace').onclick = () => $('findReplaceModal').classList.remove('active');
    $('btnFindAll').onclick = () => { const q = $('searchInput').value; $('findResult').textContent = q ? `${files[activeFile].split(q).length - 1} eşleşme bulundu.` : 'Aranacak metni girin.'; };
    $('btnReplaceAll').onclick = () => { const q = $('searchInput').value; if (q) updateFile(activeFile, files[activeFile].split(q).join($('replaceInput').value)); $('findReplaceModal').classList.remove('active'); };
    $('btnImport').onclick = () => $('fileImport').click();
    $('fileImport').onchange = async e => {
        try {
            for (const file of e.target.files) {
                if (!safePath(file.name)) throw Error('Geçersiz dosya adı.');
                if (file.size > 500000) throw Error('Dosya en fazla 500 KB olabilir.');
                if (Object.hasOwn(files, file.name) && !confirm(`${file.name} üzerine yazılsın mı?`)) continue;
                if (/^(image|audio|video)\//.test(file.type)) {
                    files[file.name] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
                } else if (/\.(zip|rar|exe|apk|7z|tar|gz)$/i.test(file.name)) {
                    throw Error('Arşivi önce cihazınızda açıp içindeki dosyaları seçin.');
                } else files[file.name] = await file.text();
            }
        } catch (error) { showLog(error.message, true); }
        changed(); refresh(); e.target.value = '';
    };
    window.addEventListener('message', e => {
        if (![ $('preview-frame').contentWindow, $('fs-preview-frame').contentWindow ].includes(e.source) || !e.data?.armutConsole) return;
        showLog(String(e.data.text).slice(0, 3000), e.data.kind === 'error');
    });
}
