document.addEventListener('DOMContentLoaded', () => {

    // --- Analytics Tracking ---
    const sessionStartTime = Date.now();
    const sessionId = Math.random().toString(36).substring(2, 15);
    
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            const timeSpentMs = Date.now() - sessionStartTime;
            const data = JSON.stringify({
                sessionId: sessionId,
                path: window.location.pathname,
                timeSpentSeconds: Math.floor(timeSpentMs / 1000)
            });
            navigator.sendBeacon('/api/track', data);
        }
    });

    // --- UI Interactions ---
    const toggleBtn = document.getElementById('chatbot-toggle');
    const closeBtn = document.getElementById('chatbot-close');
    const container = document.getElementById('chatbot-container');
    const msgContainer = document.getElementById('chatbot-messages');

    toggleBtn.addEventListener('click', () => {
        container.classList.toggle('chatbot-hidden');
        if (!container.classList.contains('chatbot-hidden')) {
            document.getElementById('chat-input-field').focus();
        }
    });

    closeBtn.addEventListener('click', () => {
        container.classList.add('chatbot-hidden');
    });

    window.openChatbot = function () {
        container.classList.remove('chatbot-hidden');
        document.getElementById('chat-input-field').focus();
    };

    // --- Chat Logic ---
    const inputField = document.getElementById('chat-input-field');
    const sendBtn = document.getElementById('chat-send-btn');

    // Manage conversation history for Gemini logic
    let chatHistory = [];

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

        // 1. Show user message
        addMessageToDOM(text, 'user');
        inputField.value = '';
        inputField.focus();

        // 2. Add to history BEFORE sending to avoid tracking bot prediction delays
        chatHistory.push({ "role": "user", "parts": [text] });

        // 3. Show typing
        showTypingIndicator();

        try {
            const persona = document.getElementById('persona-selector').value;
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(0, -1), // Send all history except the one we just added
                    persona: persona
                })
            });

            const data = await response.json();
            removeTypingIndicator();

            if (data.error) {
                addMessageToDOM("⚠️ System Error: Our engineers are currently offline.", 'bot');
                // Remove the failed user message from history
                chatHistory.pop();
            } else {
                addMessageToDOM(data.response, 'bot');
                chatHistory.push({ "role": "model", "parts": [data.response] });
            }

        } catch (err) {
            console.error(err);
            removeTypingIndicator();
            addMessageToDOM("⚠️ Network Error connecting to server.", 'bot');
            chatHistory.pop();
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    window.startQuote = function () {
        window.openChatbot();
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
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            nextPlayTime = audioContext.currentTime;

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const persona = document.getElementById('persona-selector').value;
            const wsUrl = `${protocol}//${window.location.host}/api/voice-chat?persona=${persona}`;
            ws = new WebSocket(wsUrl);
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
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
                stopVoiceSession();
                addMessageToDOM("Voice session ended.", 'bot');
            };

        } catch (err) {
            console.error("Voice init error:", err);
            addMessageToDOM("Error accessing microphone.", 'bot');
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
});
