document.addEventListener('DOMContentLoaded', () => {

    // --- UI Interactions ---
    const toggleBtn = document.getElementById('chatbot-toggle');
    const closeBtn = document.getElementById('chatbot-close');
    const container = document.getElementById('chatbot-container');
    const msgContainer = document.getElementById('chatbot-messages');
    const turnstileWidgets = new Map();
    const chatVerificationStorageKey = 'microcompChatVerification';
    let chatVerificationSessionToken = sessionStorage.getItem(chatVerificationStorageKey) || '';
    let turnstileConfig = { turnstileEnabled: false, turnstileSiteKey: '', chatVerificationRequired: false };

    const turnstileReady = fetch('/api/public-config')
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Configuration unavailable')))
        .then((config) => {
            turnstileConfig = config;
            if (chatVerificationSessionToken) {
                turnstileConfig.chatVerificationRequired = false;
            }
            if (!config.turnstileEnabled || !config.turnstileSiteKey) return;
            return new Promise((resolve, reject) => {
                window.onTurnstileReady = resolve;
                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileReady';
                script.async = true;
                script.defer = true;
                script.onerror = () => reject(new Error('Verification could not be loaded'));
                document.head.appendChild(script);
            });
        })
        .catch((error) => {
            console.warn('Turnstile configuration error:', error);
            return null;
        });

    async function requestTurnstileToken(action, containerId) {
        await turnstileReady;
        if (!turnstileConfig.turnstileEnabled) return '';
        if (!window.turnstile) throw new Error('Verification is unavailable. Please refresh and try again.');

        return new Promise((resolve, reject) => {
            const slot = document.getElementById(containerId);
            if (!slot) return reject(new Error('Verification could not be displayed.'));
            const previousWidget = turnstileWidgets.get(containerId);
            if (previousWidget !== undefined) {
                window.turnstile.remove(previousWidget);
                turnstileWidgets.delete(containerId);
            }
            const widgetId = window.turnstile.render(slot, {
                sitekey: turnstileConfig.turnstileSiteKey,
                action,
                execution: 'execute',
                appearance: 'interaction-only',
                size: 'flexible',
                theme: 'auto',
                callback: resolve,
                'error-callback': () => reject(new Error('Verification failed. Please try again.')),
                'expired-callback': () => reject(new Error('Verification expired. Please try again.'))
            });
            turnstileWidgets.set(containerId, widgetId);
            window.turnstile.execute(widgetId);
        });
    }

    function trackAgentEvent(eventName, details = {}) {
        window.microcompTrack?.(eventName, {
            category: 'homepage_agent',
            ...details
        });
    }

    toggleBtn.addEventListener('click', () => {
        container.classList.toggle('chatbot-hidden');
        if (!container.classList.contains('chatbot-hidden')) {
            trackAgentEvent('chat_open', { source: 'floating_toggle', persona: personaSelector?.value || 'it' });
            document.getElementById('chat-input-field').focus();
        } else {
            trackAgentEvent('chat_close', { source: 'floating_toggle', persona: personaSelector?.value || 'it' });
        }
    });

    closeBtn.addEventListener('click', () => {
        container.classList.add('chatbot-hidden');
        trackAgentEvent('chat_close', { source: 'close_button', persona: personaSelector?.value || 'it' });
    });

    window.openChatbot = function (source = 'page_cta') {
        const wasHidden = container.classList.contains('chatbot-hidden');
        container.classList.remove('chatbot-hidden');
        if (wasHidden) {
            trackAgentEvent('chat_open', { source, persona: personaSelector?.value || 'it' });
        }
        document.getElementById('chat-input-field').focus();
    };

    // --- Chat Logic ---
    const inputField = document.getElementById('chat-input-field');
    const sendBtn = document.getElementById('chat-send-btn');
    const personaSelector = document.getElementById('persona-selector');
    const chatbotTitleText = document.getElementById('chatbot-title-text');

    const personaIntroductions = {
        it: {
            title: "TechBot Assistant",
            message: "Hello! I'm a virtual IT engineer with MicroComp IT. Are you currently experiencing an IT issue, or are you looking to upgrade your business infrastructure?",
            placeholder: "Type your computing issue here..."
        },
        career: {
            title: "Career Profile Assistant",
            message: "Hello. I can answer employer-focused questions about Jose C. Ramirez's technology background, engineering experience, and professional fit.",
            placeholder: "Ask about Jose's technology background..."
        },
        podiatry: {
            title: "Medical Office Demo",
            message: "Hello! This demo shows how an AI assistant can help a medical office answer general patient questions, collect appointment details, and route urgent concerns appropriately.",
            placeholder: "Ask a medical office demo question..."
        }
    };

    const starterPrompts = {
        it: [
            ['I need IT support', 'I need IT support and would like help narrowing down the problem.'],
            ['I am concerned about security', 'I am concerned about my business cybersecurity. What should I check first?'],
            ['I want to automate a process', 'I want to automate a business process. Help me identify a practical starting point.']
        ],
        career: [
            ['Summarize Jose\'s background', 'Please summarize Jose\'s technology background and strongest areas.'],
            ['Discuss role fit', 'I would like to discuss whether Jose is a fit for a technology role.'],
            ['Request a conversation', 'I would like to arrange a professional conversation with Jose.']
        ],
        podiatry: [
            ['Ask a general question', 'I have a general health question and would like educational guidance.'],
            ['Prepare for a visit', 'What information should I prepare before contacting a medical office?'],
            ['Appointment information', 'I would like general information about arranging an appointment.']
        ]
    };

    function addStarterPrompts(persona) {
        const choices = starterPrompts[persona] || starterPrompts.it;
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-starters';
        wrapper.setAttribute('aria-label', 'Suggested questions');
        choices.forEach(([label, prompt]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-starter';
            button.textContent = label;
            button.addEventListener('click', () => {
                inputField.value = prompt;
                sendMessage();
            });
            wrapper.appendChild(button);
        });
        msgContainer.appendChild(wrapper);
    }

    function resetChatForPersona(persona) {
        const intro = personaIntroductions[persona] || personaIntroductions.it;
        chatHistory = [];
        msgContainer.innerHTML = '';
        addMessageToDOM(intro.message, 'bot');
        addStarterPrompts(persona);
        inputField.placeholder = intro.placeholder;
        if (chatbotTitleText) {
            chatbotTitleText.textContent = intro.title;
        }
    }

    // Manage conversation history for Gemini logic
    let chatHistory = [];
    let userMessageCount = 0;

    window.openCareerAgent = function () {
        if (personaSelector) {
            personaSelector.value = 'career';
            resetChatForPersona('career');
        }
        window.openChatbot('career_agent_cta');
    };

    function addMessageToDOM(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender);
        // Basic Markdown-ish escaping for line breaks
        msgDiv.innerHTML = text.replace(/\n/g, '<br>');
        msgContainer.appendChild(msgDiv);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.classList.add('typing-indicator');
        indicator.id = 'typing-indicator';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
        msgContainer.appendChild(indicator);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const ind = document.getElementById('typing-indicator');
        if (ind) ind.remove();
    }

    async function sendMessage() {
        const text = inputField.value.trim();
        if (!text) return;
        const persona = personaSelector.value;
        const requestStartedAt = performance.now();
        let turnstileToken = '';
        sendBtn.disabled = true;
        inputField.disabled = true;
        try {
            await turnstileReady;
            if (turnstileConfig.chatVerificationRequired) {
                turnstileToken = await requestTurnstileToken('chat_start', 'chat-turnstile');
            }
        } catch (error) {
            addMessageToDOM(error.message || 'Human verification failed. Please try again.', 'bot');
            sendBtn.disabled = false;
            inputField.disabled = false;
            inputField.focus();
            return;
        }
        userMessageCount += 1;
        trackAgentEvent('chat_message_sent', {
            persona,
            messageNumber: userMessageCount
        });

        // 1. Show user message
        addMessageToDOM(text, 'user');
        msgContainer.querySelector('.chat-starters')?.remove();
        inputField.value = '';
        inputField.focus();

        // 2. Add to history BEFORE sending to avoid tracking bot prediction delays
        chatHistory.push({ "role": "user", "parts": [text] });

        // 3. Show typing
        showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(0, -1), // Send all history except the one we just added
                    persona: persona,
                    turnstileToken,
                    verificationSessionToken: chatVerificationSessionToken
                })
            });

            const data = await response.json();
            removeTypingIndicator();

            if (data.error) {
                if (data.verificationRequired) {
                    turnstileConfig.chatVerificationRequired = true;
                    chatVerificationSessionToken = '';
                    sessionStorage.removeItem(chatVerificationStorageKey);
                }
                addMessageToDOM(
                    data.verificationRequired
                        ? 'Human verification is required. Please send your message again to retry.'
                        : '⚠️ System Error: Our engineers are currently offline.',
                    'bot'
                );
                trackAgentEvent('chat_response', {
                    persona,
                    outcome: 'api_error',
                    messageNumber: userMessageCount,
                    responseTimeMs: Math.round(performance.now() - requestStartedAt)
                });
                // Remove the failed user message from history
                chatHistory.pop();
            } else {
                turnstileConfig.chatVerificationRequired = false;
                if (data.verificationSessionToken) {
                    chatVerificationSessionToken = data.verificationSessionToken;
                    sessionStorage.setItem(chatVerificationStorageKey, chatVerificationSessionToken);
                }
                addMessageToDOM(data.response, 'bot');
                chatHistory.push({ "role": "model", "parts": [data.response] });
                trackAgentEvent('chat_response', {
                    persona,
                    outcome: 'success',
                    messageNumber: userMessageCount,
                    responseTimeMs: Math.round(performance.now() - requestStartedAt)
                });
            }

        } catch (err) {
            console.error(err);
            removeTypingIndicator();
            addMessageToDOM("⚠️ Network Error connecting to server.", 'bot');
            trackAgentEvent('chat_response', {
                persona,
                outcome: 'network_error',
                messageNumber: userMessageCount,
                responseTimeMs: Math.round(performance.now() - requestStartedAt)
            });
            chatHistory.pop();
        } finally {
            sendBtn.disabled = false;
            inputField.disabled = false;
            inputField.focus();
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    window.startQuote = function () {
        window.openChatbot('quote_cta');
        if (chatHistory.length === 0) {
            inputField.value = "I would like to get a quote for IT services.";
            sendMessage();
        }
    };

    // --- Voice Logic (Gemini Live API) ---
    const micBtn = document.getElementById('mic-btn');
    let ws = null;
    let audioContext = null;
    let mediaStream = null;
    let scriptProcessor = null;
    let nextPlayTime = 0;

    async function startVoiceSession() {
        const persona = personaSelector.value;
        trackAgentEvent('voice_start', { persona, source: 'microphone_button' });
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            nextPlayTime = audioContext.currentTime;

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/voice-chat?persona=${persona}`;
            ws = new WebSocket(wsUrl);
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
                trackAgentEvent('voice_connected', { persona, outcome: 'success' });
                micBtn.classList.add('active');
                addMessageToDOM("Voice session connected. Start speaking... 🎙️ (Note: Audio responses may take up to 5 seconds to process, please be patient.)", 'bot');
                
                const source = audioContext.createMediaStreamSource(mediaStream);
                scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
                
                scriptProcessor.onaudioprocess = (e) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmData = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                            let s = Math.max(-1, Math.min(1, inputData[i]));
                            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        }
                        ws.send(pcmData.buffer);
                    }
                };

                source.connect(scriptProcessor);
                scriptProcessor.connect(audioContext.destination);
            };

            ws.onmessage = async (event) => {
                let arrayBuffer;
                if (event.data instanceof ArrayBuffer) {
                    arrayBuffer = event.data;
                } else if (event.data instanceof Blob) {
                    arrayBuffer = await event.data.arrayBuffer();
                }

                if (arrayBuffer) {
                    try {
                        const pcmData = new Int16Array(arrayBuffer);
                        const sampleRate = 24000;
                        const audioBuffer = audioContext.createBuffer(1, pcmData.length, sampleRate);
                        const channelData = audioBuffer.getChannelData(0);
                        
                        for (let i = 0; i < pcmData.length; i++) {
                            channelData[i] = pcmData[i] / 32768.0;
                        }

                        const source = audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioContext.destination);
                            
                        const startTime = Math.max(nextPlayTime, audioContext.currentTime);
                        source.start(startTime);
                        nextPlayTime = startTime + audioBuffer.duration;
                    } catch (e) {
                        console.error("Audio playback error", e);
                    }
                }
            };

            ws.onclose = () => {
                trackAgentEvent('voice_end', { persona, outcome: 'socket_closed' });
                stopVoiceSession();
                addMessageToDOM("Voice session ended.", 'bot');
            };

        } catch (err) {
            console.error("Voice init error:", err);
            addMessageToDOM("Error accessing microphone.", 'bot');
            trackAgentEvent('voice_error', { persona, outcome: 'permission_or_setup_error' });
            stopVoiceSession();
        }
    }

    function stopVoiceSession() {
        if (micBtn) micBtn.classList.remove('active');
        if (scriptProcessor) {
            scriptProcessor.disconnect();
            scriptProcessor = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        if (ws) {
            ws.close();
            ws = null;
        }
        if (audioContext) {
            nextPlayTime = 0;
        }
    }

    if (micBtn) {
        micBtn.addEventListener('click', () => {
            if (micBtn.classList.contains('active')) {
                stopVoiceSession();
            } else {
                startVoiceSession();
            }
        });
    }

    if (personaSelector) {
        personaSelector.addEventListener('change', () => {
            resetChatForPersona(personaSelector.value);
            trackAgentEvent('persona_change', { persona: personaSelector.value });
        });
        resetChatForPersona(personaSelector.value);

        const requestedPersona = sessionStorage.getItem('microcompRequestedPersona');
        if (requestedPersona && personaIntroductions[requestedPersona]) {
            sessionStorage.removeItem('microcompRequestedPersona');
            personaSelector.value = requestedPersona;
            resetChatForPersona(requestedPersona);
            window.openChatbot();
        }
    }

    // --- Contact Form Logic ---
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        const startedAtField = document.getElementById('contact-started-at');
        const refreshContactStartedAt = () => {
            if (startedAtField) {
                startedAtField.value = String(Date.now());
            }
        };

        refreshContactStartedAt();

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = document.getElementById('contact-submit-btn');
            const responseMsg = document.getElementById('contact-response');

            if (!contactForm.checkValidity()) {
                contactForm.reportValidity();
                return;
            }
            
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
            
            const data = {
                name: document.getElementById('contact-name').value.trim(),
                email: document.getElementById('contact-email').value.trim(),
                message: document.getElementById('contact-message').value.trim(),
                website: document.getElementById('contact-website')?.value.trim() || '',
                started_at: startedAtField?.value || '',
                turnstileToken: ''
            };
            
            try {
                data.turnstileToken = await requestTurnstileToken('contact_submit', 'contact-turnstile');
                const res = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await res.json();
                responseMsg.classList.remove('hidden');
                
                if (result.success) {
                    responseMsg.className = 'contact-response-msg success';
                    responseMsg.innerText = "Message sent successfully! We will be in touch shortly.";
                    contactForm.reset();
                    refreshContactStartedAt();
                } else {
                    responseMsg.className = 'contact-response-msg error';
                    responseMsg.innerText = result.error || "Error sending message. Please try again.";
                }
            } catch (err) {
                responseMsg.classList.remove('hidden');
                responseMsg.className = 'contact-response-msg error';
                responseMsg.innerText = "Network error. Please try again later.";
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Send Message <i class="fa-solid fa-paper-plane"></i>';
            }
        });
    }
});
