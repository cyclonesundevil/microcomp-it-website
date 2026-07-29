'use strict';

(function exposeDatasets(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompLlmDatasets = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDatasetRegistry() {
    const training = [
        'alert: repeated sign-in failures exceeded the fictional baseline. response: lock the test account, review the authentication log, and verify the user.',
        'alert: the training web service returned an unusual rise in request errors. response: inspect safe request markers, enable rate limits, and compare normal traffic.',
        'alert: a synthetic workstation contacted an unexpected internal service. response: isolate the test endpoint, preserve the event timeline, and review approved connections.',
        'alert: the mock mail gateway detected an urgent message with a mismatched sender. response: quarantine the message and remind the fictional user not to open links.',
        'alert: records access increased outside the simulated employee baseline. response: verify authorization, apply least privilege, and review the synthetic audit trail.',
        'alert: an educational file service reported rapid rename activity. response: contain the fictional endpoint, protect shared files, and begin the recovery checklist.',
        'alert: the simulated firewall observed a burst of blocked connections. response: confirm the rule is expected, group related events, and monitor service availability.',
        'alert: a test certificate did not match the expected service identity. response: stop the fictional session, validate the certificate chain, and reestablish trust.',
        'alert: the security monitor found a new process behavior marker. response: collect safe metadata, compare the known baseline, and isolate the lab host if needed.',
        'alert: outbound synthetic traffic exceeded the normal training range. response: inspect the destination category, apply egress controls, and document the finding.',
        'alert: the mock database received rejected input patterns. response: retain safe error details, verify parameter handling, and review application firewall events.',
        'alert: a fictional user approved an unexpected sign-in prompt. response: revoke the test session, reset the simulated credential, and review recent access.',
        'alert: service latency increased while request volume remained high. response: activate traffic controls, check capacity, and compare protected availability.',
        'alert: the lab endpoint missed its scheduled security update. response: confirm the maintenance window, apply the approved patch, and record the new version.',
        'alert: a synthetic identity used access not required for its role. response: remove excess permission, review role membership, and document the correction.',
        'alert: the training sensor detected readable content on an unprotected path. response: require encryption, validate the endpoint, and retest the fictional flow.',
        'alert: a mock browser session rendered an unsafe content marker. response: encode output, strengthen content policy, and invalidate the fictional session.',
        'alert: the simulated backup check found a missing recovery point. response: run the approved backup job, verify integrity, and record a restoration test.',
        'alert: a low-volume sequence crossed several fictional systems. response: correlate the timeline, restrict lateral access, and protect collected data.',
        'alert: anomaly detection reported activity without a known signature. response: inspect behavior, isolate the affected lab segment, and avoid unsupported assumptions.',
        'alert: a test account attempted access after its approved hours. response: confirm the schedule, review device context, and escalate only with supporting evidence.',
        'alert: the synthetic service health check failed twice. response: verify dependencies, inspect bounded logs, and follow the documented recovery sequence.',
        'alert: a fictional data transfer exceeded its approved volume. response: pause the transfer, validate the business purpose, and apply data-loss controls.',
        'alert: the mock endpoint protection agent stopped reporting. response: verify agent health, preserve local evidence, and restore monitored coverage.'
    ];
    const validation = [
        'alert: a synthetic account produced repeated denied requests. response: inspect the identity baseline and apply a bounded lockout.',
        'alert: the fictional web service showed unusual input errors. response: validate request handling and review safe firewall evidence.',
        'alert: a lab workstation attempted unexpected internal movement. response: isolate the endpoint and verify segmentation.',
        'alert: the mock email system flagged a deceptive message. response: quarantine it and verify the simulated user account.',
        'alert: synthetic records were accessed outside the normal role. response: apply least privilege and review the audit timeline.',
        'alert: fictional outbound traffic rose above baseline. response: inspect egress policy and document the containment result.'
    ];

    const dataset = Object.freeze({
        id: 'cybersecurity-alerts-v1',
        displayName: 'Synthetic Cybersecurity Alerts and Responses',
        description: 'Original, fictional alert summaries and defensive incident-response notes written for this educational lab.',
        license: 'CC0-1.0',
        training: Object.freeze(training),
        validation: Object.freeze(validation),
        allTexts: Object.freeze([...training, ...validation])
    });

    function summarize(selected = dataset) {
        const countCharacters = texts => texts.reduce((total, text) => total + Array.from(text.normalize('NFC')).length, 0);
        return {
            documentCount: selected.allTexts.length,
            trainingDocuments: selected.training.length,
            validationDocuments: selected.validation.length,
            trainingCharacters: countCharacters(selected.training),
            validationCharacters: countCharacters(selected.validation),
            totalCharacters: countCharacters(selected.allTexts)
        };
    }

    return Object.freeze({
        CYBERSECURITY_ALERTS: dataset,
        getDataset(datasetId) {
            if (datasetId !== dataset.id) throw new Error(`Unknown bundled dataset: ${datasetId}`);
            return dataset;
        },
        summarize
    });
}));
