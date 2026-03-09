document.addEventListener('DOMContentLoaded', () => {

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

        // 4. Fetch from API
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(0, -1) // Send all history except the one we just added
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
});
