'use strict';

(function exposeInferenceTokenizer(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompInferenceTokenizer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTokenizerApi() {
    const RESERVED = Object.freeze(['<pad>', '<bos>', '<eos>', '<unk>']);
    const FIELDS = Object.freeze([
        'normalization', 'reserved_tokens', 'schema_version', 'tokens', 'type',
        'unknown_behavior'
    ]);

    function validateDocument(document) {
        if (!document || typeof document !== 'object' || Array.isArray(document)
            || Object.keys(document).sort().join('|') !== [...FIELDS].sort().join('|')) {
            throw new TypeError('Tokenizer fields do not match schema 1.0.');
        }
        if (document.schema_version !== '1.0' || document.type !== 'character'
            || document.normalization !== 'NFC'
            || document.unknown_behavior !== 'encode as <unk>; decode as Unicode replacement character'
            || JSON.stringify(document.reserved_tokens) !== JSON.stringify(RESERVED)) {
            throw new Error('Tokenizer constants do not conform to specification v1.');
        }
        if (!Array.isArray(document.tokens) || document.tokens.length < 5
            || JSON.stringify(document.tokens.slice(0, 4)) !== JSON.stringify(RESERVED)
            || new Set(document.tokens).size !== document.tokens.length) {
            throw new Error('Tokenizer vocabulary is invalid.');
        }
        document.tokens.slice(4).forEach(token => {
            const points = Array.from(token);
            if (points.length !== 1) throw new Error('Vocabulary entries must be one Unicode scalar value.');
            const point = points[0].codePointAt(0);
            if (point >= 0xD800 && point <= 0xDFFF) throw new Error('Surrogate vocabulary entries are invalid.');
        });
        return document;
    }

    class CharacterTokenizer {
        constructor(document) {
            validateDocument(document);
            this.document = Object.freeze({
                ...document,
                reserved_tokens: Object.freeze([...document.reserved_tokens]),
                tokens: Object.freeze([...document.tokens])
            });
            this.tokens = this.document.tokens;
            this.ids = new Map(this.tokens.map((token, index) => [token, index]));
        }

        get vocabSize() { return this.tokens.length; }
        get padId() { return 0; }
        get bosId() { return 1; }
        get eosId() { return 2; }
        get unkId() { return 3; }

        encode(text, options = {}) {
            if (typeof text !== 'string') throw new TypeError('Text must be a string.');
            const ids = Array.from(text.normalize('NFC'), character => this.ids.get(character) ?? this.unkId);
            if (options.addBos) ids.unshift(this.bosId);
            if (options.addEos) ids.push(this.eosId);
            return ids;
        }

        decode(tokenIds, options = {}) {
            return Array.from(tokenIds, id => {
                if (!Number.isInteger(id) || id < 0 || id >= this.vocabSize) {
                    throw new RangeError(`Token ID ${id} is outside the vocabulary.`);
                }
                if (id < 4) {
                    if (options.skipSpecial === false) return this.tokens[id];
                    return id === this.unkId ? '\ufffd' : '';
                }
                return this.tokens[id];
            }).join('');
        }
    }

    return Object.freeze({ CharacterTokenizer, FIELDS, RESERVED, validateDocument });
}));
