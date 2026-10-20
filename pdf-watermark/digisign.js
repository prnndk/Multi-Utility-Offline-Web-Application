/**
 * Certificate-based PDF digital signature (PKCS#7 detached, adbe.pkcs7.detached).
 *
 * - The signer identity is an RSA-2048 key pair with a self-signed X.509 certificate,
 *   created in the browser with Web Crypto (key) + node-forge (certificate / CMS).
 * - The private key is stored only in encrypted form (PBKDF2-SHA256 -> AES-256-GCM),
 *   unlocked by the user's passphrase. The passphrase is never stored.
 * - Signing must be the last step: it signs every byte of the PDF except the signature itself.
 *
 * Exposes window.DigiSign.
 */
(function () {
    'use strict';

    const STORE_KEY = 'mu-sign-identity';
    const SIG_BYTES = 8192;                 // room reserved for the CMS blob
    const PLACEHOLDER_NUM = 9999999999;     // 10-digit stand-in for ByteRange values
    const PBKDF2_ITER = 250000;

    const enc = new TextEncoder();
    const b64 = (u8) => { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
    const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const bytesToBin = (u8) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return s;
    };
    const binToBytes = (s) => Uint8Array.from(s, c => c.charCodeAt(0));
    const hex = (u8) => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');

    function requireForge() {
        if (typeof forge === 'undefined') throw new Error('node-forge failed to load; check your connection once, then reload.');
    }

    // ---------- Identity (key + certificate) ----------
    async function deriveKey(passphrase, salt, usage) {
        const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, usage);
    }

    function readIdentity() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
    }

    function writeIdentity(id) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(id)); return true; } catch (e) { return false; }
    }

    function deleteIdentity() {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    }

    function certFingerprint(cert) {
        const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
        const md = forge.md.sha256.create();
        md.update(der);
        return md.digest().toHex();
    }

    function describe(id) {
        if (!id) return null;
        requireForge();
        const cert = forge.pki.certificateFromPem(id.certPem);
        const cn = cert.subject.getField('CN');
        const em = cert.subject.getField('E');
        return {
            name: cn ? cn.value : '', email: em ? em.value : '',
            fingerprint: certFingerprint(cert), notAfter: cert.validity.notAfter, createdAt: id.createdAt
        };
    }

    async function createIdentity({ name, email, passphrase }) {
        requireForge();
        if (!name) throw new Error('Signer name is required.');
        if (!passphrase) throw new Error('A passphrase is required to protect your private key.');

        const pair = await crypto.subtle.generateKey(
            { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
            true, ['sign', 'verify']);
        const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));

        const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(bytesToBin(pkcs8)));
        const publicKey = forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(bytesToBin(spki)));

        const cert = forge.pki.createCertificate();
        cert.publicKey = publicKey;
        cert.serialNumber = '01' + hex(crypto.getRandomValues(new Uint8Array(15)));
        cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000);
        cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
        const attrs = [{ name: 'commonName', value: name }];
        if (email) attrs.push({ name: 'emailAddress', value: email });
        attrs.push({ name: 'organizationName', value: 'Offline Toolkit self-signed identity' });
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: false },
            { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
            { name: 'subjectKeyIdentifier' }
        ]);
        cert.sign(privateKey, forge.md.sha256.create());

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(passphrase, salt, ['encrypt']);
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8));

        const id = {
            v: 1, certPem: forge.pki.certificateToPem(cert),
            salt: b64(salt), iv: b64(iv), key: b64(sealed), iter: PBKDF2_ITER,
            createdAt: new Date().toISOString()
        };
        writeIdentity(id);
        return id;
    }

    async function unlockPrivateKey(id, passphrase) {
        requireForge();
        let pkcs8;
        try {
            const key = await (async () => {
                const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
                return crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt: unb64(id.salt), iterations: id.iter || PBKDF2_ITER, hash: 'SHA-256' },
                    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            })();
            pkcs8 = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(id.iv) }, key, unb64(id.key)));
        } catch (e) {
            throw new Error('Wrong passphrase for your signing identity.');
        }
        return forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(bytesToBin(pkcs8)));
    }

    function exportIdentityFile(id) {
        return JSON.stringify({ type: 'offline-toolkit-signing-identity', ...id }, null, 2);
    }

    function importIdentityFile(text) {
        const o = JSON.parse(text);
        if (o.type !== 'offline-toolkit-signing-identity' || !o.certPem || !o.key || !o.salt || !o.iv) {
            throw new Error('This is not a signing identity file.');
        }
        requireForge();
        forge.pki.certificateFromPem(o.certPem); // throws if corrupt
        delete o.type;
        writeIdentity(o);
        return o;
    }

    // ---------- Embedding the signature ----------
    /**
     * Adds an (invisible) signature field with a placeholder to a pdf-lib document.
     * Call before doc.save({ useObjectStreams: false }), then pass the bytes to sign().
     */
    function addPlaceholder(pdfDoc, { name, reason, contact }) {
        const L = PDFLib;
        const ctx = pdfDoc.context;

        const sigDict = ctx.obj({
            Type: 'Sig',
            Filter: 'Adobe.PPKLite',
            SubFilter: 'adbe.pkcs7.detached',
            ByteRange: [0, PLACEHOLDER_NUM, PLACEHOLDER_NUM, PLACEHOLDER_NUM],
            Contents: L.PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
            Reason: L.PDFString.of(reason || 'Issued and signed'),
            M: L.PDFString.fromDate(new Date()),
            Name: L.PDFString.of(name),
            ContactInfo: L.PDFString.of(contact || '')
        });
        const sigRef = ctx.register(sigDict);

        const page = pdfDoc.getPage(0);
        const widget = ctx.obj({
            Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: sigRef,
            T: L.PDFString.of('Signature1'), F: 132, P: page.ref
        });
        const widgetRef = ctx.register(widget);

        let annots = page.node.lookup(L.PDFName.of('Annots'));
        if (annots instanceof L.PDFArray) annots.push(widgetRef);
        else page.node.set(L.PDFName.of('Annots'), ctx.obj([widgetRef]));

        const catalog = pdfDoc.catalog;
        let form = catalog.lookup(L.PDFName.of('AcroForm'));
        if (form instanceof L.PDFDict) {
            let fields = form.lookup(L.PDFName.of('Fields'));
            if (fields instanceof L.PDFArray) fields.push(widgetRef);
            else form.set(L.PDFName.of('Fields'), ctx.obj([widgetRef]));
            form.set(L.PDFName.of('SigFlags'), L.PDFNumber.of(3));
        } else {
            catalog.set(L.PDFName.of('AcroForm'), ctx.obj({ Fields: [widgetRef], SigFlags: 3 }));
        }
    }

    function indexOfBin(hay, needle, from) {
        return hay.indexOf(needle, from || 0);
    }

    function buildCms(signedBin, cert, privateKey) {
        const p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(signedBin);
        p7.addCertificate(cert);
        p7.addSigner({
            key: privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
            authenticatedAttributes: [
                { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
                { type: forge.pki.oids.signingTime, value: new Date() },
                { type: forge.pki.oids.messageDigest }
            ]
        });
        p7.sign({ detached: true });
        return forge.asn1.toDer(p7.toAsn1()).getBytes();
    }

    /** Takes PDF bytes containing the placeholder and returns the signed PDF bytes. */
    function sign(pdfBytes, cert, privateKey) {
        requireForge();
        const bin = bytesToBin(pdfBytes);

        const brPos = indexOfBin(bin, '/ByteRange');
        const open = indexOfBin(bin, '[', brPos);
        const close = indexOfBin(bin, ']', open);
        const cPos = indexOfBin(bin, '/Contents', close);
        const lt = indexOfBin(bin, '<', cPos);
        const gt = indexOfBin(bin, '>', lt);
        if (brPos < 0 || cPos < 0 || lt < 0 || gt < 0) throw new Error('Signature placeholder not found.');
        if (gt - lt - 1 !== SIG_BYTES * 2) throw new Error('Unexpected signature placeholder size.');

        const byteRange = [0, lt, gt + 1, bin.length - (gt + 1)];
        let brText = `[${byteRange.join(' ')}`;
        const slot = close - open + 1;
        brText = brText.padEnd(slot - 1, ' ') + ']';
        if (brText.length !== slot) throw new Error('ByteRange does not fit its placeholder.');

        const out = pdfBytes.slice();
        out.set(binToBytes(brText), open);

        const signedBin = bytesToBin(out.subarray(0, lt)) + bytesToBin(out.subarray(gt + 1));
        const der = buildCms(signedBin, cert, privateKey);
        if (der.length > SIG_BYTES) throw new Error('Signature is larger than the reserved space.');

        const sigHex = forge.util.bytesToHex(der).padEnd(SIG_BYTES * 2, '0');
        out.set(binToBytes(sigHex), lt + 1);
        return out;
    }

    // ---------- Verification ----------
    /** Returns null when the PDF has no signature, else a result object. */
    function verify(pdfBytes) {
        requireForge();
        const bin = bytesToBin(pdfBytes);

        const brMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(bin);
        if (!brMatch) return null;
        const [a, b, c, d] = brMatch.slice(1).map(Number);

        // Contents hex sits in the gap [b, c)
        const gap = bin.slice(b, c);
        const hexMatch = /^<([0-9A-Fa-f\s]+)>$/.exec(gap);
        if (!hexMatch) return { status: 'invalid', reason: 'Signature container is malformed.' };

        const res = { status: 'invalid', coversWholeFile: (a === 0 && c + d === bin.length) };
        try {
            let hexStr = hexMatch[1].replace(/\s+/g, '');
            const der = forge.util.hexToBytes(hexStr);
            // CMS blob is DER-prefixed; strip trailing zero padding by parsing the first TLV only
            const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der), { strict: false, parseAllBytes: false });
            const p7 = forge.pkcs7.messageFromAsn1(asn1);

            const cert = p7.certificates && p7.certificates[0];
            if (!cert) throw new Error('No certificate in signature.');
            const cn = cert.subject.getField('CN');
            const em = cert.subject.getField('E');
            res.signer = cn ? cn.value : '(unnamed)';
            res.email = em ? em.value : '';
            res.fingerprint = certFingerprint(cert);
            res.selfSigned = cert.isIssuer(cert);

            const signedBin = bin.slice(a, a + b) + bin.slice(c, c + d);
            const md = forge.md.sha256.create();
            md.update(signedBin);
            const contentDigest = md.digest().getBytes();

            const attrs = p7.rawCapture.authenticatedAttributes;
            if (!attrs) throw new Error('Signature has no signed attributes.');

            // 1) message digest attribute must match the file contents
            let attrDigest = null;
            const parsed = p7.rawCapture.authenticatedAttributes;
            for (const attr of parsed) {
                const oid = forge.asn1.derToOid(attr.value[0].value);
                if (oid === forge.pki.oids.messageDigest) attrDigest = attr.value[1].value[0].value;
                if (oid === forge.pki.oids.signingTime) {
                    const t = attr.value[1].value[0];
                    res.signedAt = t.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(t.value) : forge.asn1.generalizedTimeToDate(t.value);
                }
            }
            res.contentOk = attrDigest === contentDigest;

            // 2) signature over the DER-encoded SET of signed attributes
            const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
            const md2 = forge.md.sha256.create();
            md2.update(forge.asn1.toDer(set).getBytes());
            res.signatureOk = cert.publicKey.verify(md2.digest().getBytes(), p7.rawCapture.signature);

            res.status = res.signatureOk && res.contentOk && res.coversWholeFile ? 'valid'
                : (res.signatureOk && (!res.contentOk || !res.coversWholeFile) ? 'modified' : 'invalid');
        } catch (err) {
            res.status = 'invalid';
            res.reason = err.message || String(err);
        }
        return res;
    }

    function certificatePem(id) { return id ? id.certPem : null; }

    window.DigiSign = {
        readIdentity, deleteIdentity, describe, createIdentity, unlockPrivateKey, exportIdentityFile,
        importIdentityFile, addPlaceholder, sign, verify, certificatePem,
        certFromPem: (pem) => { requireForge(); return forge.pki.certificateFromPem(pem); }
    };
})();
