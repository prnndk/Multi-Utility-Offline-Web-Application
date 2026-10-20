/**
 * PDF Watermark & Trace Signature
 * Client-side only. Uses pdf-lib to draw on pages, pdf.js to read text back.
 *
 * Trace token format:  MUT1.<base64url(JSON payload)>.<16 hex signature>
 *   signature = HMAC-SHA256(passphrase, payloadB64)   when a passphrase is set
 *             = SHA-256(payloadB64)                    otherwise (integrity only)
 * The token is stored in (1) the PDF Info dictionary and (2) as near-invisible
 * text on every page, so it can be recovered even if metadata is stripped.
 */

const TOKEN_RE = /MUT1\.[A-Za-z0-9_-]+\.[0-9a-f]{16}/;
const LOG_KEY = 'mu-pdf-trace-log';
const INFO_KEY = 'MUTraceToken';

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const $ = (id) => document.getElementById(id);

// ---------- Theme ----------
(function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mu-theme'); } catch (e) { /* ignore */ }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) document.documentElement.setAttribute('data-theme', 'dark');
    $('themeToggle').addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
        try { localStorage.setItem('mu-theme', dark ? 'light' : 'dark'); } catch (e) { /* ignore */ }
    });
})();

// ---------- Panes ----------
function showPane(name) {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.pane === name));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${name}`));
    if (name === 'log') renderLog();
}
document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));

// ---------- Helpers ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, c => c.charCodeAt(0));
}

const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(data) {
    return toHex(await crypto.subtle.digest('SHA-256', data));
}

async function signPayload(payloadB64, passphrase) {
    if (!passphrase) return (await sha256Hex(enc.encode(payloadB64))).slice(0, 16);
    const key = await crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64))).slice(0, 16);
}

function newTraceId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint8Array(8));
    const c = Array.from(r, b => alphabet[b % alphabet.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmtSize(n) {
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function renderKv(el, rows) {
    el.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
}

function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Drop zones ----------
function wireDrop(zone, input, onFile) {
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.remove('drag-over'); }));
    zone.addEventListener('drop', ev => { if (ev.dataTransfer.files[0]) onFile(ev.dataTransfer.files[0]); });
}

function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// ---------- Sign tab: page model ----------
// sources: [{ name, bytes, pdf (pdf.js doc), lib (pdf-lib doc, lazy) }]
// pages:   [{ src, idx, rot, wm: {mode:'global'|'custom'|'none', text} }]  or blank: { blank:true, w, h, rot, wm }
const state = {
    sources: [], pages: [], initialPages: [], sel: 0,
    traceId: '', outBytes: null, outName: '', view: null
};
let renderSeq = 0;
let rafId = 0;
const thumbCache = new Map();

const wmFields = ['wmText', 'wmFont', 'wmSize', 'wmOpacity', 'wmRotation', 'wmColor', 'wmBold', 'wmTile', 'wmSpacing', 'recipient', 'optFooter'];

function newEntry(src, idx) { return { src, idx, rot: 0, wm: { mode: 'global', text: '' } }; }
const cur = () => state.pages[state.sel];

function show(el, on) { $(el).classList.toggle('hidden', !on); }

async function loadSource(file) {
    if (!isPdf(file)) throw new Error('Please choose a PDF file.');
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js failed to load; check your connection once, then reload.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    return { name: file.name, bytes, pdf, lib: null };
}

async function openFirst(file) {
    try {
        const src = await loadSource(file);
        state.sources = [src];
        state.pages = Array.from({ length: src.pdf.numPages }, (_, i) => newEntry(0, i));
        state.initialPages = JSON.parse(JSON.stringify(state.pages));
        state.sel = 0;
        state.traceId = newTraceId();
        state.outBytes = null;
        show('dropZone', false); show('editor', true); show('signResult', false);
        showSignError('');
        refreshAll();
    } catch (err) {
        alert(`Could not open this PDF: ${err.message || err}`);
    }
}

wireDrop($('dropZone'), $('fileInput'), openFirst);

function closePdf() {
    state.sources.forEach(s => s.pdf.destroy && s.pdf.destroy());
    state.sources = []; state.pages = []; state.outBytes = null;
    thumbCache.clear();
    show('editor', false); show('dropZone', true);
}
$('removeFile').addEventListener('click', closePdf);

// ---------- Page geometry ----------
async function pageInfo(entry) {
    if (entry.blank) {
        const R = ((entry.rot % 360) + 360) % 360;
        return { VW: R % 180 ? entry.h : entry.w, VH: R % 180 ? entry.w : entry.h, R };
    }
    const page = await state.sources[entry.src].pdf.getPage(entry.idx + 1);
    const R = (((page.rotate + entry.rot) % 360) + 360) % 360;
    const vp = page.getViewport({ scale: 1, rotation: R });
    return { VW: vp.width, VH: vp.height, R, page };
}

async function renderEntry(entry, canvas, cssWidth, dpr) {
    const info = await pageInfo(entry);
    const k = cssWidth / info.VW;
    canvas.width = Math.round(info.VW * k * dpr);
    canvas.height = Math.round(info.VH * k * dpr);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!entry.blank) {
        const vp = info.page.getViewport({ scale: k * dpr, rotation: info.R });
        await info.page.render({ canvasContext: ctx, viewport: vp }).promise;
    }
    return { ...info, k };
}

// ---------- Watermark layout (shared by preview and export) ----------
function readWm() {
    const bold = $('wmBold').checked;
    const f = $('wmFont').value;
    return {
        fontKey: f === 'TimesRoman' ? (bold ? 'TimesRomanBold' : 'TimesRoman')
            : f === 'Courier' ? (bold ? 'CourierBold' : 'Courier') : (bold ? 'HelveticaBold' : 'Helvetica'),
        size: +$('wmSize').value, opacity: +$('wmOpacity').value / 100, angle: +$('wmRotation').value,
        color: $('wmColor').value, tile: $('wmTile').checked, spacing: +$('wmSpacing').value
    };
}

function expandTokens(text, pageNo, total) {
    return text
        .replace(/\{page\}/gi, pageNo).replace(/\{total\}/gi, total)
        .replace(/\{to\}/gi, $('recipient').value.trim()).replace(/\{id\}/gi, state.traceId)
        .replace(/\{date\}/gi, new Date().toISOString().slice(0, 10));
}

function pageText(entry, pageNo, total) {
    const w = entry.wm;
    const raw = w.mode === 'none' ? '' : w.mode === 'custom' ? w.text : $('wmText').value;
    return expandTokens(raw.trim(), pageNo, total);
}

// Returns centre points + angle (visual frame, origin bottom-left, y up)
function layout(text, o, VW, VH, textW) {
    if (!text) return [];
    if (!o.tile) return [{ cx: VW / 2, cy: VH / 2, a: o.angle }];
    const f = o.spacing / 100;
    const stepX = (textW + o.size * 1.5) * f;
    const stepY = o.size * 2.2 * f;
    const diag = Math.hypot(VW, VH);
    const a = o.angle * Math.PI / 180;
    const rows = Math.ceil(diag / stepY), cols = Math.ceil(diag / stepX);
    const out = [];
    for (let r = -rows; r <= rows; r++) {
        const shift = r % 2 ? stepX / 2 : 0;
        for (let c = -cols; c <= cols; c++) {
            const gx = c * stepX + shift, gy = r * stepY;
            const cx = VW / 2 + gx * Math.cos(a) - gy * Math.sin(a);
            const cy = VH / 2 + gx * Math.sin(a) + gy * Math.cos(a);
            if (cx < -textW || cx > VW + textW || cy < -textW || cy > VH + textW) continue;
            out.push({ cx, cy, a: o.angle });
        }
    }
    return out;
}

// Fonts used for measuring (same metrics as the embedded fonts at export time)
let measureDoc = null;
const measureFonts = new Map();
async function ensureMeasureFont(key) {
    if (measureFonts.has(key)) return measureFonts.get(key);
    measureDoc = measureDoc || await PDFLib.PDFDocument.create();
    const font = await measureDoc.embedFont(PDFLib.StandardFonts[key]);
    measureFonts.set(key, font);
    return font;
}

const CSS_FONTS = {
    Helvetica: 'Helvetica, Arial, sans-serif', TimesRoman: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace'
};
function cssFont(key, px) {
    const bold = /Bold$/.test(key) ? 'bold ' : '';
    const fam = key.startsWith('Times') ? 'TimesRoman' : key.startsWith('Courier') ? 'Courier' : 'Helvetica';
    return `${bold}${px}px ${CSS_FONTS[fam]}`;
}

// ---------- Live preview ----------
function footerText() {
    return `Issued to: ${$('recipient').value.trim() || '(recipient)'}  |  ID: ${state.traceId}  |  ${new Date().toISOString().slice(0, 10)}`;
}

function drawOverlay() {
    const v = state.view;
    if (!v || !cur()) return;
    const canvas = $('overlayCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const o = readWm();
    const font = measureFonts.get(o.fontKey);
    if (!font) { ensureMeasureFont(o.fontKey).then(scheduleOverlay); return; }

    const sc = v.k * v.dpr; // canvas px per pt
    const text = pageText(cur(), state.sel + 1, state.pages.length);
    if (text) {
        const w = font.widthOfTextAtSize(text, o.size);
        const h = font.heightAtSize(o.size) * 0.7;
        ctx.save();
        ctx.font = cssFont(o.fontKey, o.size * sc);
        ctx.fillStyle = o.color;
        ctx.globalAlpha = o.opacity;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        for (const p of layout(text, o, v.VW, v.VH, w)) {
            ctx.save();
            ctx.translate(p.cx * sc, (v.VH - p.cy) * sc);
            ctx.rotate(-p.a * Math.PI / 180);
            ctx.fillText(text, 0, (h / 2) * sc);
            ctx.restore();
        }
        ctx.restore();
    }
    if ($('optFooter').checked) {
        ctx.save();
        ctx.font = cssFont('Helvetica', 7 * sc);
        ctx.fillStyle = 'rgb(89,89,89)';
        ctx.globalAlpha = 0.8;
        ctx.fillText(footerText(), 20 * sc, (v.VH - 10) * sc);
        ctx.restore();
    }
}

function scheduleOverlay() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(drawOverlay);
}

async function renderPreview() {
    const entry = cur();
    if (!entry) return;
    const seq = ++renderSeq;
    const inner = $('previewInner');
    const cssW = Math.max(200, inner.clientWidth || 600);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = $('baseCanvas');
    const tmp = document.createElement('canvas');
    try {
        const info = await renderEntry(entry, tmp, cssW, dpr);
        if (seq !== renderSeq) return; // a newer render started
        base.width = tmp.width; base.height = tmp.height;
        base.getContext('2d').drawImage(tmp, 0, 0);
        const ov = $('overlayCanvas');
        ov.width = tmp.width; ov.height = tmp.height;
        state.view = { VW: info.VW, VH: info.VH, k: info.k, dpr, R: info.R };
        drawOverlay();
    } catch (err) {
        console.error(err);
    }
}

// ---------- Page strip ----------
function thumbKey(e) { return e.blank ? `blank:${e.w}x${e.h}:${e.rot}` : `${e.src}:${e.idx}:${e.rot}`; }

async function thumbURL(entry) {
    const key = thumbKey(entry);
    if (thumbCache.has(key)) return thumbCache.get(key);
    const c = document.createElement('canvas');
    await renderEntry(entry, c, 96, 1.5);
    const url = c.toDataURL('image/jpeg', 0.7);
    thumbCache.set(key, url);
    return url;
}

// Update labels in place (never rebuild the strip while the user is mid-click)
function updateTags() {
    Array.from($('pageStrip').children).forEach((el, i) => {
        const entry = state.pages[i];
        if (!entry) return;
        const marks = [entry.blank ? 'blank' : null, entry.wm.mode === 'custom' ? 'custom' : entry.wm.mode === 'none' ? 'no wm' : null].filter(Boolean);
        el.querySelector('.tag').textContent = `${i + 1}${marks.length ? ' · ' + marks.join(', ') : ''}`;
    });
}

let dragFrom = -1;
function renderStrip() {
    const strip = $('pageStrip');
    strip.innerHTML = '';
    state.pages.forEach((entry, i) => {
        const el = document.createElement('div');
        el.className = 'thumb' + (i === state.sel ? ' selected' : '');
        el.draggable = true;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `Page ${i + 1}`);
        el.tabIndex = 0;
        el.innerHTML = '<img alt=""><span class="tag"></span>';
        thumbURL(entry).then(url => { el.querySelector('img').src = url; });

        el.addEventListener('click', () => select(i));
        el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(i); } });
        el.addEventListener('dragstart', ev => { dragFrom = i; el.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(i)); });
        el.addEventListener('dragend', () => { dragFrom = -1; el.classList.remove('dragging'); });
        el.addEventListener('dragover', ev => { if (dragFrom >= 0) { ev.preventDefault(); el.classList.add('drop-target'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', ev => {
            ev.preventDefault(); el.classList.remove('drop-target');
            if (dragFrom >= 0 && dragFrom !== i) movePage(dragFrom, i);
        });
        strip.appendChild(el);
    });
    updateTags();
    const selEl = strip.children[state.sel];
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function syncPagePanel() {
    const n = state.pages.length;
    $('pageLabel').textContent = `Page ${state.sel + 1} / ${n}`;
    $('pagesTitle').textContent = `Pages (${n})`;
    $('prevPage').disabled = state.sel <= 0;
    $('nextPage').disabled = state.sel >= n - 1;
    $('moveLeft').disabled = state.sel <= 0;
    $('moveRight').disabled = state.sel >= n - 1;
    $('delPage').disabled = n <= 1;
    const w = cur().wm;
    $('pageWmMode').value = w.mode;
    $('pageWmText').value = w.text;
    show('pageWmTextGroup', w.mode === 'custom');
}

function refreshAll() {
    syncPagePanel();
    renderStrip();
    renderPreview();
}

function select(i) {
    if (i < 0 || i >= state.pages.length || i === state.sel) return;
    state.sel = i;
    state.outBytes = null; show('signResult', false);
    refreshAll();
}

// ---------- Page operations ----------
function structural() { state.outBytes = null; show('signResult', false); refreshAll(); }

function movePage(from, to) {
    const [e] = state.pages.splice(from, 1);
    state.pages.splice(to, 0, e);
    state.sel = to;
    structural();
}

$('prevPage').addEventListener('click', () => select(state.sel - 1));
$('nextPage').addEventListener('click', () => select(state.sel + 1));
$('moveLeft').addEventListener('click', () => { if (state.sel > 0) movePage(state.sel, state.sel - 1); });
$('moveRight').addEventListener('click', () => { if (state.sel < state.pages.length - 1) movePage(state.sel, state.sel + 1); });
$('rotatePage').addEventListener('click', () => { cur().rot = (cur().rot + 90) % 360; structural(); });
$('dupPage').addEventListener('click', () => {
    state.pages.splice(state.sel + 1, 0, JSON.parse(JSON.stringify(cur())));
    state.sel += 1; structural();
});
$('delPage').addEventListener('click', () => {
    if (state.pages.length <= 1) return;
    state.pages.splice(state.sel, 1);
    state.sel = Math.min(state.sel, state.pages.length - 1);
    structural();
});
$('reversePages').addEventListener('click', () => {
    state.pages.reverse(); state.sel = state.pages.length - 1 - state.sel; structural();
});
$('resetPages').addEventListener('click', () => {
    if (!confirm('Restore the original page order and remove added pages, rotations and per-page text?')) return;
    state.pages = JSON.parse(JSON.stringify(state.initialPages)); state.sel = 0; structural();
});
$('addBlank').addEventListener('click', async () => {
    let w = 595, h = 842;
    try {
        const e = cur();
        if (e.blank) { w = e.w; h = e.h; } else {
            const p = await state.sources[e.src].pdf.getPage(e.idx + 1);
            const vp = p.getViewport({ scale: 1, rotation: p.rotate });
            w = vp.width; h = vp.height;
        }
    } catch (err) { /* A4 fallback */ }
    state.pages.splice(state.sel + 1, 0, { blank: true, w, h, rot: 0, wm: { mode: 'global', text: '' } });
    state.sel += 1; structural();
});
$('addPdf').addEventListener('click', () => $('addPdfInput').click());
$('addPdfInput').addEventListener('change', async () => {
    const files = Array.from($('addPdfInput').files);
    $('addPdfInput').value = '';
    for (const f of files) {
        try {
            const src = await loadSource(f);
            state.sources.push(src);
            const si = state.sources.length - 1;
            for (let i = 0; i < src.pdf.numPages; i++) state.pages.push(newEntry(si, i));
        } catch (err) { alert(`${f.name}: ${err.message || err}`); }
    }
    structural();
});

// ---------- Settings wiring ----------
[['wmSize', 'wmSizeVal', v => `${v} pt`], ['wmOpacity', 'wmOpacityVal', v => `${v}%`],
 ['wmRotation', 'wmRotationVal', v => `${v}°`], ['wmSpacing', 'wmSpacingVal', v => `${v}%`]]
    .forEach(([inp, out, f]) => $(inp).addEventListener('input', () => { $(out).textContent = f($(inp).value); }));
$('wmTile').addEventListener('change', () => show('wmSpacingGroup', $('wmTile').checked));

wmFields.forEach(id => {
    const ev = ['wmText', 'recipient'].includes(id) || $(id).type === 'range' || $(id).type === 'color' ? 'input' : 'change';
    $(id).addEventListener(ev, () => { state.outBytes = null; show('signResult', false); scheduleOverlay(); });
});

$('pageWmMode').addEventListener('change', () => {
    cur().wm.mode = $('pageWmMode').value;
    show('pageWmTextGroup', cur().wm.mode === 'custom');
    if (cur().wm.mode === 'custom' && !cur().wm.text) { cur().wm.text = $('wmText').value; $('pageWmText').value = cur().wm.text; }
    updateTags(); scheduleOverlay();
});
$('pageWmText').addEventListener('input', () => { cur().wm.text = $('pageWmText').value; scheduleOverlay(); });

window.addEventListener('resize', () => { if (state.pages.length && $('pane-sign').classList.contains('active')) renderPreview(); });
document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.pane === 'sign' && state.pages.length) setTimeout(renderPreview, 0);
}));

// ---------- Export ----------
function showSignError(msg) {
    const el = $('signError');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

// Visual frame (origin bottom-left, as shown) -> PDF user space for a page displayed with rotation R
function toUser(vx, vy, R, UW, UH) {
    switch (R) {
        case 90: return { x: UW - vy, y: vx };
        case 180: return { x: UW - vx, y: UH - vy };
        case 270: return { x: vy, y: UH - vx };
        default: return { x: vx, y: vy };
    }
}

function drawVisual(page, text, vx, vy, aVisual, R, UW, UH, opts) {
    const u = toUser(vx, vy, R, UW, UH);
    page.drawText(text, { ...opts, x: u.x, y: u.y, rotate: PDFLib.degrees(aVisual + R) });
}

async function sha256OfSources() {
    const hashes = [];
    for (const s of state.sources) hashes.push(await sha256Hex(s.bytes));
    return hashes.length === 1 ? hashes[0] : await sha256Hex(enc.encode(hashes.join(',')));
}

$('signBtn').addEventListener('click', async () => {
    showSignError('');
    const recipient = $('recipient').value.trim();
    if (!recipient) { showSignError('Enter who this PDF is issued to, so it can be traced later.'); $('recipient').focus(); return; }
    if (!state.pages.length) return;

    const btn = $('signBtn');
    btn.disabled = true; btn.textContent = 'Working...';
    try {
        const { PDFDocument, StandardFonts, PDFName, PDFString, degrees, rgb } = PDFLib;
        const out = await PDFDocument.create();

        for (const s of state.sources) {
            if (!s.lib) s.lib = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
        }

        const id = state.traceId;
        const passphrase = $('passphrase').value;
        const payload = {
            v: 1, id, to: recipient, note: $('purpose').value.trim(),
            doc: state.sources.map(s => s.name).join(' + '), ts: new Date().toISOString(),
            src: (await sha256OfSources()).slice(0, 16), n: state.pages.length, k: passphrase ? 1 : 0
        };
        const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
        const token = `MUT1.${payloadB64}.${await signPayload(payloadB64, passphrase)}`;

        const o = readWm();
        const wmFont = await out.embedFont(StandardFonts[o.fontKey]);
        const smallFont = await out.embedFont(StandardFonts.Helvetica);
        const color = hexToRgb(o.color);
        const total = state.pages.length;

        for (let i = 0; i < total; i++) {
            const e = state.pages[i];
            let page;
            if (e.blank) {
                page = out.addPage([e.w, e.h]);
            } else {
                const [cp] = await out.copyPages(state.sources[e.src].lib, [e.idx]);
                page = out.addPage(cp);
            }
            const R = (((page.getRotation().angle + e.rot) % 360) + 360) % 360;
            page.setRotation(degrees(R));
            const { width: UW, height: UH } = page.getSize();
            const VW = R % 180 ? UH : UW, VH = R % 180 ? UW : UH;

            const text = pageText(e, i + 1, total);
            if (text) {
                const w = wmFont.widthOfTextAtSize(text, o.size);
                const h = wmFont.heightAtSize(o.size) * 0.7;
                for (const p of layout(text, o, VW, VH, w)) {
                    const a = p.a * Math.PI / 180;
                    const x0 = p.cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
                    const y0 = p.cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
                    drawVisual(page, text, x0, y0, p.a, R, UW, UH, { size: o.size, font: wmFont, color, opacity: o.opacity });
                }
            }
            if ($('optFooter').checked) {
                const f = `Issued to: ${recipient}  |  ID: ${id}  |  ${payload.ts.slice(0, 10)}`;
                drawVisual(page, f, 20, 10, 0, R, UW, UH, { size: 7, font: smallFont, color: rgb(0.35, 0.35, 0.35), opacity: 0.8 });
            }
            if ($('optHidden').checked) {
                // Real, extractable text but practically invisible; survives metadata stripping
                drawVisual(page, token, 4, 2, 0, R, UW, UH, { size: 1, font: smallFont, color: rgb(0, 0, 0), opacity: 0.01 });
            }
        }

        const info = out.getInfoDict();
        info.set(PDFName.of(INFO_KEY), PDFString.of(token));
        info.set(PDFName.of('MUTraceID'), PDFString.of(id));
        out.setSubject(`Issued to ${recipient} (${id})`);
        out.setProducer('Offline Toolkit');
        out.setModificationDate(new Date());

        state.outBytes = await out.save();
        const base = state.sources[0].name.replace(/\.pdf$/i, '');
        state.outName = `${base}_${id}.pdf`;

        addLog({ id, to: recipient, note: payload.note, doc: payload.doc, ts: payload.ts, src: payload.src, signed: passphrase ? 'HMAC' : 'checksum' });

        const custom = state.pages.filter(p => p.wm.mode !== 'global').length;
        renderKv($('signSummary'), [
            ['Issued to', esc(recipient)],
            ['Trace ID', `<code>${esc(id)}</code>`],
            ['Pages', `${total}${custom ? ` (${custom} with page-specific watermark)` : ''}`],
            ['Signature', passphrase ? 'HMAC (passphrase protected)' : '<span class="status-warn">Checksum only (no passphrase)</span>'],
            ['Stored in', ['PDF metadata', $('optHidden').checked ? 'hidden text on every page' : null, $('optFooter').checked ? 'visible footer' : null].filter(Boolean).join(', ')],
            ['Output', `${esc(state.outName)} (${fmtSize(state.outBytes.length)})`]
        ]);
        show('signResult', true);
        $('signResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Next export is a new issuance: fresh ID (preview updates too)
        state.traceId = newTraceId();
        scheduleOverlay();
        state.lastId = id;
    } catch (err) {
        console.error(err);
        showSignError(`Could not process this PDF: ${err.message || err}. If the text contains non-Latin characters, the built-in PDF fonts cannot draw them.`);
    } finally {
        btn.disabled = false; btn.textContent = 'Assemble, Watermark & Sign';
    }
});

$('downloadBtn').addEventListener('click', () => { if (state.outBytes) download(state.outBytes, state.outName); });

// ---------- Verify tab ----------
async function extractToken(bytes) {
    // 1) Info dictionary
    try {
        const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        const v = doc.getInfoDict().get(PDFLib.PDFName.of(INFO_KEY));
        const s = v && typeof v.decodeText === 'function' ? v.decodeText() : null;
        if (s && TOKEN_RE.test(s)) return { token: s.match(TOKEN_RE)[0], where: 'PDF metadata' };
    } catch (e) { /* fall through to text */ }

    // 2) Hidden page text
    if (typeof pdfjsLib === 'undefined') return null;
    const task = pdfjsLib.getDocument({ data: bytes.slice() });
    const pdf = await task.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(it => it.str).join('');
        const m = text.match(TOKEN_RE);
        if (m) return { token: m[0], where: `hidden text on page ${i}` };
    }
    return null;
}

async function verifyToken(token, passphrase) {
    const [, payloadB64, sig] = token.split('.');
    let payload;
    try { payload = JSON.parse(dec.decode(unb64url(payloadB64))); } catch (e) { return { status: 'bad' }; }
    const expected = await signPayload(payloadB64, payload.k ? passphrase : '');
    if (payload.k && !passphrase) return { status: 'needs-pass', payload };
    return { status: expected === sig ? (payload.k ? 'valid' : 'checksum') : 'bad', payload };
}

let lastVerifyBytes = null;

async function runVerify(bytes) {
    $('verifyResult').classList.remove('hidden');
    $('verifyTitle').textContent = 'Reading...';
    $('verifySummary').innerHTML = '';
    try {
        const found = await extractToken(bytes);
        if (!found) {
            $('verifyTitle').textContent = 'No signature found';
            renderKv($('verifySummary'), [['Status', '<span class="status-bad">No trace signature in this file</span>'],
                ['Note', 'It may never have been signed, or it was re-created (print-to-PDF, screenshot, OCR) which removes hidden data.']]);
            return;
        }
        const res = await verifyToken(found.token, $('verifyPass').value);
        const p = res.payload;
        if (!p) {
            $('verifyTitle').textContent = 'Signature unreadable';
            renderKv($('verifySummary'), [['Status', '<span class="status-bad">Signature is corrupted</span>']]);
            return;
        }
        const statusHtml = {
            valid: '<span class="status-ok">Authentic: signature matches your passphrase</span>',
            checksum: '<span class="status-warn">Intact, but unprotected (signed without a passphrase, so it could have been forged)</span>',
            'needs-pass': '<span class="status-warn">Enter the signing passphrase above, then drop the file again, to confirm authenticity</span>',
            bad: '<span class="status-bad">Signature does NOT match: wrong passphrase or the signature was edited</span>'
        }[res.status];
        const logged = readLog().find(e => e.id === p.id);
        $('verifyTitle').textContent = res.status === 'bad' ? 'Verification failed' : 'Signature found';
        renderKv($('verifySummary'), [
            ['Status', statusHtml],
            ['Issued to', esc(p.to || '-')],
            ['Trace ID', `<code>${esc(p.id)}</code>`],
            ['Issued at', esc(p.ts || '-')],
            ['Original file', esc(p.doc || '-')],
            ['Note', esc(p.note || '-')],
            ['Found in', esc(found.where)],
            ['In this browser\'s log', logged ? '<span class="status-ok">Yes</span>' : 'No (may have been issued from another device)']
        ]);
    } catch (err) {
        console.error(err);
        $('verifyTitle').textContent = 'Could not read PDF';
        renderKv($('verifySummary'), [['Error', esc(err.message || err)]]);
    }
}

wireDrop($('verifyDrop'), $('verifyInput'), async (file) => {
    if (!isPdf(file)) { alert('Please choose a PDF file.'); return; }
    lastVerifyBytes = new Uint8Array(await file.arrayBuffer());
    runVerify(lastVerifyBytes);
});
$('verifyPass').addEventListener('change', () => { if (lastVerifyBytes) runVerify(lastVerifyBytes); });

// ---------- Issue log ----------
function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { return []; }
}
function writeLog(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
}
function addLog(entry) { writeLog([entry, ...readLog()].slice(0, 1000)); }

function renderLog() {
    const list = readLog();
    $('logEmpty').classList.toggle('hidden', list.length > 0);
    $('logTable').innerHTML = list.length
        ? '<tr><th>ID</th><th>Issued to</th><th>File</th><th>Date</th><th>Sig</th></tr>' +
        list.map(e => `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.to)}</td><td>${esc(e.doc)}</td><td>${esc(e.ts.slice(0, 10))}</td><td>${esc(e.signed)}</td></tr>`).join('')
        : '';
}

$('exportLog').addEventListener('click', () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['id,issued_to,note,file,issued_at,source_sha256_16,signature']
        .concat(readLog().map(e => [e.id, e.to, e.note, e.doc, e.ts, e.src, e.signed].map(q).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'pdf-issue-log.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('clearLog').addEventListener('click', () => {
    if (confirm('Delete the whole issue log from this browser?')) { writeLog([]); renderLog(); }
});
