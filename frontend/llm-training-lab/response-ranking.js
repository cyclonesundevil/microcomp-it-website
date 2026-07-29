'use strict';

(function exposeResponseRanking(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompResponseRanking = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRankingApi() {
    const MAX_CANDIDATES = 6;
    const MAX_RESPONSE_CHARACTERS = 256;

    function displayToken(token) {
        if (token === ' ') return 'space';
        if (token === '\n') return '\\n';
        return token;
    }

    function logSumExp(values) {
        const maximum = Math.max(...values);
        return maximum + Math.log(
            values.reduce((sum, value) => sum + Math.exp(value - maximum), 0)
        );
    }

    function probabilities(logits) {
        const normalizer = logSumExp(logits);
        return logits.map((logit, id) => ({
            id,
            probability: Math.exp(logit - normalizer)
        })).sort((left, right) => (
            right.probability - left.probability || left.id - right.id
        ));
    }

    function validateInputs(model, prefix, candidates, detailId) {
        if (!model?.tokenizer || !model?.config || typeof model.forward !== 'function') {
            throw new TypeError('A compatible worker-owned model is required.');
        }
        if (typeof prefix !== 'string' || !Array.from(prefix).length) {
            throw new TypeError('The held-out prefix must be a non-empty string.');
        }
        if (!Array.isArray(candidates) || candidates.length < 2
            || candidates.length > MAX_CANDIDATES) {
            throw new RangeError(`Provide 2 through ${MAX_CANDIDATES} response candidates.`);
        }
        const ids = new Set();
        candidates.forEach(candidate => {
            if (!candidate || typeof candidate.id !== 'string' || !candidate.id
                || ids.has(candidate.id) || typeof candidate.text !== 'string'
                || !Array.from(candidate.text).length
                || Array.from(candidate.text).length > MAX_RESPONSE_CHARACTERS) {
                throw new TypeError('Every response candidate needs a unique ID and bounded text.');
            }
            ids.add(candidate.id);
        });
        if (!ids.has(detailId)) throw new Error('The detail candidate is unavailable.');
    }

    function rankResponses(model, prefix, candidates, detailId) {
        validateInputs(model, prefix, candidates, detailId);
        let prefixIds = model.tokenizer.encode(prefix);
        if (!prefixIds.length) prefixIds = [model.tokenizer.bosId];
        if (prefixIds.length >= model.config.context_length) {
            prefixIds = prefixIds.slice(-(model.config.context_length - 1));
        }
        const candidateIds = candidates.map(candidate => ({
            ...candidate,
            ids: model.tokenizer.encode(candidate.text)
        }));
        const scoreLength = Math.min(
            model.config.context_length - prefixIds.length,
            ...candidateIds.map(candidate => candidate.ids.length)
        );
        if (scoreLength < 1) throw new Error('No candidate characters fit in the context.');

        const scored = candidateIds.map(candidate => {
            const targetIds = candidate.ids.slice(0, scoreLength);
            const sequence = [...prefixIds, ...targetIds];
            const result = model.forward([sequence]);
            const vocabularySize = model.tokenizer.vocabSize;
            let lossTotal = 0;
            let correct = 0;
            const detail = [];
            const predictedIds = [];
            targetIds.forEach((expectedId, targetIndex) => {
                const position = prefixIds.length - 1 + targetIndex;
                const offset = position * vocabularySize;
                const logits = Array.from(
                    result.logits.slice(offset, offset + vocabularySize)
                );
                const ranked = probabilities(logits);
                const predicted = ranked[0];
                const expectedProbability = ranked.find(item => item.id === expectedId)
                    .probability;
                lossTotal += -Math.log(Math.max(expectedProbability, 1e-30));
                if (predicted.id === expectedId) correct += 1;
                predictedIds.push(predicted.id);
                if (candidate.id === detailId) {
                    detail.push({
                        position: targetIndex + 1,
                        expectedId,
                        expected: displayToken(model.tokenizer.tokens[expectedId]),
                        predictedId: predicted.id,
                        predicted: displayToken(model.tokenizer.tokens[predicted.id]),
                        correct: predicted.id === expectedId,
                        expectedProbability,
                        topChoices: ranked.slice(0, 5).map(item => ({
                            id: item.id,
                            token: displayToken(model.tokenizer.tokens[item.id]),
                            probability: item.probability
                        }))
                    });
                }
            });
            return {
                id: candidate.id,
                text: candidate.text,
                averageLoss: lossTotal / scoreLength,
                characterAccuracy: correct / scoreLength,
                correctCharacters: correct,
                evaluatedCharacters: scoreLength,
                predictedText: model.tokenizer.decode(predictedIds),
                detail
            };
        });

        const maximumScore = Math.max(...scored.map(item => -item.averageLoss));
        const weights = scored.map(item => Math.exp(-item.averageLoss - maximumScore));
        const weightTotal = weights.reduce((sum, value) => sum + value, 0);
        scored.forEach((item, index) => {
            item.relativeScore = weights[index] / weightTotal;
        });
        scored.sort((left, right) => (
            left.averageLoss - right.averageLoss || left.id.localeCompare(right.id)
        ));
        return {
            scoredCharactersPerCandidate: scoreLength,
            candidates: scored,
            detail: scored.find(item => item.id === detailId).detail
        };
    }

    function correctRank(result, correctId) {
        const index = result.candidates.findIndex(candidate => candidate.id === correctId);
        if (index < 0) throw new Error('The correct candidate is unavailable.');
        return index + 1;
    }

    return Object.freeze({
        MAX_CANDIDATES,
        MAX_RESPONSE_CHARACTERS,
        correctRank,
        rankResponses
    });
}));
