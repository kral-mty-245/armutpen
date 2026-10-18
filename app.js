export const $ = (id) => document.getElementById(id);
export const MAX_LINES = 10000;
export let files = {};
export let activeFile = '';
export let referenceFile = null;
let onChange = () => {};
let previewTimer;
let renderedLines = 0;
let lineCache = '';
let lineOffsets = null;
const media = /\.(png|jpg|jpeg|gif|webp|mp3|mp4|wav|m4a|webm)$/i;

function ensureLineCache(maxLines) {
    if (lineOffsets && lineOffsets.length > maxLines) return;
    const size = Math.max(maxLines, MAX_LINES);
    lineOffsets = new Int32Array(size + 1);
    const parts = new Array(size);
    let offset = 0;
    for (let i = 1; i <= size; i++) {
        const s = String(i);
        parts[i - 1] = s;
        offset += s.length + (i > 1 ? 1 : 0);
        lineOffsets[i] = offset;
    }
    lineCache = parts.join('\n');
}

export function clampLines(text, max = MAX_LINES) {
    const str = typeof text === 'string' ? text : String(text ?? '');
    let lines = 1;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) === 10 && ++lines > max) {
            return { text: str.slice(0, i), truncated: true, lines: max };
        }
    }
    return { text: str, truncated: false, lines };
}

export function countLines(text) {
    return clampLines(text, Infinity).lines;
}

export function safePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(p => p && !['.', '..', '.git'].includes(p));
}

function updateLineNumbers(lines, force = false) {
    const statusEl = $('lineCountStatus');
    if (statusEl) statusEl.textContent = `${lines.toLocaleString('tr-TR')} / 10.000 satır`;
    if (!force && lines === renderedLines) return;
    renderedLines = lines;
    ensureLineCache(lines);
    $('lineNumbers').textContent = lineCache.slice(0, lineOffsets[lines]);
    $('lineNumbers').scrollTop = $('codeEditor').scrollTop;
}

export function setFiles(value, preferred = activeFile) {
    const normalized = Object.create(null);
    for (const [k, v] of Object.entries(value || {})) {
        normalized[k] = (typeof v === 'string' && !(v.startsWith('data:') && media.test(k))) ? clampLines(v).text : v;
    }
    files = normalized;
    activeFile = Object.hasOwn(files, preferred) ? preferred : Object.keys(files)[0];
    if (!Object.hasOwn(files, referenceFile)) clearReference();
    refresh();
}
export function changed() { onChange(); }
export function refresh() { renderTree(); renderTabs(); renderReferences(); openFile(activeFile); }
export function updateFile(path, content) {
    const isMediaData = typeof content === 'string' && content.startsWith('data:') && media.test(path);
    const clamped = isMediaData ? { text: content, truncated: false } : clampLines(content);
    if (clamped.truncated) showLog(`⚠ ${path}: Dosya başına sınır 10.000 satırdır; fazlası kırpıldı.`, true);
    files[path] = clamped.text;
    activeFile = path;
    changed();
    refresh();
}
export function showLog(message, error = false) {
    const line = document.createElement('div');
    line.className = error ? 'console-error' : 'console-info';
    line.textContent = message;
    $('consolePanel').append(line);
    while ($('consolePanel').children.length > 100) $('consolePanel').firstChild.remove();
    $('consolePanel').scrollTop = $('consolePanel').scrollHeight;
}
export function openFile(path) {
    if (!Object.hasOwn(files, path)) return;
    activeFile = path;
    const isMediaData = files[path].startsWith('data:') && media.test(path);
    const clamped = isMediaData ? { text: files[path], lines: 1 } : clampLines(files[path]);
    files[path] = clamped.text;
    $('codeEditor').value = files[path];
    $('codeEditor').readOnly = isMediaData;
    $('codeEditor').scrollTop = 0;
    $('codeEditor').scrollLeft = 0;
    updateLineNumbers(clamped.lines, true);
    renderTabs();
    renderTree();
    runPreview();
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
    const delay = (files[activeFile]?.length || 0) > 25000 ? 600 : 280;
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
    }, delay);
}
export async function downloadZip() {
    try {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        Object.entries(files).forEach(([path, content]) => {
            if (media.test(path) && content.startsWith('data:')) zip.file(path, content.split(',')[1], { base64: true });
            else zip.file(path, content);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'armut-pen-proje.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showLog(error.message, true); }
}
export function initEditor(callback) {
    onChange = callback;
    const editor = $('codeEditor');
    editor.oninput = () => {
        const clamped = clampLines(editor.value);
        if (clamped.truncated) {
            const top = editor.scrollTop;
            const pos = Math.min(editor.selectionStart, clamped.text.length);
            editor.value = clamped.text;
            editor.setSelectionRange(pos, pos);
            editor.scrollTop = top;
            showLog(`⚠ Dosya başına en fazla ${MAX_LINES.toLocaleString('tr-TR')} satır kod yazılabilir.`, true);
        }
        files[activeFile] = editor.value;
        updateLineNumbers(clamped.lines);
        changed();
        runPreview();
    };
    editor.onscroll = () => {
        $('lineNumbers').scrollTop = editor.scrollTop;
    };
    editor.onkeydown = e => {
        if (e.key === 'Tab') {
            e.preventDefault();
            editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
            editor.dispatchEvent(new Event('input'));
        } else if (e.key === 'Enter') {
            const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
            const netAddedLines = 1 - (countLines(selected) - 1);
            if (renderedLines + netAddedLines > MAX_LINES) {
                e.preventDefault();
                showLog(`⚠ Dosya başına en fazla ${MAX_LINES.toLocaleString('tr-TR')} satır kod yazılabilir.`, true);
            }
        }
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
                if (file.size > 2000000) throw Error('Dosya en fazla 2 MB olabilir.');
                if (Object.hasOwn(files, file.name) && !confirm(`${file.name} üzerine yazılsın mı?`)) continue;
                if (/^(image|audio|video)\//.test(file.type)) {
                    if (file.size > 500000) throw Error('Medya dosyası en fazla 500 KB olabilir.');
                    files[file.name] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
                } else if (/\.(zip|rar|exe|apk|7z|tar|gz)$/i.test(file.name)) {
                    throw Error('Arşivi önce cihazınızda açıp içindeki dosyaları seçin.');
                } else {
                    const raw = await file.text();
                    const clamped = clampLines(raw);
                    if (clamped.truncated) showLog(`⚠ ${file.name}: 10.000 satır sınırı aşıldığı için ilk 10.000 satır alındı.`, true);
                    files[file.name] = clamped.text;
                }
            }
        } catch (error) { showLog(error.message, true); }
        changed(); refresh(); e.target.value = '';
    };
    window.addEventListener('message', e => {
        if (![ $('preview-frame').contentWindow, $('fs-preview-frame').contentWindow ].includes(e.source) || !e.data?.armutConsole) return;
        showLog(String(e.data.text).slice(0, 3000), e.data.kind === 'error');
    });
}
