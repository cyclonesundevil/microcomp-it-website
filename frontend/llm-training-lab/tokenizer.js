'use strict';

(function exposeTokenizer(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompCharacterTokenizer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTokenizerApi() {
    const RESERVED_TOKENS = Object.freeze(['<pad>', '<bos>', '<eos>', '<unk>']);

    function unicodeCharacters(text) {
        return Array.from(String(text).normalize('NFC'));
    }

    function createVocabulary(texts) {
        const characters = new Set();
        texts.forEach(text => unicodeCharacters(text).forEach(character => characters.add(character)));
        return [...RESERVED_TOKENS, ...Array.from(characters).sort((left, right) => {
            const leftPoint = left.codePointAt(0);
            const rightPoint = right.codePointAt(0);
            return leftPoint - rightPoint;
        })];
    }

    function createTokenizer(vocabulary) {
        if (!Array.isArray(vocabulary) || vocabulary.length < RESERVED_TOKENS.length) {
            throw new TypeError('A tokenizer vocabulary must be a non-empty array.');
        }
        RESERVED_TOKENS.forEach((token, index) => {
            if (vocabulary[index] !== token) throw new Error('Reserved token IDs must occupy positions 0 through 3.');
        });
        if (new Set(vocabulary).size !== vocabulary.length) {
            throw new Error('Tokenizer vocabulary entries must be unique.');
        }
        const ids = new Map(vocabulary.map((token, index) => [token, index]));
        return Object.freeze({
            vocabulary: Object.freeze([...vocabulary]),
            encode(text, options = {}) {
                const encoded = unicodeCharacters(text).map(character => ids.get(character) ?? 3);
                if (options.addBos) encoded.unshift(1);
                if (options.addEos) encoded.push(2);
                return encoded;
            },
            decode(tokenIds, options = {}) {
                return tokenIds.map(tokenId => {
                    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= vocabulary.length) {
                        throw new RangeError(`Token ID ${tokenId} is outside the vocabulary.`);
                    }
                    if (tokenId === 3) return '\ufffd';
                    if (tokenId < RESERVED_TOKENS.length) return options.includeSpecial ? vocabulary[tokenId] : '';
                    return vocabulary[tokenId];
                }).join('');
            },
            tokenDetails(text) {
                return unicodeCharacters(text).map(character => ({
                    character,
                    display: character === ' ' ? 'space' : character === '\n' ? '\\n' : character,
                    id: ids.get(character) ?? 3,
                    unknown: !ids.has(character)
                }));
            }
        });
    }

    function commonCharacters(texts, maximum = 12) {
        const counts = new Map();
        texts.forEach(text => unicodeCharacters(text).forEach(character => {
            counts.set(character, (counts.get(character) || 0) + 1);
        }));
        return Array.from(counts, ([character, count]) => ({
            character,
            display: character === ' ' ? 'space' : character === '\n' ? '\\n' : character,
            count
        })).sort((left, right) => right.count - left.count || left.character.codePointAt(0) - right.character.codePointAt(0))
            .slice(0, maximum);
    }

    return Object.freeze({
        RESERVED_TOKENS,
        commonCharacters,
        createTokenizer,
        createVocabulary,
        unicodeCharacters
    });
}));
