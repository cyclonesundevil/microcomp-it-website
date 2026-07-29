'use strict';

(function exposeTrainingReport(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompTrainingReport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createReportApi() {
    const finite = value => Number.isFinite(Number(value));
    const number = value => Number(value);
    const format = value => number(value).toLocaleString('en-US');
    const loss = value => number(value).toFixed(4);

    function points(values) {
        return (values || []).filter(item => finite(item.loss))
            .map(item => ({ step: Number(item.step), loss: number(item.loss) }));
    }

    function buildTrainingReport(session) {
        if (!session || !session.completed) {
            return {
                available: false,
                title: 'No completed training session to analyze',
                sections: [{
                    heading: 'Waiting for measured results',
                    text: 'Complete or load a model with training history to generate this report.'
                }]
            };
        }
        const training = points(session.trainHistory);
        const validation = points(session.validationHistory);
        const first = training[0];
        const last = training.at(-1);
        const firstValidation = validation[0];
        const lastValidation = validation.at(-1);
        const sections = [];

        sections.push({
            heading: 'Dataset and model',
            text: `${session.datasetName} supplied ${format(session.trainingDocuments)} training and ${format(session.validationDocuments)} validation records. The ${session.mode} run used ${format(session.parameterCount)} trainable parameters (${(number(session.parameterCount) / 200000 * 100).toFixed(1)}% of the fixed budget).`
        });
        sections.push({
            heading: 'Work completed',
            text: `The measured run processed ${format(session.tokensProcessed)} tokens across ${format(session.steps)} optimizer steps.`
        });

        if (first && last) {
            const delta = first.loss - last.loss;
            const direction = delta > 0 ? 'decreased' : delta < 0 ? 'increased' : 'did not change';
            const percent = first.loss > 0 ? Math.abs(delta) / first.loss * 100 : null;
            sections.push({
                heading: 'Loss improvement',
                text: `Training loss ${direction} from ${loss(first.loss)} at step ${format(first.step)} to ${loss(last.loss)} at step ${format(last.step)}${percent === null ? '' : `, a ${percent.toFixed(1)}% ${delta >= 0 ? 'reduction' : 'increase'}`}. Loss measures next-character prediction error; it does not measure factual correctness or understanding.`
            });
        } else {
            sections.push({
                heading: 'Loss improvement',
                text: 'The saved session does not contain enough measured training-loss points to calculate a change.'
            });
        }

        if (firstValidation && lastValidation) {
            const validationDelta = firstValidation.loss - lastValidation.loss;
            sections.push({
                heading: 'Generalization evidence',
                text: `Held-out validation loss ${validationDelta > 0 ? 'improved' : validationDelta < 0 ? 'worsened' : 'was unchanged'} from ${loss(firstValidation.loss)} to ${loss(lastValidation.loss)}. This is limited evidence from the bundled validation split, not proof that the model generalizes to real security incidents.`
            });
            const bestValidation = validation.reduce((best, item) => (
                item.loss < best.loss ? item : best
            ), validation[0]);
            const diverged = lastValidation.loss > bestValidation.loss * 1.02
                && first && last && last.loss < first.loss;
            sections.push({
                heading: 'Overfitting risk',
                text: diverged
                    ? `Validation loss finished more than 2% above its measured minimum of ${loss(bestValidation.loss)} at step ${format(bestValidation.step)} while training loss fell. That divergence is an overfitting warning.`
                    : `The captured validation series did not meet this lab’s overfitting warning rule (final validation loss more than 2% above its measured minimum while training loss falls). The small dataset still creates substantial memorization risk.`
            });
        } else {
            sections.push({
                heading: 'Generalization and overfitting',
                text: 'Fewer than two validation measurements were retained, so this session cannot support a measured generalization trend or overfitting warning.'
            });
        }

        sections.push({
            heading: 'Temperature effects',
            text: `The current Playground temperature is ${number(session.temperature).toFixed(1)}. Lower values concentrate probability on likely characters; higher values spread probability and increase variety. This session did not run a controlled multi-temperature comparison, so no output-quality effect is claimed.`
        });
        sections.push({
            heading: 'Limitations and recommendation',
            text: `This character model has at most 200,000 parameters, a short context, one synthetic dataset, and no factual grounding. Treat its output as a learning artifact. ${lastValidation && firstValidation && lastValidation.loss < firstValidation.loss ? 'Try a held-out prompt, compare multiple seeds, and watch whether validation loss continues improving.' : 'Consider more measured validation checkpoints or a smaller architecture before increasing training steps.'}`
        });
        return {
            available: true,
            title: `What Happened During Training? — ${session.mode === 'cloud' ? 'MicroComp Cloud' : 'This Device'}`,
            sections
        };
    }

    return Object.freeze({ buildTrainingReport });
}));
