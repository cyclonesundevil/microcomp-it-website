'use strict';

(function exposeParameterCounter(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompLlmParameters = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createParameterCounter() {
    const PARAMETER_LIMIT = 200000;
    const DEFAULT_VOCABULARY_SIZE = 35;

    const bounds = Object.freeze({
        vocabularySize: [5, 512],
        contextLength: [16, 256],
        embeddingDimension: [16, 128],
        attentionHeads: [1, 16],
        transformerLayers: [1, 6],
        feedForwardDimension: [32, 512]
    });

    function asInteger(value) {
        const parsed = Number(value);
        return Number.isInteger(parsed) ? parsed : NaN;
    }

    function normalizeConfiguration(input) {
        return {
            vocabularySize: asInteger(input.vocabularySize ?? DEFAULT_VOCABULARY_SIZE),
            contextLength: asInteger(input.contextLength),
            embeddingDimension: asInteger(input.embeddingDimension),
            attentionHeads: asInteger(input.attentionHeads),
            transformerLayers: asInteger(input.transformerLayers),
            feedForwardDimension: asInteger(input.feedForwardDimension),
            tiedEmbeddings: Boolean(input.tiedEmbeddings)
        };
    }

    function countParameters(input) {
        const config = normalizeConfiguration(input);
        const V = config.vocabularySize;
        const T = config.contextLength;
        const D = config.embeddingDimension;
        const L = config.transformerLayers;
        const F = config.feedForwardDimension;

        const layers = {
            tokenEmbedding: V * D,
            positionEmbedding: T * D,
            decoderBlocks: L * ((4 * D * D) + (2 * D * F) + (9 * D) + F),
            finalLayerNorm: 2 * D,
            outputBias: V,
            outputProjection: config.tiedEmbeddings ? 0 : D * V
        };
        const perBlock = (4 * D * D) + (2 * D * F) + (9 * D) + F;
        return {
            configuration: config,
            layers,
            total: Object.values(layers).reduce((sum, value) => sum + value, 0),
            perBlock,
            blockLayers: Array.from({ length: L }, (_, index) => ({
                name: `Decoder block ${index + 1}`,
                parameters: perBlock
            }))
        };
    }

    function validateConfiguration(input) {
        const result = countParameters(input);
        const config = result.configuration;
        const errors = [];

        Object.entries(bounds).forEach(([name, [minimum, maximum]]) => {
            const value = config[name];
            if (!Number.isInteger(value)) {
                errors.push(`${name} must be a whole number.`);
            } else if (value < minimum || value > maximum) {
                errors.push(`${name} must be between ${minimum} and ${maximum}.`);
            }
        });
        if (Number.isInteger(config.embeddingDimension) && Number.isInteger(config.attentionHeads)) {
            if (config.embeddingDimension % config.attentionHeads !== 0) {
                errors.push('Embedding dimension must divide evenly across attention heads.');
            } else if (config.embeddingDimension / config.attentionHeads < 4) {
                errors.push('Each attention head must contain at least four dimensions.');
            }
        }
        if (Number.isFinite(result.total) && result.total > PARAMETER_LIMIT) {
            errors.push(`This configuration uses ${result.total.toLocaleString('en-US')} parameters and exceeds the 200,000-parameter limit.`);
        }
        return {
            ...result,
            errors,
            valid: errors.length === 0,
            budgetPercent: Number.isFinite(result.total) ? (result.total / PARAMETER_LIMIT) * 100 : 0
        };
    }

    return Object.freeze({
        DEFAULT_VOCABULARY_SIZE,
        PARAMETER_LIMIT,
        countParameters,
        normalizeConfiguration,
        validateConfiguration
    });
}));
