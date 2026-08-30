(() => {
    'use strict';

    const ACCESS_VERIFIER = '5d1d85b1c937ded422ce3c7d0bbe17ba5fabeb66b2821fdd12e74fee5636a741';
    const TOKEN_KEY = 'masarat_agent_access_token';
    const AGENT_API_URL = 'https://masarat-agent-api.onrender.com/v1/checks';

    const digest = async (scope, password) => {
        const bytes = new TextEncoder().encode(`${scope}:${password}`);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    };

    const configureAgent = token => {
        window.AGENT_EXECUTOR_CONFIG = {
            ...(window.AGENT_EXECUTOR_CONFIG || {}),
            apiUrl: AGENT_API_URL,
            getAccessToken: async () => sessionStorage.getItem(TOKEN_KEY) || '',
            accessToken: token
        };
    };

    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    localStorage.removeItem('managing_masarat_pw');
    if (savedToken) {
        configureAgent(savedToken);
        return;
    }

    document.write(`
        <div id="global-pw-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#091e42;z-index:99999999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Inter', sans-serif;">
            <style>body{overflow:hidden !important;}</style>
            <h2 style="color:white;margin-bottom:20px;">Access Restricted</h2>
            <input type="password" id="global-pw-input" autocomplete="current-password" placeholder="Enter Password" style="padding:12px;font-size:16px;border-radius:6px;border:none;margin-bottom:12px;width:250px;text-align:center;box-sizing:border-box;">
            <button id="global-pw-btn" style="padding:12px 24px;width:250px;font-size:16px;border-radius:6px;background:#0c66e4;color:white;border:none;cursor:pointer;font-weight:bold;box-sizing:border-box;">Enter</button>
            <p id="global-pw-error" style="color:#ff5252;margin-top:10px;display:none;">Incorrect password</p>
        </div>
    `);

    window.addEventListener('DOMContentLoaded', () => {
        const button = document.getElementById('global-pw-btn');
        const input = document.getElementById('global-pw-input');
        const error = document.getElementById('global-pw-error');
        const overlay = document.getElementById('global-pw-overlay');

        const check = async () => {
            button.disabled = true;
            error.style.display = 'none';
            try {
                const password = input.value;
                const verifier = await digest('masarat-ui-v1', password);
                if (verifier !== ACCESS_VERIFIER) {
                    error.style.display = 'block';
                    input.select();
                    return;
                }
                const token = await digest('masarat-agent-api-v1', password);
                sessionStorage.setItem(TOKEN_KEY, token);
                configureAgent(token);
                document.body.style.overflow = '';
                overlay.remove();
            } finally {
                button.disabled = false;
            }
        };

        button.addEventListener('click', check);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') check();
        });
        input.focus();
    });
})();
