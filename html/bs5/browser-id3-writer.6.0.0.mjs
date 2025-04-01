function e(e) {
    return String(e).split("").map((e => e.charCodeAt(0)))
}

function t(t) {
    return new Uint8Array(e(t))
}

function a(t) {
    const a = new ArrayBuffer(2 * t.length), r = new Uint8Array(a);
    return new Uint16Array(a).set(e(t)), r
}

function r(e) {
    const t = 255;
    return [e >>> 24 & t, e >>> 16 & t, e >>> 8 & t, e & t]
}

function n(e) {
    return 11 + e
}

function s(e, t, a, r) {
    return 11 + t + 1 + 1 + (r ? 2 + 2 * (a + 1) : a + 1) + e
}

function i(e) {
    let t = 0;
    return e.forEach((e => {
        t += 2 + 2 * e[0].length + 2 + 2 + 2 * e[1].length + 2
    })), 11 + t
}

function c(e, t) {
    const a = 2 * t;
    let r = 0;
    return e.forEach((e => {
        r += 2 + 2 * e[0].length + 2 + 4
    })), 18 + a + 2 + r
}

class ID3Writer {
    _setIntegerFrame(e, t) {
        const a = parseInt(t, 10);
        this.frames.push({name: e, value: a, size: n(a.toString().length)})
    }

    _setStringFrame(e, t) {
        const a = t.toString();
        let r = 13 + 2 * a.length;
        "TDAT" === e && (r = n(a.length)), this.frames.push({name: e, value: a, size: r})
    }

    _setPictureFrame(e, t, a, r) {
        const n = function (e) {
            if (!e || !e.length) return null;
            if (255 === e[0] && 216 === e[1] && 255 === e[2]) return "image/jpeg";
            if (137 === e[0] && 80 === e[1] && 78 === e[2] && 71 === e[3]) return "image/png";
            if (71 === e[0] && 73 === e[1] && 70 === e[2]) return "image/gif";
            if (87 === e[8] && 69 === e[9] && 66 === e[10] && 80 === e[11]) return "image/webp";
            const t = 73 === e[0] && 73 === e[1] && 42 === e[2] && 0 === e[3],
                a = 77 === e[0] && 77 === e[1] && 0 === e[2] && 42 === e[3];
            return t || a ? "image/tiff" : 66 === e[0] && 77 === e[1] ? "image/bmp" : 0 === e[0] && 0 === e[1] && 1 === e[2] && 0 === e[3] ? "image/x-icon" : null
        }(new Uint8Array(t)), i = a.toString();
        if (!n) throw new Error("Unknown picture MIME type");
        a || (r = !1), this.frames.push({
            name: "APIC",
            value: t,
            pictureType: e,
            mimeType: n,
            useUnicodeEncoding: r,
            description: i,
            size: s(t.byteLength, n.length, i.length, r)
        })
    }

    _setLyricsFrame(e, t, a) {
        const r = e.split("").map((e => e.charCodeAt(0))), n = t.toString(), s = a.toString();
        var i, c;
        this.frames.push({
            name: "USLT",
            value: s,
            language: r,
            description: n,
            size: (i = n.length, c = s.length, 16 + 2 * i + 2 + 2 + 2 * c)
        })
    }

    _setCommentFrame(e, t, a) {
        const r = e.split("").map((e => e.charCodeAt(0))), n = t.toString(), s = a.toString();
        var i, c;
        this.frames.push({
            name: "COMM",
            value: s,
            language: r,
            description: n,
            size: (i = n.length, c = s.length, 16 + 2 * i + 2 + 2 + 2 * c)
        })
    }

    _setPrivateFrame(e, t) {
        const a = e.toString();
        var r, n;
        this.frames.push({name: "PRIV", value: t, id: a, size: (r = a.length, n = t.byteLength, 10 + r + 1 + n)})
    }

    _setUserStringFrame(e, t) {
        const a = e.toString(), r = t.toString();
        var n, s;
        this.frames.push({
            name: "TXXX",
            description: a,
            value: r,
            size: (n = a.length, s = r.length, 13 + 2 * n + 2 + 2 + 2 * s)
        })
    }

    _setUrlLinkFrame(e, t) {
        const a = t.toString();
        var r;
        this.frames.push({name: e, value: a, size: (r = a.length, 10 + r)})
    }

    _setPairedTextFrame(e, t) {
        this.frames.push({name: e, value: t, size: i(t)})
    }

