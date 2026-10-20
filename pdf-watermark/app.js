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
const state = { bytes: null, name: '', outBytes: null, outName: '' };

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

// ---------- Sign tab ----------
wireDrop($('dropZone'), $('fileInput'), async (file) => {
    if (!isPdf(file)) { alert('Please choose a PDF file.'); return; }
    state.bytes = new Uint8Array(await file.arrayBuffer());
    state.name = file.name;
    $('fileName').textContent = file.name;
    $('fileMeta').textContent = fmtSize(file.size);
    $('dropZone').classList.add('hidden');
    $('fileInfo').classList.remove('hidden');
    $('settingsPanel').classList.remove('hidden');
    $('signResult').classList.add('hidden');
});

function resetSign() {
    state.bytes = null; state.outBytes = null;
    $('dropZone').classList.remove('hidden');
    ['fileInfo', 'settingsPanel', 'signResult'].forEach(id => $(id).classList.add('hidden'));
}
$('removeFile').addEventListener('click', resetSign);
$('newBtn').addEventListener('click', resetSign);

[['wmSize', 'wmSizeVal', v => `${v} pt`], ['wmOpacity', 'wmOpacityVal', v => `${v}%`],
 ['wmRotation', 'wmRotationVal', v => `${v}°`], ['wmSpacing', 'wmSpacingVal', v => `${v}%`]]
    .forEach(([inp, out, f]) => $(inp).addEventListener('input', () => { $(out).textContent = f($(inp).value); }));
$('wmTile').addEventListener('change', () => $('wmSpacingGroup').classList.toggle('hidden', !$('wmTile').checked));

// Draw text centred on (cx, cy), rotated by angleDeg around its own centre
function drawCentered(page, text, cx, cy, angleDeg, opts) {
    const { font, size } = opts;
    const w = font.widthOfTextAtSize(text, size);
    const h = font.heightAtSize(size) * 0.7;
    const a = angleDeg * Math.PI / 180;
    const x = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
    const y = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
    page.drawText(text, { x, y, size, font, color: opts.color, opacity: opts.opacity, rotate: PDFLib.degrees(angleDeg) });
}

function applyWatermark(page, text, o) {
    const { width, height } = page.getSize();
    const textW = o.font.widthOfTextAtSize(text, o.size);
    if (!o.tile) {
        drawCentered(page, text, width / 2, height / 2, o.angle, o);
        return;
    }
    const f = o.spacing / 100;
    const stepX = (textW + o.size * 1.5) * f;
    const stepY = o.size * 2.2 * f;
    const diag = Math.hypot(width, height);
    const a = o.angle * Math.PI / 180;
    const rows = Math.ceil(diag / stepY);
    const cols = Math.ceil(diag / stepX);
    for (let r = -rows; r <= rows; r++) {
        const shift = r % 2 ? stepX / 2 : 0;
        for (let c = -cols; c <= cols; c++) {
            const gx = c * stepX + shift;
            const gy = r * stepY;
            const cx = width / 2 + gx * Math.cos(a) - gy * Math.sin(a);
            const cy = height / 2 + gx * Math.sin(a) + gy * Math.cos(a);
            // skip tiles whose centre is well outside the page
            if (cx < -textW || cx > width + textW || cy < -textW || cy > height + textW) continue;
            drawCentered(page, text, cx, cy, o.angle, o);
        }
    }
}

function showSignError(msg) {
    const el = $('signError');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

$('signBtn').addEventListener('click', async () => {
    showSignError('');
    const recipient = $('recipient').value.trim();
    if (!recipient) { showSignError('Enter who this PDF is issued to, so it can be traced later.'); $('recipient').focus(); return; }
    if (!state.bytes) return;

    const btn = $('signBtn');
    btn.disabled = true; btn.textContent = 'Working...';
    try {
        const { PDFDocument, StandardFonts, PDFName, PDFString } = PDFLib;
        const pdf = await PDFDocument.load(state.bytes, { ignoreEncryption: true });

        const id = newTraceId();
        const passphrase = $('passphrase').value;
        const payload = {
            v: 1, id, to: recipient, note: $('purpose').value.trim(),
            doc: state.name, ts: new Date().toISOString(),
            src: (await sha256Hex(state.bytes)).slice(0, 16), k: passphrase ? 1 : 0
        };
        const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
        const token = `MUT1.${payloadB64}.${await signPayload(payloadB64, passphrase)}`;

        const bold = $('wmBold').checked;
        const fontName = $('wmFont').value;
        const key = fontName === 'TimesRoman' ? (bold ? 'TimesRomanBold' : 'TimesRoman')
            : fontName === 'Courier' ? (bold ? 'CourierBold' : 'Courier')
                : (bold ? 'HelveticaBold' : 'Helvetica');
        const wmFont = await pdf.embedFont(StandardFonts[key]);
        const smallFont = await pdf.embedFont(StandardFonts.Helvetica);

        const wmText = $('wmText').value.trim();
        const wmOpts = {
            font: wmFont, size: +$('wmSize').value, opacity: +$('wmOpacity').value / 100,
            angle: +$('wmRotation').value, color: hexToRgb($('wmColor').value),
            tile: $('wmTile').checked, spacing: +$('wmSpacing').value
        };
        const footer = `Issued to: ${recipient}  |  ID: ${id}  |  ${payload.ts.slice(0, 10)}`;

        pdf.getPages().forEach(page => {
            if (wmText) applyWatermark(page, wmText, wmOpts);
            if ($('optFooter').checked) {
                page.drawText(footer, { x: 20, y: 10, size: 7, font: smallFont, color: PDFLib.rgb(0.35, 0.35, 0.35), opacity: 0.8 });
            }
            if ($('optHidden').checked) {
                // Real, extractable text but practically invisible; survives metadata stripping
                page.drawText(token, { x: 4, y: 2, size: 1, font: smallFont, color: PDFLib.rgb(0, 0, 0), opacity: 0.01 });
            }
        });

        const info = pdf.getInfoDict();
        info.set(PDFName.of(INFO_KEY), PDFString.of(token));
        info.set(PDFName.of('MUTraceID'), PDFString.of(id));
        pdf.setSubject(`Issued to ${recipient} (${id})`);
        pdf.setModificationDate(new Date());

        state.outBytes = await pdf.save();
        state.outName = state.name.replace(/\.pdf$/i, '') + `_${id}.pdf`;

        addLog({ id, to: recipient, note: payload.note, doc: state.name, ts: payload.ts, src: payload.src, signed: passphrase ? 'HMAC' : 'checksum' });

        renderKv($('signSummary'), [
            ['Issued to', esc(recipient)],
            ['Trace ID', `<code>${esc(id)}</code>`],
            ['Signature', passphrase ? 'HMAC (passphrase protected)' : '<span class="status-warn">Checksum only (no passphrase)</span>'],
            ['Stored in', ['PDF metadata', $('optHidden').checked ? 'hidden text on every page' : null, $('optFooter').checked ? 'visible footer' : null].filter(Boolean).join(', ')],
            ['Output', `${esc(state.outName)} (${fmtSize(state.outBytes.length)})`]
        ]);
        $('signResult').classList.remove('hidden');
        $('signResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
        console.error(err);
        showSignError(`Could not process this PDF: ${err.message || err}. If the text contains non-Latin characters, the built-in PDF fonts cannot draw them.`);
    } finally {
        btn.disabled = false; btn.textContent = 'Watermark & Sign PDF';
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
