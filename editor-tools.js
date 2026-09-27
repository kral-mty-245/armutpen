import { $, files, activeFile, setFiles, updateFile, changed, safePath, showLog } from './app.js';
import * as prettier from 'prettier/standalone';
import htmlPlugin from 'prettier/plugins/html';
import babelPlugin from 'prettier/plugins/babel';
import estreePlugin from 'prettier/plugins/estree';
import cssPlugin from 'prettier/plugins/postcss';
import { parse } from 'acorn';

const templates = {
    landing: { label: 'Tanıtım sayfası', files: { 'index.html': '<!DOCTYPE html>\n<html lang="tr">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Yeni başlangıç</title></head>\n<body><main><small>HAYALDEN GERÇEĞE</small><h1>Bir sonraki fikrin burada.</h1><p>Birlikte harika şeyler üretelim.</p><button>Keşfet</button></main></body>\n</html>', 'src/style.css': 'body { margin: 0; background: #17231e; color: #ecf1e7; font-family: system-ui; padding: 12vh 10%; } h1 { font-size: clamp(2rem, 7vw, 4rem); max-width: 700px; } button { background: #a6e22e; border: 0; border-radius: 10px; padding: 14px 24px; }', 'src/script.js': 'document.querySelector("button").onclick = () => alert("Hoş geldin!");' } },
    counter: { label: 'Etkileşimli sayaç', files: { 'index.html': '<!DOCTYPE html>\n<html lang="tr"><head><meta charset="utf-8"><title>Sayaç</title></head><body><h1>Sayaç</h1><output id="count">0</output><p><button id="minus">−</button><button id="plus">+</button></p></body></html>', 'src/style.css': 'body { font-family: system-ui; text-align: center; background: #18222d; color: #fff; padding: 60px 20px; } output { font-size: 72px; } button { padding: 12px 28px; margin: 8px; cursor: pointer; }', 'src/script.js': 'let count = 0;\nconst render = () => document.getElementById("count").textContent = count;\ndocument.getElementById("plus").onclick = () => { count++; render(); };\ndocument.getElementById("minus").onclick = () => { count--; render(); };' } },
    portfolio: { label: 'Kişisel portfolyo', files: { 'index.html': '<!DOCTYPE html>\n<html lang="tr"><head><meta charset="utf-8"><title>Portfolyom</title></head><body><header><h1>Merhaba, ben bir geliştiriciyim.</h1><p>Tasarım ile kodun buluştuğu yerde.</p></header><main><h2>Projelerim</h2><article><h3>İlk projem</h3><p>Buraya projenin hikâyesini yaz.</p></article></main></body></html>', 'src/style.css': 'body { font-family: system-ui; background: #f6f3ec; color: #252e36; max-width: 900px; margin: auto; padding: 48px 24px; } header { padding-bottom: 40px; border-bottom: 1px solid #ccc; } article { background: white; padding: 24px; border-radius: 12px; }', 'src/script.js': '// Portfolyonun etkileşimlerini buraya ekle.' } }
};
const parserFor = path => ({ html: 'html', css: 'css', js: 'babel', json: 'json' })[path.split('.').pop()];
const plugins = [htmlPlugin, babelPlugin, estreePlugin, cssPlugin];

export function initTools({ ask, checkpoint, status }) {
    const add = folder => ask({ title: folder ? 'Klasör ve dosya oluştur' : 'Yeni dosya', label: 'Dosya yolu', value: folder ? 'yeni-klasor/index.html' : '', note: 'Klasörler dosya yolundan oluşturulur; örnek: src/app.js', submit: 'Oluştur', action: async path => {
        if (!safePath(path)) throw Error('Geçerli bir dosya yolu girin.');
        if (Object.hasOwn(files, path)) throw Error('Bu dosya zaten var.');
        if (Object.keys(files).length >= 200) throw Error('Dosya sınırı 200.');
        updateFile(path, '');
    } });
    $('btnAddFile').onclick = () => add(false);
    $('btnAddFolder').onclick = () => add(true);
    $('btnRenameFile').onclick = () => ask({ title: 'Dosyayı yeniden adlandır', label: 'Yeni dosya yolu', value: activeFile, note: 'HTML import ve bağlantı yollarını da güncellemeyi unutma.', submit: 'Yeniden adlandır', action: async path => {
        if (!safePath(path)) throw Error('Geçerli bir dosya yolu girin.');
        if (path === activeFile) return;
        if (Object.hasOwn(files, path)) throw Error('Bu adda bir dosya var.');
        const next = { ...files, [path]: files[activeFile] }; delete next[activeFile];
        setFiles(next, path); changed();
    } });
    $('btnFormat').onclick = async () => {
        try {
            const parser = parserFor(activeFile);
            if (!parser) throw Error('Biçimlendirme HTML, CSS, JavaScript ve JSON için kullanılabilir.');
            const path = activeFile, original = files[path];
            const formatted = await prettier.format(original, { parser, plugins, tabWidth: 2 });
            if (activeFile !== path || files[path] !== original) throw Error('Dosya değişti; tekrar biçimlendirin.');
            updateFile(path, formatted); showLog('✓ ' + path + ' biçimlendirildi.');
        } catch (error) { showLog(error.message, true); }
    };
    $('btnCheck').onclick = async () => {
        $('consolePanel').replaceChildren(); let errors = 0, checked = 0;
        for (const [path, content] of Object.entries(files)) {
            const parser = parserFor(path); if (!parser) continue; checked++;
            try {
                if (path.endsWith('.js')) parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
                else if (path.endsWith('.json')) JSON.parse(content);
                else await prettier.format(content, { parser, plugins });
                showLog('✓ ' + path + ': sözdizimi kontrolü tamamlandı.');
            } catch (error) { errors++; showLog(path + ': ' + error.message, true); }
        }
        showLog(`${checked} dosya kontrol edildi, ${errors} hata. Bu kontrol sözdizimini kapsar; mantık ve tüm HTML hatalarını garanti etmez.`);
    };
    $('btnTemplates').onclick = () => ask({ title: 'Kod şablonu seç', label: 'Şablon', options: Object.entries(templates).map(([value, t]) => [value, t.label]), note: 'Mevcut dosyalar değiştirilir. Önce otomatik bir sürüm kaydedilir.', submit: 'Şablonu uygula', action: async key => {
        await checkpoint('Şablon uygulanmadan önce');
        setFiles(templates[key].files, 'index.html'); changed(); status('Şablon uygulandı.');
    } });
}