    _setSynchronisedLyricsFrame(e, t, a, r, n) {
        const s = n.toString(), i = r.split("").map((e => e.charCodeAt(0)));
        this.frames.push({
            name: "SYLT",
            value: t,
            language: i,
            description: s,
            type: e,
            timestampFormat: a,
            size: c(t, s.length)
        })
    }

    constructor(e) {
        if (!e || "object" != typeof e || !("byteLength" in e)) throw new Error("First argument should be an instance of ArrayBuffer or Buffer");
        this.arrayBuffer = e, this.padding = 4096, this.frames = [], this.url = ""
    }

    setFrame(e, t) {
        switch (e) {
            case"TPE1":
            case"TCOM":
            case"TCON": {
                if (!Array.isArray(t)) throw new Error(`${e} frame value should be an array of strings`);
                const a = "TCON" === e ? ";" : "/", r = t.join(a);
                this._setStringFrame(e, r);
                break
            }
            case"TLAN":
            case"TIT1":
            case"TIT2":
            case"TIT3":
            case"TALB":
            case"TPE2":
            case"TPE3":
            case"TPE4":
            case"TRCK":
            case"TPOS":
            case"TMED":
            case"TPUB":
            case"TCOP":
            case"TKEY":
            case"TEXT":
            case"TDAT":
            case"TSRC":
                this._setStringFrame(e, t);
                break;
            case"TBPM":
            case"TLEN":
            case"TYER":
                this._setIntegerFrame(e, t);
                break;
            case"USLT":
                if (t.language = t.language || "eng", "object" != typeof t || !("description" in t) || !("lyrics" in t)) throw new Error("USLT frame value should be an object with keys description and lyrics");
                if (t.language && !t.language.match(/[a-z]{3}/i)) throw new Error("Language must be coded following the ISO 639-2 standards");
                this._setLyricsFrame(t.language, t.description, t.lyrics);
                break;
            case"APIC":
                if ("object" != typeof t || !("type" in t) || !("data" in t) || !("description" in t)) throw new Error("APIC frame value should be an object with keys type, data and description");
                if (t.type < 0 || t.type > 20) throw new Error("Incorrect APIC frame picture type");
                this._setPictureFrame(t.type, t.data, t.description, !!t.useUnicodeEncoding);
                break;
            case"TXXX":
                if ("object" != typeof t || !("description" in t) || !("value" in t)) throw new Error("TXXX frame value should be an object with keys description and value");
                this._setUserStringFrame(t.description, t.value);
                break;
            case"WCOM":
            case"WCOP":
            case"WOAF":
            case"WOAR":
            case"WOAS":
            case"WORS":
            case"WPAY":
            case"WPUB":
                this._setUrlLinkFrame(e, t);
                break;
            case"COMM":
                if (t.language = t.language || "eng", "object" != typeof t || !("description" in t) || !("text" in t)) throw new Error("COMM frame value should be an object with keys description and text");
                if (t.language && !t.language.match(/[a-z]{3}/i)) throw new Error("Language must be coded following the ISO 639-2 standards");
                this._setCommentFrame(t.language, t.description, t.text);
                break;
            case"PRIV":
                if ("object" != typeof t || !("id" in t) || !("data" in t)) throw new Error("PRIV frame value should be an object with keys id and data");
                this._setPrivateFrame(t.id, t.data);
                break;
            case"IPLS":
                if (!Array.isArray(t) || !Array.isArray(t[0])) throw new Error("IPLS frame value should be an array of pairs");
                this._setPairedTextFrame(e, t);
                break;
            case"SYLT":
                if ("object" != typeof t || !("type" in t) || !("text" in t) || !("timestampFormat" in t)) throw new Error("SYLT frame value should be an object with keys type, text and timestampFormat");
                if (!Array.isArray(t.text) || !Array.isArray(t.text[0])) throw new Error("SYLT frame text value should be an array of pairs");
                if (t.type < 0 || t.type > 6) throw new Error("Incorrect SYLT frame content type");
                if (t.timestampFormat < 1 || t.timestampFormat > 2) throw new Error("Incorrect SYLT frame time stamp format");
                t.language = t.language || "eng", t.description = t.description || "", this._setSynchronisedLyricsFrame(t.type, t.text, t.timestampFormat, t.language, t.description);
                break;
            default:
                throw new Error(`Unsupported frame ${e}`)
        }
        return this
    }

    removeTag() {
        if (this.arrayBuffer.byteLength < 10) return;
        const e = new Uint8Array(this.arrayBuffer), t = e[3],
            a = ((r = [e[6], e[7], e[8], e[9]])[0] << 21) + (r[1] << 14) + (r[2] << 7) + r[3] + 10;
        var r, n;
        73 !== (n = e)[0] || 68 !== n[1] || 51 !== n[2] || t < 2 || t > 4 || (this.arrayBuffer = new Uint8Array(e.subarray(a)).buffer)
    }

