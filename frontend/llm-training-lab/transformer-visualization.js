'use strict';

(function exposeTransformerVisualization(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompTransformerVisualization = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVisualizationApi() {
    function tokenFlow(snapshot, vocabulary) {
        if (!snapshot?.embeddings?.tokenIds?.length) return [];
        return snapshot.embeddings.tokenIds.map((id, position) => ({
            id,
            position,
            token: vocabulary[id] ?? `ID ${id}`,
            selected: position === snapshot.embeddings.tokenIds.length - 1
        }));
    }

    function hasEducationalTensors(snapshot) {
        return Boolean(
            snapshot?.embeddings?.values
            && snapshot?.attention?.values
            && Array.isArray(snapshot.logits)
            && Array.isArray(snapshot.probabilities)
            && Array.isArray(snapshot.activations)
        );
    }

    return Object.freeze({ tokenFlow, hasEducationalTensors });
}));