    addTag() {
        this.removeTag();
        const e = [255, 254], n = 10 + this.frames.reduce(((e, t) => e + t.size), 0) + this.padding,
            s = new ArrayBuffer(this.arrayBuffer.byteLength + n), i = new Uint8Array(s);
        let c = 0, o = [];
        return o = [73, 68, 51, 3], i.set(o, c), c += o.length, c++, c++, o = function (e) {
            const t = 127;
            return [e >>> 21 & t, e >>> 14 & t, e >>> 7 & t, e & t]
        }(n - 10), i.set(o, c), c += o.length, this.frames.forEach((n => {
            switch (o = t(n.name), i.set(o, c), c += o.length, o = r(n.size - 10), i.set(o, c), c += o.length, c += 2, n.name) {
                case"WCOM":
                case"WCOP":
                case"WOAF":
                case"WOAR":
                case"WOAS":
                case"WORS":
                case"WPAY":
                case"WPUB":
                    o = t(n.value), i.set(o, c), c += o.length;
                    break;
                case"TPE1":
                case"TCOM":
                case"TCON":
                case"TLAN":
                case"TIT1":
                case"TIT2":
                case"TIT3":
                case"TALB":
                case"TPE2":
                case"TPE3":
                case"TPE4":
                case"TRCK":
                case"TPOS":
                case"TKEY":
                case"TMED":
                case"TPUB":
                case"TCOP":
                case"TEXT":
                case"TSRC":
                    o = [1].concat(e), i.set(o, c), c += o.length, o = a(n.value), i.set(o, c), c += o.length;
                    break;
                case"TXXX":
                case"USLT":
                case"COMM":
                    o = [1], "USLT" !== n.name && "COMM" !== n.name || (o = o.concat(n.language)), o = o.concat(e), i.set(o, c), c += o.length, o = a(n.description), i.set(o, c), c += o.length, o = [0, 0].concat(e), i.set(o, c), c += o.length, o = a(n.value), i.set(o, c), c += o.length;
                    break;
                case"TBPM":
                case"TLEN":
                case"TDAT":
                case"TYER":
                    c++, o = t(n.value), i.set(o, c), c += o.length;
                    break;
                case"PRIV":
                    o = t(n.id), i.set(o, c), c += o.length, c++, i.set(new Uint8Array(n.value), c), c += n.value.byteLength;
                    break;
                case"APIC":
                    o = [n.useUnicodeEncoding ? 1 : 0], i.set(o, c), c += o.length, o = t(n.mimeType), i.set(o, c), c += o.length, o = [0, n.pictureType], i.set(o, c), c += o.length, n.useUnicodeEncoding ? (o = [].concat(e), i.set(o, c), c += o.length, o = a(n.description), i.set(o, c), c += o.length, c += 2) : (o = t(n.description), i.set(o, c), c += o.length, c++), i.set(new Uint8Array(n.value), c), c += n.value.byteLength;
                    break;
                case"IPLS":
                    o = [1], i.set(o, c), c += o.length, n.value.forEach((t => {
                        o = [].concat(e), i.set(o, c), c += o.length, o = a(t[0].toString()), i.set(o, c), c += o.length, o = [0, 0].concat(e), i.set(o, c), c += o.length, o = a(t[1].toString()), i.set(o, c), c += o.length, o = [0, 0], i.set(o, c), c += o.length
                    }));
                    break;
                case"SYLT":
                    o = [1].concat(n.language).concat(n.timestampFormat).concat(n.type), i.set(o, c), c += o.length, o = [].concat(e), i.set(o, c), c += o.length, o = a(n.description), i.set(o, c), c += o.length, c += 2, n.value.forEach((t => {
                        o = [].concat(e), i.set(o, c), c += o.length, o = a(t[0].toString()), i.set(o, c), c += o.length, o = [0, 0], i.set(o, c), c += o.length, o = r(t[1]), i.set(o, c), c += o.length
                    }))
            }
        })), c += this.padding, i.set(new Uint8Array(this.arrayBuffer), c), this.arrayBuffer = s, s
    }

    getBlob() {
        return new Blob([this.arrayBuffer], {type: "audio/mpeg"})
    }

    getURL() {
        return this.url || (this.url = URL.createObjectURL(this.getBlob())), this.url
    }

    revokeURL() {
        URL.revokeObjectURL(this.url)
    }
}