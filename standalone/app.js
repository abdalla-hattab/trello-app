let boards = [];
let activeBoardId = localStorage.getItem('ai_active_board_id'); // fixed legacy ai_active_board
let activeCardId = null;
let activeTargetListId = null;
let isGlobalDragging = false;

// Migration from the old mixed storage 'ai_accounts_lists'
let rawOldListsData = localStorage.getItem('ai_accounts_lists');
let rawPrivate = localStorage.getItem('ai_private_boards');

if (rawPrivate) {
    boards = JSON.parse(rawPrivate);
} else if (rawOldListsData) {
    // One time migration: extract private boards from old mixed storage
    let oldBoards = JSON.parse(rawOldListsData);
    boards = oldBoards.filter(b => b.type !== 'social_scheduler');
    localStorage.setItem('ai_private_boards', JSON.stringify(boards));
}

// Migrate Kanban structure
function ensureBoardStructure() {
    boards.forEach(b => {
        if (!b.type) {
            if (b.title.trim().toLowerCase() === 'managing') b.type = 'kanban';
            else b.type = 'timer';
        }
        if (b.type === 'kanban' && !b.lists) {
            b.lists = [
                { id: 'list-' + Date.now(), title: b.title, cards: (b.cards || []), x: 40, y: 80 }
            ];
            delete b.cards;
        }
        if (b.type === 'kanban') {
            b.connections = b.connections || [];
            b.lists.forEach((l, i) => {
                if (l.x === undefined) l.x = 40 + (i * 340);
                if (l.y === undefined) l.y = 80;
            });
        }
    });

    if (!activeBoardId && boards.length > 0) activeBoardId = boards[0].id;
}

ensureBoardStructure();

function saveState() {
    boards.forEach(board => {
        if (board.lists && board.connections) {
            // Garbage collect totally orphaned tracker lists
            const listsToRemove = [];
            board.lists.forEach(l => {
                const isTracker = l.trelloListId || l.trelloTasksListId || l.pipedriveStageId || l.trackerType;
                if (isTracker) {
                    const hasEdges = board.connections.some(c => c.source === l.id || c.target === l.id);
                    if (!hasEdges) listsToRemove.push(l.id);
                }
            });
            if (listsToRemove.length > 0) {
                board.lists = board.lists.filter(l => !listsToRemove.includes(l.id));
            }
        }
    });
    
    // Save locally
    localStorage.setItem('ai_private_boards', JSON.stringify(boards));
    localStorage.setItem('ai_active_board_id', activeBoardId);
    
    // Once migrated successfully, delete the old mixed state string to save local space
    if (localStorage.getItem('ai_accounts_lists')) {
        localStorage.removeItem('ai_accounts_lists');
    }
}

function ensureCardChecklist(card) {
    if (!card) return [];
    if (!Array.isArray(card.serviceChecklist)) {
        const legacyChecklist = Array.isArray(card.services)
            ? card.services
                .filter(item => item && typeof item === 'object' && typeof item.name === 'string')
                .map(item => ({ text: item.name.trim(), checked: !!item.checked }))
                .filter(item => item.text)
            : [];
        card.serviceChecklist = legacyChecklist;
    }
    card.serviceChecklist = card.serviceChecklist
        .map(item => {
            if (typeof item === 'string') {
                const text = item.trim();
                return text ? { text, checked: false, comment: '', showComment: false } : null;
            }
            if (!item || typeof item !== 'object') return null;
            const text = typeof item.text === 'string'
                ? item.text.trim()
                : (typeof item.name === 'string' ? item.name.trim() : '');
            if (!text) return null;
            return { 
                text, 
                checked: !!item.checked,
                comment: typeof item.comment === 'string' ? item.comment : '',
                showComment: !!item.showComment
            };
        })
        .filter(Boolean);
    return card.serviceChecklist;
}

function cloneCardChecklist(card) {
    return ensureCardChecklist(card).map(item => ({ text: item.text, checked: !!item.checked }));
}

function renderCardChecklistEditor(card, options = {}) {
    const servicesList = document.getElementById('servicesList');
    const servicesItemInput = document.getElementById('servicesItemInput');
    const addServicesItemBtn = document.getElementById('addServicesItemBtn');
    if (!servicesList || !servicesItemInput || !addServicesItemBtn) return;

    const checklist = ensureCardChecklist(card);
    servicesList.innerHTML = '';

    if (checklist.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.textContent = options.emptyText || 'No service items yet. Add the agreed services below.';
        emptyState.style.fontSize = '13px';
        emptyState.style.color = '#5e6c84';
        emptyState.style.fontStyle = 'italic';
        servicesList.appendChild(emptyState);
    } else {
        checklist.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'nc-service-row' + (item.checked ? ' nc-is-checked' : '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'nc-modal-cb';
            checkbox.checked = !!item.checked;
            checkbox.onchange = () => {
                const isChecked = checkbox.checked;
                textInput.classList.toggle('nc-done', isChecked);
                checklist[index].checked = isChecked;
                saveState();
                setTimeout(() => {
                    render();
                    renderCardChecklistEditor(card, options);
                }, 0);
            };

            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = item.text;
            textInput.placeholder = 'Describe the service';
            textInput.className = 'nc-service-text' + (item.checked ? ' nc-done' : '');
            textInput.oninput = () => {
                checklist[index].text = textInput.value;
            };
            textInput.onblur = () => {
                const value = textInput.value.trim();
                let needsRender = false;
                if (!value) {
                    checklist.splice(index, 1);
                    needsRender = true;
                } else {
                    if (checklist[index].text !== value) {
                        checklist[index].text = value;
                    }
                }
                saveState();
                if (needsRender) {
                    setTimeout(() => {
                        render();
                        renderCardChecklistEditor(card, options);
                    }, 0);
                }
            };
            textInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    textInput.blur();
                }
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.textContent = '×';
            deleteBtn.className = 'nc-del-btn';
            if(deleteBtn) deleteBtn.onclick = () => {
                checklist.splice(index, 1);
                saveState();
                render();
                renderCardChecklistEditor(card, options);
            };

            row.appendChild(checkbox);
            row.appendChild(textInput);
            row.appendChild(deleteBtn);
            servicesList.appendChild(row);
        });
    }

    const handleAddService = () => {
        const value = servicesItemInput.value.trim();
        if (!value) return;
        checklist.push({ text: value, checked: false });
        servicesItemInput.value = '';
        saveState();
        render();
        renderCardChecklistEditor(card, options);
        servicesItemInput.focus();
    };

    if(addServicesItemBtn) addServicesItemBtn.onclick = handleAddService;
    addServicesItemBtn.onmousedown = (e) => {
        e.preventDefault();
        handleAddService();
    };

    servicesItemInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddService();
        }
    };
}

// DOM Elements
const appContainer = document.getElementById('appContainer');

window.globalDeleteTargetId = null;
window.globalDeleteStepCount = 0;

window.promptSecureDelete = function(bId, bTitle) {
    if (boards.length <= 1) {
        alert("لا يمكنك حذف المساحة الوحيدة المتبقية.");
        return;
    }
    window.globalDeleteTargetId = bId;
    window.globalDeleteStepCount = 0;
    
    let dm = document.getElementById('secureDeleteModal');
    if (!dm) {
        dm = document.createElement('div');
        dm.id = 'secureDeleteModal';
        dm.className = 'modal-overlay';
        dm.innerHTML = `
            <div class="modal-content" style="text-align: center; max-width: 380px;">
                <div class="modal-header" style="justify-content: center; flex-direction: column; border-bottom: none; padding-bottom: 0;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <h3 style="color: #ef4444; font-size: 20px;">تأكيد مسح المساحة المتقدم</h3>
                    <p style="color: #4a5568; font-size: 14px; margin-top: 8px;">هل أنت متأكد أنك تريد حذف: <strong id="secureDeleteTitle" style="color: #172b4d;"></strong>؟</p>
                </div>
                <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
                    <div id="secureDeleteMsg" style="font-size: 13px; font-weight: 600; color: #1a202c; min-height: 44px; display: flex; align-items: center; justify-content: center; background: #fff5f5; padding: 4px; border-radius: 6px; border: 1px dashed #feb2b2;"></div>
                    <button id="secureDeleteBtn" style="background: #ef4444; color: #fff; padding: 14px; border-radius: 6px; border: none; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s; user-select: none; box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);">انقر هنا 3 مرات متتالية بالماوس للحذف</button>
                    <button onclick="document.getElementById('secureDeleteModal').classList.remove('active')" style="background: transparent; color: #718096; padding: 10px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; font-size: 13px; text-decoration: underline;">تراجع وإغلاق النافذة</button>
                </div>
            </div>
        `;
        document.body.appendChild(dm);
        
        const btn = document.getElementById('secureDeleteBtn');
        if(btn) btn.addEventListener('keydown', (e) => {
            e.preventDefault();
        });
        
        if(btn) btn.onclick = (e) => {
            if (e.detail === 0 || (e.clientX === 0 && e.clientY === 0) || !e.isTrusted) {
                return;
            }
            window.globalDeleteStepCount++;
            const msgEl = document.getElementById('secureDeleteMsg');
            if (window.globalDeleteStepCount === 1) {
                btn.style.background = '#dc2626';
                btn.style.transform = 'scale(0.98)';
                setTimeout(() => btn.style.transform = 'none', 100);
                msgEl.textContent = 'تأكيد 1/3: لا يمكن التراجع عن هذا الإجراء إطلاقا.';
                btn.textContent = 'انقر مرة أخرى (تبقت نقرتان بالماوس)';
            } else if (window.globalDeleteStepCount === 2) {
                btn.style.background = '#b91c1c';
                btn.style.transform = 'scale(0.96)';
                setTimeout(() => btn.style.transform = 'none', 100);
                msgEl.textContent = 'تأكيد 2/3: سيتم مسح جميع بيانات العميل و المنشورات تماماً.';
                btn.textContent = 'انقر للحذف النهائي والكامل';
            } else if (window.globalDeleteStepCount >= 3) {
                window.executeSecureDelete();
            }
        };
    }
    
    document.getElementById('secureDeleteTitle').textContent = bTitle || 'هذه المساحة';
    const msg = document.getElementById('secureDeleteMsg');
    msg.textContent = 'يتطلب الفحص الأمني 3 نقرات يدوية بالماوس لمنع الحذف بالخطأ من لوحة المفاتيح.';
    msg.style.color = '#c53030';
    
    const btn = document.getElementById('secureDeleteBtn');
    btn.style.background = '#ef4444';
    btn.textContent = 'انقر هنا 3 مرات بالماوس للحذف';
    
    dm.classList.add('active');
};

window.executeSecureDelete = function() {
    const targetBoard = boards.find(bd => bd.id === window.globalDeleteTargetId);
    boards = boards.filter(bd => bd.id !== window.globalDeleteTargetId);
    
    if (activeBoardId === window.globalDeleteTargetId) {
        const nextBoard = boards.find(b => targetBoard && b.type === targetBoard.type) || boards[0];
        activeBoardId = nextBoard ? nextBoard.id : null;
    }
    saveState();
    
    const dm = document.getElementById('secureDeleteModal');
    if (dm) dm.classList.remove('active');
    
    const cm = document.getElementById('switchBoardModal');
    if (cm) cm.classList.remove('active');
    
    if (typeof render === 'function') render();
    if (typeof showToast === 'function') showToast("تم مسح المساحة بالكامل بنجاح.");
};

const switchBoardModal = document.getElementById('switchBoardModal');
const boardListMenu = document.getElementById('boardListMenu');
const openSwitchBoardsBtn = document.getElementById('openSwitchBoardsBtn');
const closeSwitchBoardModal = document.getElementById('closeSwitchBoardModal');

const addBoardModal = document.getElementById('addBoardModal');
const closeAddBoardModal = document.getElementById('closeAddBoardModal');
const newBoardTitle = document.getElementById('newBoardTitle');
const confirmAddBoardBtn = document.getElementById('confirmAddBoardBtn');
const openAddTimerBoardBtn = document.getElementById('openAddTimerBoardBtn');
const openAddKanbanBoardBtn = document.getElementById('openAddKanbanBoardBtn');
const openAddSocialBoardBtn = document.getElementById('openAddSocialBoardBtn');
let pendingNewBoardType = 'timer';

const addCardModal = document.getElementById('addCardModal');
const closeAddModal = document.getElementById('closeAddModal');
const confirmAddBtn = document.getElementById('confirmAddBtn');
const newCardTitle = document.getElementById('newCardTitle');
const newCardDays = document.getElementById('newCardDays');
const newCardHours = document.getElementById('newCardHours');
const newCardMins = document.getElementById('newCardMins');

const timerModal = document.getElementById('modal');
const closeTimerModal = document.getElementById('closeModal');
const modalTitle = document.getElementById('modalTitle');
const saveTimerBtn = document.getElementById('saveTimerBtn');
const removeTimerBtn = document.getElementById('removeTimerBtn');
const deleteCardBtn = document.getElementById('deleteCardBtn');
const timerInputsSection = document.getElementById('timerInputsSection');

const inputDays = document.getElementById('inputDays');
const inputHours = document.getElementById('inputHours');
const inputMins = document.getElementById('inputMins');

[inputDays, inputHours, inputMins, newCardDays, newCardHours, newCardMins].forEach(input => {
    if (!input) return;
    if(input) input.addEventListener('focus', function() { if (this.value === '0') this.value = ''; });
    if(input) input.addEventListener('blur', function() { if (this.value === '') this.value = '0'; });
    input.addEventListener('input', function() {
        if (this.value.length > 1 && this.value.startsWith('0')) {
            this.value = parseInt(this.value, 10);
        }
    });
});

const toast = document.getElementById('toast');
const toggleNavPosBtn = document.getElementById('toggleNavPosBtn');
const topNavBar = document.querySelector('.top-nav-bar');

const trelloCardDetailsModal = document.getElementById('trelloCardDetailsModal');
const closeTrelloCardDetailsModalBtn = document.getElementById('closeTrelloCardDetailsModalBtn');
const trelloHistoryDisplayArea = document.getElementById('trelloHistoryDisplayArea');

if (closeTrelloCardDetailsModalBtn) {
    if(closeTrelloCardDetailsModalBtn) closeTrelloCardDetailsModalBtn.onclick = () => trelloCardDetailsModal.classList.remove('active');
}

// Trello Globals
let trelloKey = localStorage.getItem('trelloKey') || '';
let trelloToken = localStorage.getItem('trelloToken') || '';

// Trello Auth Modals & Logic
const trelloSettingsModal = document.getElementById('trelloSettingsModal');
const closeTrelloSettingsModal = document.getElementById('closeTrelloSettingsModal');
const trelloApiKeyInput = document.getElementById('trelloApiKey');
const trelloTokenInput = document.getElementById('trelloToken');
const fetchTrelloBoardsBtn = document.getElementById('fetchTrelloBoardsBtn');
const trelloBoardSelectGroup = document.getElementById('trelloBoardSelectGroup');
const trelloBoardSelect = document.getElementById('trelloBoardSelect');
const saveTrelloSettingsBtn = document.getElementById('saveTrelloSettingsBtn');

if (closeTrelloSettingsModal) {
    if(closeTrelloSettingsModal) closeTrelloSettingsModal.onclick = () => trelloSettingsModal.classList.remove('active');
}

function openTrelloSettingsModal() {
    trelloApiKeyInput.value = localStorage.getItem('trelloKey') || '';
    trelloTokenInput.value = localStorage.getItem('trelloToken') || '';
    
    trelloBoardSelectGroup.style.display = 'none';
    trelloBoardSelect.innerHTML = '';
    
    trelloSettingsModal.classList.add('active');
}

if (fetchTrelloBoardsBtn) {
    if(fetchTrelloBoardsBtn) fetchTrelloBoardsBtn.onclick = async () => {
        const key = trelloApiKeyInput.value.trim();
        const token = trelloTokenInput.value.trim();
        if(!key || !token) {
            showToast("Enter both Key and Token first");
            return;
        }
        
        const btnText = fetchTrelloBoardsBtn.textContent;
        fetchTrelloBoardsBtn.textContent = "Fetching...";
        
        try {
            const res = await fetch(`https://api.trello.com/1/members/me/boards?fields=name,url&key=${key}&token=${token}`);
            if(!res.ok) throw new Error("Invalid credentials");
            const fetchedBoards = await res.json();
            
            trelloBoardSelect.innerHTML = '<option value="">-- Choose a Board to Link --</option>';
            fetchedBoards.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                const curBoard = boards.find(b2 => b2.id === activeBoardId);
                if(curBoard && curBoard.trelloBoardId === b.id) opt.selected = true;
                trelloBoardSelect.appendChild(opt);
            });
            
            trelloBoardSelectGroup.style.display = 'block';
        } catch (err) {
            showToast("Failed to connect to Trello API");
        } finally {
            fetchTrelloBoardsBtn.textContent = btnText;
        }
    };
}

window.handleToggleReorder = function(e, listId, edge, targetType) {
    const transferTypeObj = Array.from(e.dataTransfer.types).find(t => t.startsWith('application/x-transfer-'));
    if (!transferTypeObj) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    let sourceTrackerRaw = transferTypeObj.replace('application/x-transfer-', '');
    const map = { 'ch': 'clientHappiness', 'ms': 'moneySmelling', 'nc': 'newClients', 'pd': 'pipedrive', 'trello': 'trello', 'trello-speech': 'trelloSpeech', 'ads': 'ads' };
    const sourceTracker = map[sourceTrackerRaw];
    
    if (!sourceTracker || sourceTracker === targetType) return;
    
    const activeBoard = boards && typeof activeBoardId !== 'undefined' ? boards.find(b => b.id === activeBoardId) : null;
    if (!activeBoard) return;
    
    const list = activeBoard.lists.find(l => l.id === listId);
    if (!list) return;
    
    list.edgeOrder = list.edgeOrder || {};
    let curOrder = list.edgeOrder[edge] || ['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads'];
    
    const oldIdx = curOrder.indexOf(sourceTracker);
    const newIdx = curOrder.indexOf(targetType);
    
    if (oldIdx !== -1) curOrder.splice(oldIdx, 1);
    if (newIdx !== -1) {
        curOrder.splice(newIdx, 0, sourceTracker);
    } else {
        curOrder.push(sourceTracker);
    }
    
    list.edgeOrder[edge] = curOrder;
    if (typeof saveState === 'function') saveState();
    if (typeof render === 'function') render();
};

window.openTrelloCardDetailsModal = async function(cardId, listId) {
    if (!trelloKey || !trelloToken) {
        showToast("Please set up your Trello API credentials first!");
        const trelloSettingsModal = document.getElementById('trelloSettingsModal');
        if (trelloSettingsModal) trelloSettingsModal.classList.add('active');
        return;
    }
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard) return;
    
    const titleInput = document.getElementById('trelloCardTitleInput');
    const descInput = document.getElementById('trelloCardDescInput');
    const saveBtn = document.getElementById('trelloCardSaveBtn');
    const statusMsg = document.getElementById('trelloCardSaveStatus');
    const historySection = document.getElementById('trelloHistorySection');
    const historyArea = document.getElementById('trelloHistoryDisplayArea');
    
    const adsMetricsSection = document.getElementById('adsMetricsSection');
    const adsMetricSpend = document.getElementById('adsMetricSpend');
    const adsMetricRoas = document.getElementById('adsMetricRoas');
    const adsMetricCpa = document.getElementById('adsMetricCpa');
    const adsMetricConversions = document.getElementById('adsMetricConversions');
    const adsMetricStatus = document.getElementById('adsMetricStatus');
    const adsMetricPlatform = document.getElementById('adsMetricPlatform');
    
    titleInput.value = '';
    titleInput.placeholder = 'Loading title...';
    titleInput.disabled = true;
    
    descInput.value = '';
    descInput.placeholder = 'Loading description...';
    descInput.disabled = true;
    
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    statusMsg.style.opacity = '0';
    
    const targetLocalCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
    const targetLocalList = activeBoard.lists.find(l => l.id === listId);
    const isAdsTracker = targetLocalList && targetLocalList.trackerType === 'ads';
    
    if (adsMetricsSection) {
        if (isAdsTracker) {
            adsMetricsSection.style.display = 'block';
            const m = targetLocalCard && targetLocalCard.adsMetrics ? targetLocalCard.adsMetrics : {};
            if (adsMetricSpend) adsMetricSpend.value = m.spend !== undefined ? m.spend : '';
            if (adsMetricRoas) adsMetricRoas.value = m.roas !== undefined ? m.roas : '';
            if (adsMetricCpa) adsMetricCpa.value = m.cpa !== undefined ? m.cpa : '';
            if (adsMetricConversions) adsMetricConversions.value = m.conversions !== undefined ? m.conversions : '';
            if (adsMetricStatus) adsMetricStatus.value = m.status || '';
            if (adsMetricPlatform) adsMetricPlatform.value = m.platform || '';
            
            const saveAdsMetrics = () => {
                const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
                if (liveCard) {
                    liveCard.adsMetrics = {
                        spend: adsMetricSpend && adsMetricSpend.value !== '' ? parseFloat(adsMetricSpend.value) : undefined,
                        roas: adsMetricRoas && adsMetricRoas.value !== '' ? parseFloat(adsMetricRoas.value) : undefined,
                        cpa: adsMetricCpa && adsMetricCpa.value !== '' ? parseFloat(adsMetricCpa.value) : undefined,
                        conversions: adsMetricConversions && adsMetricConversions.value !== '' ? parseInt(adsMetricConversions.value, 10) : undefined,
                        status: adsMetricStatus ? adsMetricStatus.value : '',
                        platform: adsMetricPlatform ? adsMetricPlatform.value : ''
                    };
                    saveState();
                    if (typeof render === 'function') render();
                }
            };

            if (adsMetricSpend) adsMetricSpend.oninput = saveAdsMetrics;
            if (adsMetricRoas) adsMetricRoas.oninput = saveAdsMetrics;
            if (adsMetricCpa) adsMetricCpa.oninput = saveAdsMetrics;
            if (adsMetricConversions) adsMetricConversions.oninput = saveAdsMetrics;
            if (adsMetricStatus) adsMetricStatus.onchange = saveAdsMetrics;
            if (adsMetricPlatform) adsMetricPlatform.onchange = saveAdsMetrics;

        } else {
            adsMetricsSection.style.display = 'none';
        }
    }
    
    const deleteBtn = document.getElementById('trelloCardDeleteBtn');
    if (deleteBtn) {
        deleteBtn.textContent = 'Delete Task from Trello';
        deleteBtn.disabled = false;
    }
    
    const btnRed = document.getElementById('trelloActionColorRedBtn');
    const btnGreen = document.getElementById('trelloActionColorGreenBtn');
    const btnYellow = document.getElementById('trelloActionColorYellowBtn');
    const btnOrange = document.getElementById('trelloActionColorOrangeBtn');
    const btnClear = document.getElementById('trelloActionColorClearBtn');
    
    if (btnRed) {
        if(btnRed) btnRed.onclick = () => { 
            const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
            if(liveCard) { liveCard.color = 'red'; saveState(); render(); showToast("Card marked as Hot"); }
        };
    }
    if (btnGreen) {
        if(btnGreen) btnGreen.onclick = () => { 
            const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
            if(liveCard) { liveCard.color = 'green'; saveState(); render(); showToast("Card marked as Ready"); }
        };
    }
    if (btnYellow) {
        if(btnYellow) btnYellow.onclick = () => { 
            const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
            if(liveCard) { liveCard.color = 'yellow'; saveState(); render(); showToast("Card marked as Neutral"); }
        };
    }
    if (btnOrange) {
        if(btnOrange) btnOrange.onclick = () => { 
            const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
            if(liveCard) { liveCard.color = 'orange'; saveState(); render(); showToast("Card marked as Sad"); }
        };
    }
    if (btnClear) {
        if(btnClear) btnClear.onclick = () => { 
            const liveCard = activeBoard.lists.flatMap(l => l.cards).find(c => c.id === cardId);
            if(liveCard) { delete liveCard.color; saveState(); render(); showToast("Card color cleared"); }
        };
    }
    
    const record = activeBoard.telemetry ? activeBoard.telemetry[cardId] : null;
    
    if (record) {
        historySection.style.display = 'block';
        const currentList = activeBoard.lists.find(l => l.id === listId);
        
        let combinedHistory = record.history ? [...record.history] : [];
        let currentListName = "Unknown List";
        if (currentList) {
            currentListName = currentList.title;
        } else {
            const foundMapped = activeBoard.lists.find(l => l.trelloListId === record.listId);
            if (foundMapped) currentListName = foundMapped.title;
        }
        
        const currentDurationMs = Date.now() - record.startTime;
        combinedHistory.push({
            listId: record.listId,
            listName: currentListName,
            durationMs: currentDurationMs,
            isActive: true
        });
        
        combinedHistory.forEach(h => {
            if (h.listId) {
                const mappedList = activeBoard.lists.find(l => l.trelloListId === h.listId);
                if (mappedList) {
                    h.listName = mappedList.title;
                }
            }
        });
        
        const aggregates = {};
        combinedHistory.forEach(h => {
            if (!aggregates[h.listName]) aggregates[h.listName] = 0;
            aggregates[h.listName] += h.durationMs;
        });
        
        let html = `<div style="font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--secondary-text); margin-bottom: 12px; border-bottom: 2px solid #f4f5f7; padding-bottom: 8px;">Aggregate Total Time</div>`;
        html += `<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 32px;">`;
        
        const sortedAggregates = Object.keys(aggregates).map(listName => {
            return { listName, totalMs: aggregates[listName] };
        }).sort((a, b) => b.totalMs - a.totalMs);

        sortedAggregates.forEach((item, index) => {
            const listName = item.listName;
            const totalMs = item.totalMs;

            const totalSecs = Math.floor(totalMs / 1000);
            const m = Math.floor(totalSecs / 60);
            const h = Math.floor(m / 60);
            const d = Math.floor(h / 24);
            
            let timeStr = '';
            if (d > 0) timeStr += `${d}d `;
            if (h > 0 || d > 0) timeStr += `${h % 24}h `;
            timeStr += `${m % 60}m`;
            if (d === 0 && h === 0 && m === 0) timeStr = '< 1m';
            
            const cardHtml = `
                <div style="background: white; border: 1px solid #dfe1e6; border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-size: 12px; color: var(--secondary-text); font-weight: 500;">${listName}</div>
                    <div style="font-size: 16px; font-weight: 700; color: #0c66e4;">${timeStr}</div>
                </div>
            `;

            if (index < 3) {
                html += cardHtml;
            } else if (index === 3) {
                html += `<div id="extra-aggregates" style="display: none; flex-direction: column; gap: 8px;">`;
                html += cardHtml;
            } else {
                html += cardHtml;
            }
        });

        if (sortedAggregates.length > 3) {
            html += `</div>`;
            html += `<button onclick="document.getElementById('extra-aggregates').style.display='flex'; this.style.display='none';" style="margin-top: 4px; padding: 8px; border: 1px solid #dfe1e6; border-radius: 6px; background: #fafbfc; cursor: pointer; font-weight: 600; font-size: 12px; color: #0c66e4; transition: background 0.2s; width: 100%;" onmouseover="this.style.background='#f4f5f7'" onmouseout="this.style.background='#fafbfc'">Show more</button>`;
        }
        
        html += `</div>`;
        
        html += `<div style="font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--secondary-text); margin-bottom: 16px; border-bottom: 2px solid #f4f5f7; padding-bottom: 8px;">Chronological Timeline Path</div>`;
        html += `<div style="position: relative; padding-left: 14px; margin-top: 20px;">`;
        html += `<div style="position: absolute; left: 19px; top: 10px; bottom: 20px; width: 2px; background: #dfe1e6;"></div>`;
        
        combinedHistory.slice().reverse().forEach((h, idx) => {
            const isLast = idx === combinedHistory.length - 1;
            const totalSecs = Math.floor(h.durationMs / 1000);
            const m = Math.floor(totalSecs / 60);
            const hr = Math.floor(m / 60);
            const d = Math.floor(hr / 24);
            
            let timeStr = '';
            if (d > 0) timeStr += `${d}d `;
            if (hr > 0 || d > 0) timeStr += `${hr % 24}h `;
            timeStr += `${m % 60}m`;
            if (d === 0 && hr === 0 && m === 0) timeStr = '< 1m';
            
            const dotColor = h.isActive ? '#0c66e4' : '#8590a2';
            const textColor = h.isActive ? 'var(--text-color)' : 'var(--secondary-text)';
            
            html += `
                <div style="position: relative; padding-left: 32px; margin-bottom: ${isLast ? '0' : '28px'};">
                    <div style="position: absolute; left: -1px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: ${dotColor}; box-shadow: 0 0 0 4px white, 0 0 0 5px rgba(0,0,0,0.06);"></div>
                    <div style="font-size: 15px; font-weight: 600; color: ${textColor}; margin-bottom: 6px;">${h.listName}</div>
                    <div style="display: inline-flex; align-items: center; background: ${h.isActive ? 'rgba(12,102,228,0.08)' : '#f4f5f7'}; color: ${h.isActive ? '#0c66e4' : '#44546f'}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        ${timeStr} ${h.isActive ? '<span style="margin-left:6px;">• Active Now</span>' : ''}
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        historyArea.innerHTML = html;
        
    } else {
        historySection.style.display = 'none';
        historyArea.innerHTML = '';
    }
    
    trelloCardDetailsModal.classList.add('active');
    
    try {
        const res = await fetch(`https://api.trello.com/1/cards/${cardId}?fields=name,desc&key=${trelloKey}&token=${trelloToken}`);
        if (!res.ok) throw new Error("Failed to fetch card details");
        const cardData = await res.json();
        
        titleInput.value = cardData.name;
        descInput.value = cardData.desc || '';
        
        titleInput.disabled = false;
        descInput.disabled = false;
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        
        const previewArea = document.getElementById('trelloCardDescPreviewArea');
        const renderImagePreviews = () => {
            if (!previewArea) return;
            const val = descInput.value || '';
            const regex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
            let match;
            const images = [];
            while ((match = regex.exec(val)) !== null) {
                images.push(match[1]);
            }
            
            if (images.length === 0) {
                previewArea.innerHTML = '';
                return;
            }
            
            const trKey = localStorage.getItem('trelloKey');
            const trToken = localStorage.getItem('trelloToken');
            
            let html = '<label style="font-size: 11px; font-weight: 700; color: var(--secondary-color); margin-bottom: 4px; display: block; text-transform: uppercase;">Image Previews</label>';
            html += '<div style="display:flex; flex-direction:column; gap:8px;">';
            images.forEach(url => {
                const authenticatedUrl = url.includes('?') ? `${url}&key=${trKey}&token=${trToken}` : `${url}?key=${trKey}&token=${trToken}`;
                html += `<img src="${authenticatedUrl}" style="width: 100%; border-radius: 6px; border: 1px solid #dfe1e6; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" />`;
            });
            html += '</div>';
            previewArea.innerHTML = html;
        };
        
        descInput.oninput = renderImagePreviews;
        renderImagePreviews();
        
        const handleImageUpload = async (file) => {
            if (!file || !file.type.startsWith('image/')) return;
            
            const cursor = descInput.selectionStart || descInput.value.length;
            const uploadingText = `\n![Uploading ${file.name}...]()\n`;
            const oldVal = descInput.value;
            descInput.value = oldVal.slice(0, cursor) + uploadingText + oldVal.slice(cursor);
            renderImagePreviews();
            
            try {
                const formData = new FormData();
                formData.append('key', trelloKey);
                formData.append('token', trelloToken);
                formData.append('file', file);
                formData.append('name', file.name);
                
                const uploadRes = await fetch(`https://api.trello.com/1/cards/${cardId}/attachments`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!uploadRes.ok) throw new Error('Upload failed');
                const data = await uploadRes.json();
                
                descInput.value = descInput.value.replace(uploadingText, `\n![${file.name}](${data.url})\n`);
                renderImagePreviews();
                showToast("Image attached to Trello!");
            } catch (e) {
                console.error("Trello Image Upload Error", e);
                showToast("Failed to upload image. File might be too large.");
                descInput.value = descInput.value.replace(uploadingText, '');
                renderImagePreviews();
            }
        };

        descInput.onpaste = (e) => {
            if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                e.preventDefault();
                handleImageUpload(e.clipboardData.files[0]);
            }
        };
        
        descInput.ondragover = (e) => {
            e.preventDefault();
            descInput.style.backgroundColor = 'rgba(12,102,228,0.05)';
        };
        
        descInput.ondragleave = (e) => {
            e.preventDefault();
            descInput.style.backgroundColor = '';
        };
        
        descInput.ondrop = (e) => {
            e.preventDefault();
            descInput.style.backgroundColor = '';
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleImageUpload(e.dataTransfer.files[0]);
            }
        };
        
        if(saveBtn) saveBtn.onclick = async () => {
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;
            statusMsg.style.opacity = '0';
            
            try {
                const putRes = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${trelloKey}&token=${trelloToken}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: titleInput.value.trim(),
                        desc: descInput.value.trim()
                    })
                });
                
                if (!putRes.ok) throw new Error("Failed to update Trello");
                
                statusMsg.style.opacity = '1';
                
                const allLists = activeBoard.lists;
                allLists.forEach(l => {
                    const cMatch = l.cards.find(c => c.id === cardId);
                    if (cMatch) {
                        cMatch.title = titleInput.value.trim();
                    }
                });
                
                saveState();
                render();
                
                setTimeout(() => {
                    trelloCardDetailsModal.classList.remove('active');
                }, 1000);
            } catch (err) {
                showToast("Failed to save changes to Trello");
            } finally {
                saveBtn.textContent = 'Save to Trello';
                saveBtn.disabled = false;
            }
        };
        
        const deleteBtn = document.getElementById('trelloCardDeleteBtn');
        if (deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.textContent = 'Delete Card from Trello';
            if(deleteBtn) deleteBtn.onclick = async () => {
                if (!confirm("Are you sure you want to permanently delete this card from Trello?")) return;
                
                const originalText = deleteBtn.textContent;
                deleteBtn.textContent = 'Deleting...';
                deleteBtn.disabled = true;
                
                try {
                    const delRes = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${trelloKey}&token=${trelloToken}`, {
                        method: 'DELETE'
                    });
                    
                    window.isMetricsFadingIn = true;
                    saveState();
                    
                    if (!delRes.ok) throw new Error("Failed to delete from Trello");
                    
                    activeBoard.lists.forEach(l => {
                        l.cards = l.cards.filter(c => c.id !== cardId);
                    });
                    
                    saveState();
                    render();
                    
                    trelloCardDetailsModal.classList.remove('active');
                } catch (err) {
                    showToast("Failed to delete task from Trello");
                    deleteBtn.textContent = originalText;
                    deleteBtn.disabled = false;
                }
            };
        }
        

    } catch (err) {
        showToast("Error loading Trello card details");
        trelloCardDetailsModal.classList.remove('active');
    }
};

if (saveTrelloSettingsBtn) {
    if(saveTrelloSettingsBtn) saveTrelloSettingsBtn.onclick = () => {
        const key = trelloApiKeyInput.value.trim();
        const token = trelloTokenInput.value.trim();
        localStorage.setItem('trelloKey', key);
        localStorage.setItem('trelloToken', token);
        
        trelloKey = key;
        trelloToken = token;
        
        const curBoard = boards.find(b => b.id === activeBoardId);
        if (curBoard) {
            const selectedBoardId = trelloBoardSelect.value;
            if (selectedBoardId) {
                curBoard.trelloBoardId = selectedBoardId;
                curBoard.trelloBoardName = trelloBoardSelect.options[trelloBoardSelect.selectedIndex].text;
                showToast(`Linked to Trello!`);
            } else {
                curBoard.trelloBoardId = null;
                showToast("Saved Credentials");
            }
            saveState();
            render(); 
        }
        
        trelloSettingsModal.classList.remove('active');
    };
}

// Pipedrive Globals
let pipedriveDomain = localStorage.getItem('pipedriveDomain') || '';
let pipedriveToken = localStorage.getItem('pipedriveToken') || '';

const pipedriveSettingsModal = document.getElementById('pipedriveSettingsModal');
const closePipedriveSettingsModal = document.getElementById('closePipedriveSettingsModal');

// ==============================================================
// Global Optimization: Prevent native pinch-zoom lag in apps
// On Mac trackpads, pinch-zoom triggers wheel events with ctrlKey.
// Natively zooming a heavy grid causes paint freezing.
// ==============================================================
if(document) document.addEventListener('wheel', (e) => {
    if ((e.ctrlKey || e.metaKey) && document.querySelector('.social-scheduler-view')) {
        e.preventDefault();
    }
}, { passive: false });

// Social Media Scheduler Modals
const createPostModal = document.getElementById('createPostModal');
window.currentEditingSocialPostId = null;

window.smEscapeHTML = function(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};


window.showCustomConfirm = function(title, message, confirmText, cancelText, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.4)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.WebkitBackdropFilter = 'blur(4px)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease-out';
    overlay.style.direction = 'rtl';

    const modal = document.createElement('div');
    modal.style.background = '#ffffff';
    modal.style.borderRadius = '20px';
    modal.style.padding = '24px';
    modal.style.width = '90%';
    modal.style.maxWidth = '340px';
    modal.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
    modal.style.transform = 'scale(0.95) translateY(10px)';
    modal.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

    modal.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; background: #fee2e2; color: #ef4444; margin: 0 auto 16px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </div>
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 800; color: #0f172a; text-align: center;">${title}</h3>
        <p style="margin: 0 0 24px; font-size: 14px; color: #64748b; text-align: center; line-height: 1.6; font-weight: 500;">${message}</p>
        <div style="display: flex; gap: 12px;">
            <button id="sm-confirm-btn" style="flex: 1; padding: 10px; border: none; border-radius: 10px; background: #ef4444; color: white; font-size: 14px; font-weight: 700; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">${confirmText}</button>
            <button id="sm-cancel-btn" style="flex: 1; padding: 10px; border: 2px solid #e2e8f0; border-radius: 10px; background: transparent; color: #475569; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#f1f5f9'; this.style.borderColor='#cbd5e1';" onmouseout="this.style.background='transparent'; this.style.borderColor='#e2e8f0';">${cancelText}</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1) translateY(0)';
    });

    const close = () => {
        overlay.style.opacity = '0';
        modal.style.transform = 'scale(0.95) translateY(10px)';
        setTimeout(() => overlay.remove(), 300);
    };

    modal.querySelector('#sm-confirm-btn').onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };

    modal.querySelector('#sm-cancel-btn').onclick = close;
    if(overlay) overlay.onclick = (e) => {
        if (e.target === overlay) close();
    };
};

window.hideSpecialEvent = function(e, eventId) {
    e.stopPropagation();
    const eventEl = e.currentTarget.closest('[data-special-event="true"]');
    
    const boardKey = `hiddenSocialEvents_${activeBoardId || 'default'}`;
    let hidden = JSON.parse(localStorage.getItem(boardKey) || '[]');
    if (!hidden.includes(eventId)) {
        hidden.push(eventId);
        localStorage.setItem(boardKey, JSON.stringify(hidden));
    }
    if (eventEl) {
        eventEl.style.transition = 'all 0.3s ease';
        eventEl.style.opacity = '0';
        eventEl.style.transform = 'scale(0.8)';
        setTimeout(() => eventEl.remove(), 300);
    }
};

window.eventCategoryMap = {
    'عالمي': { bg: '#fff7ed', text: '#d97706', dot: '#f59e0b' },
    'اجتماعي': { bg: '#eff6ff', text: '#2563eb', dot: '#3b82f6' },
    'ثقافي': { bg: '#fdf2f8', text: '#db2777', dot: '#ec4899' },
    'صحي': { bg: '#ecfdf5', text: '#059669', dot: '#10b981' },
    'رياضي': { bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
    'بيئي': { bg: '#eef2ff', text: '#4f46e5', dot: '#6366f1' },
    'تجاري': { bg: '#fdf4ff', text: '#c026d3', dot: '#d946ef' },
    'تقني': { bg: '#f3e8ff', text: '#9333ea', dot: '#a855f7' },
    'ديني': { bg: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' }
};

window.specialAwarenessDays = [
    // January (m: 0)
    { m: 0, d: 1, name: "رأس السنة الميلادية", desc: "بداية العام الميلادي الجديد", category: "عالمي" },
    { m: 0, d: 4, name: "اليوم العالمي للغة برايل", desc: "للتوعية بأهمية لغة برايل للمكفوفين", category: "ثقافي" },
    { m: 0, d: 24, name: "اليوم الدولي للتعليم", desc: "الاحتفاء بدور التعليم في تحقيق السلام والتنمية", category: "ثقافي" },
    { m: 0, d: 26, name: "اليوم العالمي للجمارك", desc: "للإشادة بجهود رجال الجمارك حول العالم", category: "عالمي" },
    { m: 0, d: 28, name: "يوم الحد من انبعاثات الكربون", desc: "للتوعية بضرورة حماية البيئة وتقليل التلوث", category: "بيئي" },

    // February (m: 1)
    { m: 1, d: 4, name: "اليوم العالمي للسرطان", desc: "لرفع الوعي العالمي وتوحيد الجهود لمكافحة السرطان", category: "صحي" },
    { m: 1, d: 11, name: "المرأة في ميدان العلوم", desc: "المرأة والفتاة في ميدان العلوم والأبحاث", category: "ثقافي" },
    { m: 1, d: 13, name: "اليوم العالمي للإذاعة", desc: "للاحتفاء بدور الإذاعة المسموعة وإيصال المعلومات", category: "ثقافي" },
    { m: 1, d: 14, name: "عيد الحب", desc: "يوم للتعبير عن الحب والتقدير", category: "اجتماعي" },
    { m: 1, d: 20, name: "يوم العدالة الاجتماعية", desc: "لتعزيز مبادئ العدالة والمساواة في المجتمعات", category: "اجتماعي" },
    { m: 1, d: 21, name: "اليوم الدولي للغة الأم", desc: "للاحتفال بالتنوع اللغوي والثقافي", category: "ثقافي" },

    // March (m: 2)
    { m: 2, d: 1, name: "الدفاع المدني / صفر تمييز", desc: "يوم الدفاع المدني وتصفير التمييز بكافة أشكاله", category: "عالمي" },
    { m: 2, d: 3, name: "يوم الحياة البرية", desc: "للاحتفاء بتنوع النباتات والحيوانات البرية وحمايتها", category: "بيئي" },
    { m: 2, d: 8, name: "يوم المرأة العالمي", desc: "للاحتفال بإنجازات المرأة وحقوقها", category: "اجتماعي" },
    { m: 2, d: 15, name: "حقوق المستهلك", desc: "للتوعية بحقوق المستهلكين وحمايتها", category: "تجاري" },
    { m: 2, d: 20, name: "يوم السعادة العالمي", desc: "للاعتراف بأهمية السعادة والرفاهية", category: "اجتماعي" },
    { m: 2, d: 21, name: "عيد الأم / يوم الشعر", desc: "تكريم للأمهات والاحتفاء بالشعر والشعراء", category: "اجتماعي" },
    { m: 2, d: 22, name: "يوم المياه العالمي", desc: "للفت الانتباه لأهمية المياه العذبة", category: "بيئي" },
    { m: 2, d: 27, name: "يوم المسرح العالمي", desc: "لإبراز أهمية الفنون المسرحية", category: "ثقافي" },

    // April (m: 3)
    { m: 3, d: 1, name: "كذبة أبريل / يوم المرح", desc: "يوم للمقالب والخدع والمرح في العمل", category: "عالمي" },
    { m: 3, d: 2, name: "يوم التوحد / كتاب الطفل", desc: "للتوعية بالتوحد والتشجيع على قراءة كتب الأطفال", category: "صحي" },
    { m: 3, d: 4, name: "يوم المخطوطات العربية", desc: "للاحتفاء بالتراث المخطوط وحفظه", category: "ثقافي" },
    { m: 3, d: 5, name: "اليوم العالمي للضمير", desc: "لترسيخ ثقافة السلام والوعي", category: "عالمي" },
    { m: 3, d: 6, name: "الرياضة للتنمية والسلام", desc: "استخدام الرياضة لتوحيد الشعوب", category: "رياضي" },
    { m: 3, d: 7, name: "يوم الصحة العالمي", desc: "يسلط الضوء على القضايا الصحية العالمية الكبرى", category: "صحي" },
    { m: 3, d: 15, name: "يوم الفن العالمي", desc: "للترويج لتطور الوعي الفني", category: "ثقافي" },
    { m: 3, d: 18, name: "يوم التراث العالمي", desc: "للحفاظ على التراث الإنساني ومواقع التراث", category: "ثقافي" },
    { m: 3, d: 20, name: "اليوم العالمي للغة الصينية", desc: "للاحتفاء باللغة الصينية وتاريخها", category: "ثقافي" },
    { m: 3, d: 21, name: "يوم الإبداع والابتكار", desc: "لتشجيع التفكير الابتكاري وحل المشكلات", category: "عالمي" },
    { m: 3, d: 22, name: "يوم الأرض", desc: "لزيادة الوعي بالقضايا البيئية والكوكبية", category: "بيئي" },
    { m: 3, d: 23, name: "اليوم العالمي للكتاب", desc: "للتشجيع على القراءة وحماية حقوق المؤلفين", category: "ثقافي" },
    { m: 3, d: 23, name: "يوم اللغة الإنجليزية والإسبانية", desc: "اليوم العالمي للغة الإنجليزية والإسبانية", category: "ثقافي" },
    { m: 3, d: 25, name: "اليوم العالمي للملاريا", desc: "للتعريف بجهود مكافحة الملاريا", category: "صحي" },
    { m: 3, d: 26, name: "يوم الملكية الفكرية", desc: "للتوعية بأهمية حماية حقوق الإبداع والابتكار", category: "تجاري" },
    { m: 3, d: 28, name: "السلامة والصحة في العمل", desc: "لزيادة الوعي بالسلامة المهنية", category: "صحي" },
    { m: 3, d: 29, name: "يوم الرقص العالمي", desc: "للاحتفال بفن الرقص", category: "ثقافي" },
    { m: 3, d: 30, name: "يوم موسيقى الجاز", desc: "تسليط الضوء على هذه الموسيقى وتاريخها", category: "ثقافي" },

    // May (m: 4)
    { m: 4, d: 1, name: "يوم العمال العالمي / شهر التوعية بالسيلياك", desc: "احتفال عالمي بالعمال وشهر التوعية بالسيلياك", category: "اجتماعي" },
    { m: 4, d: 3, name: "يوم حرية الصحافة", desc: "لتقييم حالة حرية الصحافة حول العالم", category: "ثقافي" },
    { m: 4, d: 4, name: "يوم الضحك العالمي", desc: "يوم الضحك العالمي", category: "عالمي" },
    { m: 4, d: 5, name: "اليوم العالمي للربو", desc: "اليوم العالمي للربو", category: "صحي" },
    { m: 4, d: 8, name: "يوم الصليب والهلال الأحمر", desc: "لتقدير جهود العاملين في الإغاثة", category: "صحي" },
    { m: 4, d: 12, name: "اليوم العالمي للتمريض", desc: "تقدير وتكريم الكوادر التمريضية", category: "صحي" },
    { m: 4, d: 15, name: "اليوم العالمي للأسر", desc: "اليوم العالمي للأسر", category: "اجتماعي" },
    { m: 4, d: 16, name: "يوم الضوء العالمي", desc: "يوم الضوء العالمي", category: "تقني" },
    { m: 4, d: 17, name: "يوم الاتصالات / اليوم العالمي لارتفاع ضغط الدم", desc: "يوم الاتصالات / اليوم العالمي لارتفاع ضغط الدم", category: "تقني" },
    { m: 4, d: 18, name: "اليوم العالمي للمتاحف", desc: "اليوم العالمي للمتاحف", category: "ثقافي" },
    { m: 4, d: 20, name: "اليوم العالمي للنحل", desc: "للتوعية بأهمية الملقحات", category: "بيئي" },
    { m: 4, d: 21, name: "التنوع الثقافي", desc: "لحوار الحضارات وتقبل الآخر", category: "ثقافي" },
    { m: 4, d: 31, name: "الامتناع عن التدخين", desc: "يوم التوعية بأضرار التبغ", category: "صحي" },

    // June (m: 5)
    { m: 5, d: 1, name: "اليوم العالمي للحليب / اليوم العالمي للوالدين", desc: "لتكريم الآباء والحث على التغذية السليمة", category: "اجتماعي" },
    { m: 5, d: 3, name: "اليوم العالمي للدراجات الهوائية", desc: "للتشجيع على استخدام وسائل نقل صحية", category: "رياضي" },
    { m: 5, d: 5, name: "اليوم العالمي للبيئة", desc: "للتوعية وحماية بيئتنا", category: "بيئي" },
    { m: 5, d: 7, name: "اليوم العالمي لسلامة الأغذية", desc: "لتسليط الضوء على سلامة الغذاء والصحة", category: "صحي" },
    { m: 5, d: 8, name: "اليوم العالمي للمحيطات", desc: "لحماية المسطحات المائية والمحيطات", category: "بيئي" },
    { m: 5, d: 12, name: "اليوم العالمي لمكافحة عمل الأطفال", desc: "لتسليط الضوء على حقوق ومصلحة الأطفال", category: "اجتماعي" },
    { m: 5, d: 14, name: "اليوم العالمي للمتبرعين بالدم", desc: "لشكر المتبرعين بالدم والتوعية بأهمية التبرع", category: "صحي" },
    { m: 5, d: 15, name: "التوعية بشأن إساءة معاملة كبار السن", desc: "لتعزيز بيئة آمنة وراعية لكبار السن", category: "اجتماعي" },
    { m: 5, d: 16, name: "بداية السنة الهجرية 1448هـ", desc: "بداية السنة الهجرية 1448هـ", category: "ديني" },
    { m: 5, d: 17, name: "يوم مكافحة التصحر والجفاف", desc: "للعمل على حماية الأراضي من الجفاف", category: "بيئي" },
    { m: 5, d: 18, name: "يوم فن الطبخ المستدام", desc: "دعم الطبخ المحلي والعادات الغذائية السليمة", category: "ثقافي" },
    { m: 5, d: 18, name: "اليوم العالمي للسوشي", desc: "اليوم العالمي للسوشي والتسويق للمطاعم", category: "تجاري" },
    { m: 5, d: 20, name: "يوم اللاجئ العالمي", desc: "لدعم حقوق اللاجئين وتفهم معاناتهم", category: "اجتماعي" },
    { m: 5, d: 21, name: "يوم الأب / اليوم العالمي للموسيقى / ذكرى مبايعة ولي العهد (ميلادي)", desc: "ذكرى مبايعة ولي العهد ويوم الأب العالمي", category: "اجتماعي" },
    { m: 5, d: 23, name: "يوم الخدمة العامة", desc: "للإشادة بالموظفين ودورهم في الخدمة العامة", category: "عالمي" },
    { m: 5, d: 23, name: "اليوم الأولمبي للجري", desc: "التشجيع على الممارسة والنشاط الرياضي", category: "رياضي" },
    { m: 5, d: 25, name: "يوم البحارة", desc: "لتسليط الضوء على إسهامات البحارة", category: "عالمي" },
    { m: 5, d: 26, name: "يوم مكافحة إساءة استعمال المخدرات", desc: "لمكافحة المخدرات وحماية الشباب", category: "صحي" },
    { m: 5, d: 27, name: "يوم المؤسسات المتناهية الصغر والصغيرة", desc: "لدعم المشاريع التجارية والمؤسسات المتوسطة", category: "تجاري" },
    { m: 5, d: 30, name: "العمل البرلماني", desc: "للاحتفال بالبرلمانات ودورها", category: "عالمي" },

    // July (m: 6)
    { m: 6, d: 11, name: "يوم السكان العالمي", desc: "للاهتمام بقضايا النمو السكاني", category: "عالمي" },
    { m: 6, d: 15, name: "مهارات الشباب", desc: "لتمكين الشباب للعمل", category: "اجتماعي" },
    { m: 6, d: 17, name: "يوم الإيموجي", desc: "للاحتفال بالرموز التعبيرية الرقمية الممتعة", category: "تجاري" },
    { m: 6, d: 18, name: "يوم نيلسون مانديلا", desc: "استذكار لجهود ومبادئ مانديلا", category: "عالمي" },
    { m: 6, d: 20, name: "يوم الشطرنج", desc: "للاحتفاء برياضة الشطرنج الذهنية", category: "ثقافي" },
    { m: 6, d: 28, name: "يوم التهاب الكبد", desc: "للتوعية بهذا المرض والوقاية منه", category: "صحي" },
    { m: 6, d: 30, name: "يوم الصداقة العالمي", desc: "للاحتفال بالصداقة كمبادرة للسلام", category: "اجتماعي" },

    // August (m: 7)
    { m: 7, d: 9, name: "يوم الشعوب الأصلية", desc: "للاحتفاء بثقافات الشعوب المتبقية", category: "ثقافي" },
    { m: 7, d: 12, name: "يوم الشباب الدولي", desc: "للتوعية بقضايا الشباب وتمكينهم", category: "اجتماعي" },
    { m: 7, d: 19, name: "العمل الإنساني / التصوير", desc: "لتقدير العاملين في المجال الإنساني وعالم التصوير", category: "عالمي" },
    { m: 7, d: 29, name: "مكافحة التجارب النووية", desc: "لحظر ووقف التجارب النووية", category: "عالمي" },

    // September (m: 8)
    { m: 8, d: 5, name: "العمل الخيري", desc: "لتشجيع العمل التطوعي والخيري", category: "اجتماعي" },
    { m: 8, d: 8, name: "يوم محو الأمية", desc: "للحد من الأمية حول العالم", category: "ثقافي" },
    { m: 8, d: 15, name: "يوم الديمقراطية", desc: "للاحتفاء بمبادئ الديمقراطية والتعبير", category: "عالمي" },
    { m: 8, d: 16, name: "حفظ طبقة الأوزون", desc: "للتوعية بأهمية الغلاف الجوي", category: "بيئي" },
    { m: 8, d: 21, name: "يوم السلام", desc: "للترويج لإنهاء الصراعات", category: "عالمي" },
    { m: 8, d: 23, name: "اليوم الوطني السعودي", desc: "احتفال المملكة العربية السعودية بتوحيدها", category: "عالمي", dot: '#006c35', bg: '#e0f2e9', text: '#006c35' },
    { m: 8, d: 27, name: "يوم السياحة العالمي", desc: "لتسليط الضوء على أهمية القطاع السياحي", category: "عالمي" },
    { m: 8, d: 29, name: "يوم القلب العالمي", desc: "للتوعية بأمراض القلب وأهمية صحته", category: "صحي" },
    { m: 8, d: 30, name: "يوم الترجمة العالمي", desc: "للاحتفاء بالترجمة وحوار الحضارات", category: "ثقافي" },

    // October (m: 9)
    { m: 9, d: 1, name: "القهوة / المسنين", desc: "للاحتفاء بعشاق القهوة وتقدير كبار السن", category: "تجاري" },
    { m: 9, d: 2, name: "يوم اللاعنف", desc: "لترسيخ ثقافة السلام بعيداً عن التعنيف", category: "عالمي" },
    { m: 9, d: 5, name: "يوم المعلم العالمي", desc: "لتكريم وتقدير المعلمين ودورهم", category: "ثقافي" },
    { m: 9, d: 9, name: "يوم البريد العالمي", desc: "توعية حول أثر خدمات البريد", category: "عالمي" },
    { m: 9, d: 10, name: "الصحة النفسية", desc: "للتوعية بأهمية الصحة العقلية", category: "صحي" },
    { m: 9, d: 11, name: "يوم الفتاة العالمي", desc: "للاعتراف بحقوق الفتيات والتحديات التي تواجههن", category: "اجتماعي" },
    { m: 9, d: 16, name: "يوم الأغذية العالمي", desc: "للحد من الجوع والأمن الغذائي", category: "صحي" },
    { m: 9, d: 17, name: "القضاء على الفقر", desc: "لدعم ومساندة من يعانون الفقرات", category: "اجتماعي" },
    { m: 9, d: 24, name: "يوم الأمم المتحدة", desc: "الاحتفال بذكرى تأسيس منظمة الأمم المتحدة", category: "عالمي" },
    { m: 9, d: 31, name: "اليوم العالمي للمدن", desc: "لتشجيع التوسع الحضري المستدام", category: "عالمي" },

    // November (m: 10)
    { m: 10, d: 1, name: "يوم النباتيين العالمي", desc: "لتشجيع النظم الغذائية النباتية", category: "صحي" },
    { m: 10, d: 10, name: "العلوم من أجل السلام", desc: "ربط العلم والتنمية بمساعي السلام", category: "عالمي" },
    { m: 10, d: 14, name: "يوم السكري العالمي", desc: "للتوعية بمرض السكري وطرق تجنبه", category: "صحي" },
    { m: 10, d: 16, name: "يوم التسامح", desc: "لترسيخ مفهوم التسامح بين الشعوب", category: "اجتماعي" },
    { m: 10, d: 19, name: "اليوم الدولي للرجل", desc: "للاعتراف بإسهامات الرجل وخاصة الصحية", category: "اجتماعي" },
    { m: 10, d: 20, name: "يوم الطفل العالمي", desc: "لتعزيز الترابط الدولي والتوعية بحقوق الأطفال", category: "اجتماعي" },
    { m: 10, d: 21, name: "يوم التلفزيون", desc: "لتقدير الأثر والتأثير المتلفز", category: "ثقافي" },

    // December (m: 11)
    { m: 11, d: 1, name: "اليوم العالمي للإيدز", desc: "للتوعية بمرض نقص المناعة", category: "صحي" },
    { m: 11, d: 2, name: "إلغاء الرق", desc: "للتأكيد على القضاء على الاستعباد", category: "اجتماعي" },
    { m: 11, d: 3, name: "ذوي الإعاقة", desc: "لدعم دمج الأشخاص ذوي الإعاقة", category: "اجتماعي" },
    { m: 11, d: 5, name: "يوم المتطوعين", desc: "للإشادة بالمتطوعين وأعمالهم", category: "اجتماعي" },
    { m: 11, d: 9, name: "مكافحة الفساد", desc: "للتوعية بمخاطر الفساد وتعزيز النزاهة", category: "عالمي" },
    { m: 11, d: 10, name: "حقوق الإنسان", desc: "الاحتفاء بالإعلان العالمي لحقوق الإنسان", category: "عالمي" },
    { m: 11, d: 11, name: "اليوم الدولي للجبال", desc: "للتوعية بأهمية التنمية الجبلية", category: "بيئي" },
    { m: 11, d: 18, name: "اللغة العربية / المهاجرين", desc: "للاحتفاء بلغة الضاد، وللتوعية بحقوق المهاجرين", category: "ثقافي" },
    { m: 11, d: 20, name: "التضامن الإنساني", desc: "للوقوف جنباً إلى جنب كبشر", category: "اجتماعي" }
];

window.restoreMonthEvents = function(monthIndex) {
    const boardKey = `hiddenSocialEvents_${activeBoardId || 'default'}`;
    let hidden = JSON.parse(localStorage.getItem(boardKey) || '[]');
    const originalLength = hidden.length;
    hidden = hidden.filter(id => !id.startsWith(`${monthIndex}-`));
    if (hidden.length !== originalLength) {
        localStorage.setItem(boardKey, JSON.stringify(hidden));
        // Force a re-render to show them
        if (typeof render === 'function') render();
    }
};

window.hideAllMonthEvents = function(monthIndex) {
    const boardKey = `hiddenSocialEvents_${activeBoardId || 'default'}`;
    let hidden = JSON.parse(localStorage.getItem(boardKey) || '[]');
    
    const monthEvents = window.specialAwarenessDays.filter(e => e.m === monthIndex);
    
    let changed = false;
    monthEvents.forEach(e => {
        const eventId = `${e.m}-${e.d}`;
        if (!hidden.includes(eventId)) {
            hidden.push(eventId);
            changed = true;
        }
    });
    
    if (changed) {
        localStorage.setItem(boardKey, JSON.stringify(hidden));
        if (typeof render === 'function') render();
    }
};

window.openCreatePostModal = function(postId = null) {
    if (createPostModal) {
        window.currentEditingSocialPostId = postId;
        const textArea = document.querySelector('.sm-textarea');
        const publishToggles = createPostModal.querySelectorAll('.sm-toggle-btn');
        
        // Reset modal fields first
        if (textArea) textArea.value = '';
        if (window.clearMediaUpload) window.clearMediaUpload(); // clears gallery
        publishToggles.forEach(b => b.classList.remove('active'));
        const draftBtn = Array.from(publishToggles).find(b => b.textContent.trim() === 'مسودة');
        if (draftBtn) draftBtn.click();
        
        let targetOpt = window.activeSocialDateOptions;
        
        // Calculate and show post number indicator
        let postNum = 1;
        const activeBoard = boards.find(b => b.id === activeBoardId);
        if (activeBoard && activeBoard.cards && targetOpt) {
            const targetDateStr = `${targetOpt.year}-${targetOpt.month}-${targetOpt.date}`;
            const dayPosts = activeBoard.cards.filter(c => c.dateStr === targetDateStr);
            
            if (postId) {
                const idx = dayPosts.findIndex(c => c.id === postId);
                if (idx > -1) postNum = idx + 1;
            } else {
                postNum = dayPosts.length + 1;
            }
        }
        
        const indicator = document.getElementById('smActivePostIndicator');
        const numSpan = document.getElementById('smActivePostNum');
        if (indicator && numSpan) {
            numSpan.textContent = postNum;
            indicator.style.display = 'flex';
        }
        
        if (postId) {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            if (activeBoard && activeBoard.cards) {
                const post = activeBoard.cards.find(c => c.id === postId);
                if (post) {
                    if (textArea) textArea.value = post.fullText || post.description || '';
                    
                    // Manually inject gallery items safely
                    const mediaItems = post.mediaItems || (post.mediaObj ? [post.mediaObj] : []);
                    if (mediaItems.length > 0) {
                        const previewContainer = document.getElementById('smMediaPreviewContainer');
                        const uploadPrompt = document.getElementById('smUploadPrompt');
                        const gallery = document.getElementById('smMediaGallery');
                        
                        if (previewContainer && gallery) {
                            previewContainer.style.display = 'block';
                            gallery.innerHTML = ''; // Ensure clear
                            
                            mediaItems.forEach((mi, index) => {
                                const wrap = document.createElement('div');
                                wrap.style.cssText = 'flex-shrink: 0; width: 80px; height: 80px; border-radius: 8px; position: relative; background:#fff; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
                                
                                const delBtn = `<button style="position: absolute; top: 4px; right: 4px; z-index: 5; background: #ef4444; color: white; border-radius: 50%; width: 16px; height: 16px; border: none; font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; line-height: 1;" onclick="event.stopPropagation(); window.removeMediaItem(this)">×</button>`;
                                const badge = `<div class="sm-gallery-badge" style="position: absolute; top: 6px; left: 6px; z-index: 10; background: #f97316; color: white; border-radius: 50%; width: 22px; height: 22px; font-size: 11px; font-weight: bold; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">${index + 1}</div>`;
                                // For loaded dataUrls, estimate MB from base64 length or just use placeholder
                                const sizeMB = mi.dataUrl ? (mi.dataUrl.length * 0.75 / (1024 * 1024)).toFixed(2) : '0.10';
                                const sizeBadge = `<div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); z-index: 5; background: rgba(0,0,0,0.65); color: white; border-radius: 4px; padding: 2px 4px; font-size: 8px; white-space: nowrap;">MB ${sizeMB}</div>`;
                                
                                if (mi.type === 'frame-io') {
                                    wrap.className = 'frame-io-media';
                                    wrap.setAttribute('data-url', mi.url);
                                    if (mi.thumbnail) wrap.setAttribute('data-thumbnail', mi.thumbnail);
                                    if (mi.mediaType) wrap.setAttribute('data-media-type', mi.mediaType);
                                    if (mi.duration) wrap.setAttribute('data-duration', mi.duration);
                                    wrap.style.cssText = "position: relative; width: 100%; max-width: 160px; border-radius: 8px; overflow: hidden; border: 1px solid #edf2f7; background: #fff; display: flex; flex-direction: column; flex-shrink: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);";
                                    const placeholderId = 'frameIoPlaceholder-' + Date.now() + '-' + index;
                                    let isGoogleDrive = mi.url.includes('drive.google.com');
                                    let labelText = isGoogleDrive ? 'Google Drive' : 'Frame.io';
                                    
                                    if (isGoogleDrive) {
                                        visualContent = `<iframe src="${mi.url}" style="width: 100%; height: 100%; border: none; pointer-events: none; z-index:1;"></iframe>`;
                                    } else {
                                        if (mi.thumbnail) {
                                            visualContent = `<img src="${mi.thumbnail}" style="width: 100%; height: 100%; object-fit: contain; position: absolute; top:0; left:0; background: ${mi.thumbnail.includes('frame.io') ? '#f8fafc' : '#000'}; z-index: 1;">`;
                                        } else {
                                            visualContent = `<div style="width: 100%; height: 100%; position: absolute; top:0; left:0; background: #1e293b; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; z-index: 1;">لا توجد معاينة</div>`;
                                        }
                                    }
                                    
                                    wrap.innerHTML = `
                                        <div id="${placeholderId}-img" onclick="event.stopPropagation(); window.showFrameIoVideo(null, '${mi.url}', '${placeholderId}')" style="cursor: pointer; width: 100%; aspect-ratio: 9/16; background: #1e293b; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden;">
                                            ${badge}
                                            ${visualContent}
                                            <div onclick="window.toggleMediaType(this, '${placeholderId}', event)" style="cursor: pointer; position: absolute; bottom: 6px; left: 6px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 6px; z-index: 10; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.9)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.7)'; this.style.transform='scale(1)'">
                                                <span class="type-icon">${mi.mediaType === 'image' ? '🖼️ صورة' : '▶️ فيديو'}</span>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.7"><path d="M12 5v14M5 12h14"></path></svg>
                                            </div>
                                        </div>
                                        <div style="padding: 10px; background: #ffffff; display: flex; justify-content: center; border-top: 1px solid #edf2f7;">
                                            <button onclick="event.stopPropagation(); window.showFrameIoVideo(this, '${mi.url}', '${placeholderId}')" style="display:flex; align-items:center; justify-content:center; gap:6px; width: 100%; background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 8px 0; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                                                ${mi.mediaType === 'image' 
                                                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> عرض الصورة` 
                                                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> عرض الفيديو ${mi.duration ? '('+mi.duration+')' : ''}`
                                                }
                                            </button>
                                        </div>
                                        <button onclick="event.stopPropagation(); window.removeMediaItem(this.closest('.frame-io-media'))" style="position:absolute; top:6px; right:6px; width:22px; height:22px; border-radius:50%; background:rgba(255,255,255,0.95); border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#e53e3e; font-weight:bold; font-size:14px; box-shadow:0 1px 3px rgba(0,0,0,0.2); z-index:10; line-height: 1;">×</button>
                                    `;
                                } else {
                                    wrap.style.cssText = 'position: relative; width: 100%; max-width: 160px; border-radius: 8px; overflow: hidden; border: 1px solid #edf2f7; background: #fff; display: flex; flex-direction: column; flex-shrink: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';
                                    const mediaTypeLabel = mi.type === 'video' ? 'فيديو' : 'صورة';
                                    const mediaElem = mi.type === 'video' 
                                        ? `<video class="sm-gallery-vid" src="${mi.dataUrl}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top:0; left:0; z-index: 1;" muted></video>`
                                        : `<img class="sm-gallery-img" src="${mi.dataUrl}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top:0; left:0; z-index: 1;">`;
                                    const clickHandler = mi.type === 'video' ? `window.viewMediaFull('${mi.dataUrl}', 'video')` : `window.viewMediaFull('${mi.dataUrl}', 'image')`;
                                    
                                    wrap.innerHTML = `
                                        <div style="width: 100%; aspect-ratio: 9/16; background: #1e293b; position: relative; overflow: hidden; cursor:pointer;" onclick="${clickHandler}">
                                            ${mediaElem}
                                            ${delBtn}
                                            ${badge}
                                            ${sizeBadge}
                                        </div>
                                        <div style="padding: 10px; background: #ffffff; display: flex; justify-content: center; border-top: 1px solid #edf2f7;">
                                            <button onclick="${clickHandler}" style="width: 100%; background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 8px 0; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                                                عرض ال${mediaTypeLabel}
                                            </button>
                                        </div>
                                    `;
                                }
                                gallery.appendChild(wrap);
                            });
                        }
                    }
                    
                    // Match toggle 
                    if (post.status) {
                        publishToggles.forEach(b => {
                            b.classList.remove('active');
                            if (b.textContent.trim() === post.status) b.classList.add('active');
                        });
                        // Wait for modal transition then trigger the toggle logic 
                        setTimeout(() => {
                            const activeBtn = Array.from(publishToggles).find(b => b.classList.contains('active'));
                            if (activeBtn) activeBtn.click();
                        }, 50);
                    }
                    
                    // Set correct date target
                    if (post.dateStr) {
                        const parts = post.dateStr.split('-');
                        targetOpt = { year: parseInt(parts[0]), month: parseInt(parts[1]), date: parseInt(parts[2]) };
                        window.activeSocialDateOptions = targetOpt; // update exact selection
                    }
                }
            }
        }
        
        const subtitle = document.getElementById('createPostSubtitle');
        if (subtitle && targetOpt) {
            const monthNamesArabic = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            const dayNamesArabic = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
            const d = new Date(targetOpt.year, targetOpt.month, targetOpt.date);
            const dayOfWeekArabic = dayNamesArabic[d.getDay()];
            const monthText = monthNamesArabic[targetOpt.month];
            
            subtitle.textContent = `للنشر يوم: ${dayOfWeekArabic} ${targetOpt.date} ${monthText} ${targetOpt.year}`;
            subtitle.style.fontWeight = '600';
            subtitle.style.color = '#f97316';
        } else if (subtitle) {
            subtitle.textContent = 'أنشئ وانشر محتواك على منصاتك';
            subtitle.style.fontWeight = 'normal';
            subtitle.style.color = '#718096';
        }
        
        const existingPostsArea = document.getElementById('smModalExistingPostsArea');
        if (existingPostsArea && targetOpt) {
            existingPostsArea.innerHTML = '';
            const activeBoard = boards.find(b => b.id === activeBoardId);
            if (activeBoard && activeBoard.cards) {
                const targetDateStr = `${targetOpt.year}-${targetOpt.month}-${targetOpt.date}`;
                let dayPosts = activeBoard.cards.filter(c => c.dateStr === targetDateStr);
                
                if (dayPosts.length > 0 || postId) {
                    let html = `<h4 style="font-size:12px; color:#64748b; margin-bottom:8px; font-weight:600;">منشورات هذا اليوم:</h4><div id="smModalPostsList" style="display:flex; flex-direction:column; gap:6px;">`;
                    
                    html += dayPosts.map((p, idx) => {
                        const safeFullText = p.fullText ? window.smEscapeHTML(p.fullText) : '';
                        const safeDesc = p.description ? window.smEscapeHTML(p.description) : '';
                        const textSnippetRaw = p.fullText ? p.fullText.substring(0, 30) + '...' : (p.description ? p.description.substring(0, 30) + '...' : 'مسودة منشور...');
                        const textSnippet = window.smEscapeHTML(textSnippetRaw);
                        const items = p.mediaItems || (p.mediaObj ? [p.mediaObj] : []);
                        
                        let mediaThumb = `<div style="font-size:12px; margin-left:6px; flex-shrink:0;">📝</div>`;
                        if (items.length > 0) {
                            const m = items[0];
                            if (m.dataUrl && (!m.type || m.type === 'image')) {
                                mediaThumb = `<img src="${m.dataUrl}" style="width:24px; height:24px; border-radius:4px; object-fit:cover; margin-left:6px; flex-shrink:0;">`;
                            } else if (m.thumbnail) {
                                mediaThumb = `<img src="${m.thumbnail}" style="width:24px; height:24px; border-radius:4px; object-fit:cover; margin-left:6px; flex-shrink:0;">`;
                            } else if (m.type === 'frame-io' || m.type === 'video' || (m.dataUrl && m.dataUrl.startsWith('data:video/'))) {
                                mediaThumb = `<div style="width:24px; height:24px; border-radius:4px; background:#1e293b; color:white; display:flex; align-items:center; justify-content:center; margin-left:6px; flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>`;
                            }
                        }
                        
                        const isActive = p.id === postId;
                        let bg = isActive ? '#eff6ff' : '#ffffff';
                        let border = isActive ? '1px solid #3b82f6' : '1px solid #e2e8f0';
                        let accentColor = '#94a3b8'; 
                        
                        if (!isActive) {
                            if (p.status === 'فوري') { bg = '#f0fdf4'; border = '1px solid #bbf7d0'; accentColor = '#22c55e'; }
                            else if (p.status === 'جدولة') { bg = '#fffbeb'; border = '1px solid #fde68a'; accentColor = '#f59e0b'; }
                        } else {
                            if (p.status === 'فوري') accentColor = '#22c55e';
                            else if (p.status === 'جدولة') accentColor = '#f59e0b';
                        }
                        
                        const hoverStyle = isActive ? "" : "onmouseover=\"this.style.transform='scale(1.02)'\" onmouseout=\"this.style.transform='scale(1)'\"";
                        const clickEvt = isActive ? "" : `onclick="const ta = document.querySelector('.sm-textarea'); const hi = document.getElementById('smMediaInput'); if((ta && ta.value.trim()) || (hi && hi.files.length>0) || document.getElementById('smMediaGallery').children.length > 0) window.saveSocialDraft(true); setTimeout(() => window.openCreatePostModal('${p.id}'), 100);"`;
                        const pointerEvt = isActive ? "pointer-events: none; opacity: 0.9;" : "cursor: pointer;";
                        const shadow = isActive ? "box-shadow: 0 0 0 2px rgba(59,130,246,0.3);" : "box-shadow: 0 1px 2px rgba(0,0,0,0.05);";

                        return `
                        <div data-id="${p.id}" ${clickEvt} ${hoverStyle} title="${safeFullText || safeDesc || ''}" style="padding: 6px; border-radius: 6px; background: ${bg}; border: ${border}; border-right: 3px solid ${accentColor}; font-size: 11px; color: #1e293b; display: flex; align-items: center; transition: transform 0.1s; direction: rtl; ${pointerEvt} ${shadow}">
                            <div class="sm-sidebar-drag-handle" style="font-weight: 800; color: #cbd5e1; font-size: 14px; margin-left: 8px; cursor: grab; display: flex; align-items: center; justify-content: center; pointer-events: auto;" onclick="event.stopPropagation();">${idx + 1}</div>
                            ${mediaThumb}
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-weight: ${isActive ? '700' : '500'}; color: ${isActive ? '#1d4ed8' : '#1e293b'}; margin-left: 4px;">${textSnippet}</div>
                            <button onclick="event.stopPropagation(); window.deleteSocialPost('${p.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px; border-radius: 4px; pointer-events: auto; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: all 0.2s;" onmouseover="this.style.opacity='1'; this.style.background='#fee2e2';" onmouseout="this.style.opacity='0.7'; this.style.background='transparent';" title="حذف المنشور">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                        </div>`;
                    }).join('');
                    
                    html += `</div>
                        <button onclick="const ta = document.querySelector('.sm-textarea'); const hi = document.getElementById('smMediaInput'); if((ta && ta.value.trim()) || (hi && hi.files.length>0) || document.getElementById('smMediaGallery').children.length > 0) window.saveSocialDraft(true); setTimeout(() => window.openCreatePostModal(null), 100);" style="width: 100%; border: dashed 1px #cbd5e1; background: #f8fafc; color: #3b82f6; padding: 6px; border-radius: 6px; cursor: pointer; display: flex; justify-content: center; align-items: center; font-size: 11px; font-weight: 600; transition: background 0.2s; margin-top: 4px;" onmouseover="this.style.background='#f1f5f9';" onmouseout="this.style.background='#f8fafc';">
                            + إضافة منشور جديد
                        </button>
                    `;
                    
                    existingPostsArea.innerHTML = html;
                    existingPostsArea.style.display = 'block';
                    
                    setTimeout(() => {
                        const listEl = document.getElementById('smModalPostsList');
                        if (listEl && typeof Sortable !== 'undefined') {
                            new Sortable(listEl, {
                                animation: 150,
                                handle: '.sm-sidebar-drag-handle',
                                onEnd: function () {
                                    const board = boards.find(b => b.id === activeBoardId);
                                    if (board && board.cards) {
                                        const dateStr = `${targetOpt.year}-${targetOpt.month}-${targetOpt.date}`;
                                        const originalDayCards = board.cards.filter(c => c.dateStr === dateStr);
                                        const newOrderDOMIds = Array.from(listEl.children).map(c => c.getAttribute('data-id')).filter(id => id);
                                        const rearrangedDayCards = newOrderDOMIds.map(id => originalDayCards.find(c => c.id === id)).filter(c => c);
                                        
                                        let replacementIndex = 0;
                                        board.cards = board.cards.map(c => {
                                            if (c.dateStr === dateStr) {
                                                const replacementCard = rearrangedDayCards[replacementIndex];
                                                replacementIndex++;
                                                return replacementCard;
                                            }
                                            return c;
                                        });
                                        
                                        saveState();
                                        render();
                                        setTimeout(() => window.openCreatePostModal(window.currentEditingSocialPostId), 50);
                                    }
                                }
                            });
                        }
                    }, 50);
                } else {
                    existingPostsArea.style.display = 'none';
                }
            } else {
                existingPostsArea.style.display = 'none';
            }
        }
        
        createPostModal.classList.add('active');
    }
};
const closeCreatePostModal = document.getElementById('closeCreatePostModal');
const pipedriveDomainInput = document.getElementById('pipedriveDomain');
const pipedriveTokenInput = document.getElementById('pipedriveToken');
const fetchPipedrivePipelinesBtn = document.getElementById('fetchPipedrivePipelinesBtn');
const pipedrivePipelineSelectGroup = document.getElementById('pipedrivePipelineSelectGroup');
const pipedrivePipelineSelect = document.getElementById('pipedrivePipelineSelect');
const savePipedriveSettingsBtn = document.getElementById('savePipedriveSettingsBtn');

if (closePipedriveSettingsModal) {
    if(closePipedriveSettingsModal) closePipedriveSettingsModal.onclick = () => pipedriveSettingsModal.classList.remove('active');
}

if (closeCreatePostModal && createPostModal) {
    const handleModalDismiss = () => {
        const textArea = document.querySelector('.sm-textarea');
        const textContent = textArea ? textArea.value.trim() : '';
        const gallery = document.getElementById('smMediaGallery');
        const hasGalleryItems = gallery && gallery.children.length > 0;
        
        const isEmpty = !textContent && !hasGalleryItems;
        
        if (isEmpty) {
            if (window.currentEditingSocialPostId) {
                // Automatically delete the draft if it becomes completely empty
                const board = boards.find(b => b.id === activeBoardId);
                if (board) {
                    const idx = board.cards.findIndex(c => c.id === window.currentEditingSocialPostId);
                    if (idx > -1) {
                        board.cards.splice(idx, 1);
                        saveState();
                        render();
                    }
                }
            }
        } else {
            window.saveSocialDraft(true); // Save current state safely into draft before closing
        }
        
        createPostModal.classList.remove('active');
        if (textArea) textArea.value = '';
        if (window.clearMediaUpload) window.clearMediaUpload();
    };

    if(closeCreatePostModal) closeCreatePostModal.onclick = handleModalDismiss;
    
    // Close modal if clicking outside the content box
    if(createPostModal) createPostModal.addEventListener('click', (e) => {
        if (e.target === createPostModal) {
            handleModalDismiss();
        }
    });

    // Also bind Cancel button inside modal body
    const cancelBtn = createPostModal.querySelector('.sm-btn-cancel');
    if (cancelBtn) if(cancelBtn) cancelBtn.onclick = handleModalDismiss;

    // Bind Publish Mode toggles
    const publishToggles = createPostModal.querySelectorAll('.sm-toggle-btn');
    const optionalWrapper = document.getElementById('sm-optional-fields-wrapper');
    const primaryActionBtn = document.getElementById('sm-primary-action-btn');
    if (primaryActionBtn) {
        if(primaryActionBtn) primaryActionBtn.onclick = () => window.saveSocialDraft();
    }

    if (publishToggles.length > 0) {
        publishToggles.forEach(btn => {
            if(btn) btn.onclick = () => {
                publishToggles.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const mode = btn.textContent.trim();
                
                if (mode === 'مسودة') {
                    if (optionalWrapper) optionalWrapper.classList.add('collapsed');
                    if (primaryActionBtn) primaryActionBtn.textContent = 'حفظ كمسودة';
                } else if (mode === 'فوري') {
                    if (optionalWrapper) optionalWrapper.classList.add('collapsed');
                    if (primaryActionBtn) primaryActionBtn.textContent = 'نشر الآن';
                } else {
                    if (optionalWrapper) optionalWrapper.classList.remove('collapsed');
                    if (primaryActionBtn) primaryActionBtn.textContent = 'جدولة المنشور';
                    
                    const dateInput = createPostModal.querySelector('.sm-date-input');
                    if (dateInput && window.activeSocialDateOptions) {
                        const d = window.activeSocialDateOptions.date.toString().padStart(2, '0');
                        const m = (window.activeSocialDateOptions.month + 1).toString().padStart(2, '0');
                        const y = window.activeSocialDateOptions.year;
                        dateInput.value = `${d}/${m}/${y}`;
                    }
                }
            };
        });
    }
}

function openPipedriveSettingsModal() {
    pipedriveDomainInput.value = localStorage.getItem('pipedriveDomain') || '';
    pipedriveTokenInput.value = localStorage.getItem('pipedriveToken') || '';
    pipedrivePipelineSelectGroup.style.display = 'none';
    pipedrivePipelineSelect.innerHTML = '';
    pipedriveSettingsModal.classList.add('active');
}

if (fetchPipedrivePipelinesBtn) {
    if(fetchPipedrivePipelinesBtn) fetchPipedrivePipelinesBtn.onclick = async () => {
        let domain = pipedriveDomainInput.value.trim();
        if (domain.includes('://')) domain = domain.split('://')[1];
        domain = domain.split('.')[0];
        pipedriveDomainInput.value = domain;
        const token = pipedriveTokenInput.value.trim();
        if(!domain || !token) {
            showToast("Enter both Domain and Token first");
            return;
        }
        
        const btnText = fetchPipedrivePipelinesBtn.textContent;
        fetchPipedrivePipelinesBtn.textContent = "Fetching...";
        
        try {
            const res = await fetch(`https://${domain}.pipedrive.com/api/v1/pipelines?api_token=${token}`);
            if(!res.ok) throw new Error("Invalid credentials");
            const payload = await res.json();
            const fetchedPipelines = payload.data || [];
            
            pipedrivePipelineSelect.innerHTML = '<option value="">-- Choose a Pipeline to Link --</option>';
            fetchedPipelines.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                const curBoard = boards.find(b2 => b2.id === activeBoardId);
                if(curBoard && curBoard.pipedrivePipelineId == p.id) opt.selected = true;
                pipedrivePipelineSelect.appendChild(opt);
            });
            
            pipedrivePipelineSelectGroup.style.display = 'block';
        } catch (err) {
            showToast("Failed to fetch Pipedrive pipelines. Check API token or Domain.");
        } finally {
            fetchPipedrivePipelinesBtn.textContent = btnText;
        }
    };
}

if (savePipedriveSettingsBtn) {
    if(savePipedriveSettingsBtn) savePipedriveSettingsBtn.onclick = () => {
        let domain = pipedriveDomainInput.value.trim();
        if (domain.includes('://')) domain = domain.split('://')[1];
        domain = domain.split('.')[0];
        pipedriveDomainInput.value = domain;
        const token = pipedriveTokenInput.value.trim();
        localStorage.setItem('pipedriveDomain', domain);
        localStorage.setItem('pipedriveToken', token);
        
        pipedriveDomain = domain;
        pipedriveToken = token;
        
        const curBoard = boards.find(b => b.id === activeBoardId);
        if (curBoard) {
            const selectedPipelineId = pipedrivePipelineSelect.value;
            if (selectedPipelineId) {
                curBoard.pipedrivePipelineId = selectedPipelineId;
                curBoard.pipedrivePipelineName = pipedrivePipelineSelect.options[pipedrivePipelineSelect.selectedIndex].text;
                showToast(`Linked to Pipedrive!`);
            } else {
                curBoard.pipedrivePipelineId = null;
                showToast("Saved Credentials");
            }
            saveState();
            render(); 
        }
        
        pipedriveSettingsModal.classList.remove('active');
    };
}

const trelloMappingModal = document.getElementById('trelloMappingModal');
const closeTrelloMappingModal = document.getElementById('closeTrelloMappingModal');
const trelloTrackerCheckboxes = document.getElementById('trelloTrackerCheckboxes');
const trelloSpawnDirection = document.getElementById('trelloSpawnDirection');
const generateTrelloTrackersBtn = document.getElementById('generateTrelloTrackersBtn');
const trelloSelectAllBtn = document.getElementById('trelloSelectAllBtn');
let pendingSourceList = null;

if (trelloSelectAllBtn) {
    if(trelloSelectAllBtn) trelloSelectAllBtn.onclick = () => {
        const checkboxes = document.querySelectorAll('.trello-tracker-cb');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        trelloSelectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    };
}

if (closeTrelloMappingModal) {
    if(closeTrelloMappingModal) closeTrelloMappingModal.onclick = () => trelloMappingModal.classList.remove('active');
}

let pendingLayoutList = null;
const trelloLayoutModal = document.getElementById('trelloLayoutModal');
const layoutSpacingX = document.getElementById('layoutSpacingX');
const layoutSpacingY = document.getElementById('layoutSpacingY');

if (document.getElementById('closeTrelloLayoutModal')) {
    document.getElementById('closeTrelloLayoutModal').onclick = () => {
        trelloLayoutModal.classList.remove('active');
    };
}

if (document.getElementById('saveTrelloLayoutBtn')) {
    document.getElementById('saveTrelloLayoutBtn').onclick = () => {
        if (pendingLayoutList) {
            pendingLayoutList.trelloOffsetX = parseInt(layoutSpacingX.value) || 0;
            pendingLayoutList.trelloSpacingY = parseInt(layoutSpacingY.value) || 60;
            pendingLayoutList.trelloAlignType = 'top'; // Hardcoded fallback for existing math
            const curBoard = boards.find(b => b.id === activeBoardId);
            if (curBoard && window.applySmartPacking) window.applySmartPacking(curBoard);
            saveState();
            if (typeof render === 'function') render();
            trelloLayoutModal.classList.remove('active');
        }
    };
}

window.openTrelloLayoutModal = function(list) {
    pendingLayoutList = list;
    if (layoutSpacingX) layoutSpacingX.value = list.trelloOffsetX !== undefined ? list.trelloOffsetX : 0;
    if (layoutSpacingY) layoutSpacingY.value = list.trelloSpacingY !== undefined ? list.trelloSpacingY : 60;
    if (trelloLayoutModal) trelloLayoutModal.classList.add('active');
};

let pendingAdsLayoutList = null;
const adsLayoutModal = document.getElementById('adsLayoutModal');
const adsLayoutSpacingX = document.getElementById('adsLayoutSpacingX');
const adsLayoutSpacingY = document.getElementById('adsLayoutSpacingY');

if (document.getElementById('closeAdsLayoutModal')) {
    document.getElementById('closeAdsLayoutModal').onclick = () => {
        adsLayoutModal.classList.remove('active');
    };
}

if (document.getElementById('saveAdsLayoutBtn')) {
    document.getElementById('saveAdsLayoutBtn').onclick = () => {
        if (pendingAdsLayoutList) {
            pendingAdsLayoutList.adsOffsetX = parseInt(adsLayoutSpacingX.value) || 0;
            pendingAdsLayoutList.adsSpacingY = parseInt(adsLayoutSpacingY.value) || 60;
            pendingAdsLayoutList.adsOffsetY = 600; // Hardcoded fallback for existing math
            pendingAdsLayoutList.adsAlignType = 'top'; // Hardcoded fallback for existing math
            
            const curBoard = boards.find(b => b.id === activeBoardId);
            if (curBoard && window.applySmartPacking) window.applySmartPacking(curBoard);
            
            saveState();
            if (typeof render === 'function') render();
            adsLayoutModal.classList.remove('active');
        }
    };
}

window.openAdsLayoutModal = function(list) {
    pendingAdsLayoutList = list;
    if (adsLayoutSpacingX) adsLayoutSpacingX.value = list.adsOffsetX !== undefined ? list.adsOffsetX : 0;
    if (adsLayoutSpacingY) adsLayoutSpacingY.value = list.adsSpacingY !== undefined ? list.adsSpacingY : 60;
    if (adsLayoutModal) adsLayoutModal.classList.add('active');
};

async function openTrelloMappingGenerator(sourceList, trackerType = 'trello') {
    window.pendingTrackerType = trackerType;
    const curBoard = boards.find(b => b.id === activeBoardId);
    if (!trelloKey || !trelloToken || !curBoard) {
        showToast("Enter Trello Key and Token in settings first!");
        return;
    }
    
    pendingSourceList = sourceList;
    if (trelloSelectAllBtn) trelloSelectAllBtn.textContent = 'Select All';
    
    const existingConnections = (curBoard.connections || []).filter(c => c.source === sourceList.id);
    const typeMatch = window.pendingTrackerType || 'trello';
    const existingTrackers = existingConnections.map(c => curBoard.lists.find(l => l.id === c.target)).filter(l => Boolean(l) && (l.trackerType || 'trello') === typeMatch);
    const existingTrackerTrelloIds = existingTrackers.map(l => l.trelloListId).filter(Boolean);
    
    let preSelectedBoardId = null;
    let preSelectedSourcePort = 'top';
    let preSelectedTargetPort = 'auto';

    if (existingTrackers.length > 0) {
        if (existingTrackers[0].trelloBoardId) preSelectedBoardId = existingTrackers[0].trelloBoardId;
        if (existingConnections.length > 0) {
            preSelectedSourcePort = existingConnections[0].sourcePort || 'top';
            
            const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            if (existingConnections[0].targetPort !== opp[preSelectedSourcePort]) {
                preSelectedTargetPort = existingConnections[0].targetPort || 'auto';
            }
        }
    }
    
    trelloSpawnDirection.value = preSelectedSourcePort;
    const targetPortSelect = document.getElementById('trelloTargetPort');
    if (targetPortSelect) targetPortSelect.value = preSelectedTargetPort;

    const boardSelect = document.getElementById('trelloMappingBoardSelect');
    
    try {
        const boardsRes = await fetch(`https://api.trello.com/1/members/me/boards?fields=name,url&key=${trelloKey}&token=${trelloToken}`);
        if(!boardsRes.ok) throw new Error("Failed to fetch boards");
        const tBoards = await boardsRes.json();
        
        if (boardSelect) {
            boardSelect.innerHTML = '<option value="">-- Choose a Board --</option>';
            tBoards.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                
                if (preSelectedBoardId) {
                    if (preSelectedBoardId === b.id) opt.selected = true;
                } else if (curBoard.trelloBoardId === b.id) {
                    opt.selected = true;
                }
                
                boardSelect.appendChild(opt);
            });
            
            const fetchListsForBoard = async (boardId) => {
                trelloTrackerCheckboxes.innerHTML = '<div style="padding:10px; font-size:13px; color:#5e6c84;">Loading lists...</div>';
                try {
                    const res = await fetch(`https://api.trello.com/1/boards/${boardId}/lists?key=${trelloKey}&token=${trelloToken}`);
                    if(!res.ok) throw new Error("Failed parameter");
                    const tLists = await res.json();
                    
                    trelloTrackerCheckboxes.innerHTML = '';
                    tLists.forEach(tl => {
                        const row = document.createElement('label');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.padding = '10px 12px';
                        row.style.margin = '0 0 6px 0';
                        row.style.borderRadius = '6px';
                        row.style.background = '#ffffff';
                        row.style.border = '1px solid #dfe1e6';
                        row.style.cursor = 'pointer';
                        row.style.transition = 'all 0.2s ease';
                        row.onmouseenter = () => { row.style.boxShadow = '0 2px 4px rgba(9, 30, 66, 0.08)'; row.style.borderColor = 'var(--primary-color)'; };
                        row.onmouseleave = () => { row.style.boxShadow = 'none'; row.style.borderColor = '#dfe1e6'; };

                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.value = tl.id;
                        cb.className = 'trello-tracker-cb';
                        cb.dataset.name = tl.name;
                        cb.style.cursor = 'pointer';
                        cb.style.margin = '0';
                        cb.checked = existingTrackerTrelloIds.includes(tl.id);

                        const span = document.createElement('span');
                        span.textContent = tl.name;
                        span.style.marginLeft = '12px';
                        span.style.fontSize = '14px';
                        span.style.color = 'var(--text-color)';
                        span.style.fontWeight = '500';

                        row.appendChild(cb);
                        row.appendChild(span);
                        trelloTrackerCheckboxes.appendChild(row);
                    });
                } catch (err) {
                    showToast("Failed to fetch Trello lists");
                    trelloTrackerCheckboxes.innerHTML = '';
                }
            };

            boardSelect.onchange = () => {
                const selectedBoardId = boardSelect.value;
                if (selectedBoardId) {
                    fetchListsForBoard(selectedBoardId);
                } else {
                    trelloTrackerCheckboxes.innerHTML = '';
                }
            };
            
            if (boardSelect.value) {
                fetchListsForBoard(boardSelect.value);
            } else if (tBoards.length > 0) {
                boardSelect.value = tBoards[0].id;
                fetchListsForBoard(tBoards[0].id);
            } else {
                trelloTrackerCheckboxes.innerHTML = '';
            }
        }
        
        trelloMappingModal.classList.add('active');
    } catch (err) {
        showToast("Failed to fetch Trello boards");
    }
}

const trelloTasksMappingModal = document.getElementById('trelloTasksMappingModal');
const closeTrelloTasksMappingModal = document.getElementById('closeTrelloTasksMappingModal');
const generateTrelloTasksBtn = document.getElementById('generateTrelloTasksBtn');

if (closeTrelloTasksMappingModal) {
    if(closeTrelloTasksMappingModal) closeTrelloTasksMappingModal.onclick = () => trelloTasksMappingModal.classList.remove('active');
}

const serviceCardsModal = document.getElementById('serviceCardsModal');
const closeServiceCardsModal = document.getElementById('closeServiceCardsModal');

if (closeServiceCardsModal) {
    if(closeServiceCardsModal) closeServiceCardsModal.onclick = () => serviceCardsModal.classList.remove('active');
}

function openServiceCardsModal(title, icon, cards) {
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard) return;
    
    const titleEl = document.getElementById('serviceCardsModalTitle');
    const iconEl = document.getElementById('serviceCardsModalIcon');
    const container = document.getElementById('serviceCardsModalList');
    
    if (titleEl) titleEl.textContent = title;
    if (iconEl) {
        if (icon.includes('<svg')) {
            iconEl.innerHTML = icon.replace(/width="14"/g, 'width="32"').replace(/height="14"/g, 'height="32"');
        } else {
            iconEl.innerHTML = icon;
            iconEl.style.fontSize = '32px';
        }
    }
    
    if (container) {
        container.innerHTML = '';
        if (cards.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--secondary-color); font-size: 13px;">No clients found for this criteria.</div>';
        } else {
            cards.forEach(card => {
                const cardEl = document.createElement('div');
                cardEl.className = 'card';
                cardEl.style.flexDirection = 'row';
                
                const cColor = (activeBoard.cardColors && activeBoard.cardColors[card.id]) ? activeBoard.cardColors[card.id] : (card.color || 'default');
                const borderHex = cColor === 'green' ? '#22A06B' : cColor === 'red' ? '#C9372C' : cColor === 'orange' ? '#FF9800' : cColor === 'yellow' ? '#F5CD47' : '#5e6c84';
                
                cardEl.style.borderLeft = `4px solid ${borderHex}`;
                cardEl.style.padding = '12px 16px';
                cardEl.style.marginBottom = '8px';
                cardEl.style.cursor = 'pointer';
                cardEl.style.display = 'flex';
                cardEl.style.justifyContent = 'space-between';
                cardEl.style.alignItems = 'center';
                
                const nameContainer = document.createElement('div');
                nameContainer.style.display = 'flex';
                nameContainer.style.alignItems = 'center';
                
                const nameEl = document.createElement('div');
                nameEl.style.fontWeight = '600';
                nameEl.style.color = '#172b4d';
                nameEl.style.fontSize = '14px';
                nameEl.textContent = card.title || 'Untitled Client';
                nameContainer.appendChild(nameEl);
                
                let sentEmoji = '';
                const isSentimentModal = ['Green Clients', 'Yellow Clients', 'Orange Clients', 'Red Clients', 'Unassigned Clients'].includes(title);
                
                if (!isSentimentModal) {
                    if (cColor === 'green') sentEmoji = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>';
                    else if (cColor === 'yellow') sentEmoji = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>';
                    else if (cColor === 'orange') sentEmoji = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>';
                    else if (cColor === 'red') sentEmoji = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>';
                }
                
                if (sentEmoji) {
                    const seEl = document.createElement('span');
                    seEl.style.marginLeft = '4px';
                    seEl.style.display = 'flex';
                    seEl.style.alignItems = 'center';
                    seEl.innerHTML = sentEmoji;
                    nameContainer.appendChild(seEl);
                }
                
                if (card.services && card.services.length > 0) {
                    const localEmojiMap = {
                        'Store': '🛍️',
                        'Paid Ads': '🚀',
                        'Social Media': '📱',
                        'SEO': '🔎',
                        'WA API': '💬',
                        'Website monitoring': '⚡',
                        'Marketplaces': '🛒'
                    };
                    const svcsEl = document.createElement('div');
                    svcsEl.style.display = 'flex';
                    svcsEl.style.marginLeft = '8px';
                    svcsEl.style.fontSize = '13px';
                    
                    let htmlStr = '';
                    card.services.forEach(svc => htmlStr += `<span style="margin-right:2px;" title="${svc}">${localEmojiMap[svc]||'🔧'}</span>`);
                    svcsEl.innerHTML = htmlStr;
                    nameContainer.appendChild(svcsEl);
                }
                
                const viewBtn = document.createElement('div');
                viewBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5e6c84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7; transition: opacity 0.2s;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
                
                cardEl.onmouseenter = () => viewBtn.querySelector('svg').style.opacity = '1';
                cardEl.onmouseleave = () => viewBtn.querySelector('svg').style.opacity = '0.7';
                
                cardEl.appendChild(nameContainer);
                cardEl.appendChild(viewBtn);
                
                if(cardEl) cardEl.onclick = () => {
                    serviceCardsModal.classList.remove('active');
                    const activeBoard = boards.find(b => b.id === activeBoardId);
                    if (activeBoard) {
                        activeBoard.isolateCardId = card.id;
                        saveState();
                        render();
                        setTimeout(() => {
                            const target = document.querySelector(`[data-card-id="${card.id}"]`);
                            if (target) {
                                target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                                target.style.boxShadow = '0 0 0 3px #0c66e4, 0 8px 24px rgba(12, 102, 228, 0.4)';
                                target.style.transform = 'scale(1.02)';
                                target.style.transition = 'all 0.3s ease';
                            }
                        }, 100);
                    }
                };
                
                container.appendChild(cardEl);
            });
        }
    }
    
    if (serviceCardsModal) serviceCardsModal.classList.add('active');
}

const trelloTasksViewModal = document.getElementById('trelloTasksViewModal');
const closeTrelloTasksViewModal = document.getElementById('closeTrelloTasksViewModal');

if (closeTrelloTasksViewModal) {
    if(closeTrelloTasksViewModal) closeTrelloTasksViewModal.onclick = () => trelloTasksViewModal.classList.remove('active');
}

function openTrelloTasksViewModal(list) {
    const listTitle = document.getElementById('trelloTasksViewTitle');
    const container = document.getElementById('trelloTasksViewList');
    
    if (listTitle) listTitle.textContent = list.title || "Team Tasks";
    if (container) {
        container.innerHTML = '';
        
        const tasks = list.cards.filter(c => c.isTrelloTask);
        if (tasks.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--secondary-color); font-size: 13px;">No tasks found here.</div>';
        } else {
            tasks.forEach(task => {
                const cardEl = document.createElement('div');
                cardEl.className = 'card';
                cardEl.style.borderLeft = '3px solid #5e6c84';
                cardEl.style.cursor = 'pointer';
                cardEl.style.marginBottom = '0';
                if(cardEl) cardEl.onclick = () => openTrelloCardDetailsModal(task.id, list.id);
                
                const titleEl = document.createElement('div');
                titleEl.className = 'card-title';
                titleEl.style.lineHeight = '1.4';
                titleEl.textContent = task.title;
                
                cardEl.appendChild(titleEl);
                container.appendChild(cardEl);
            });
        }
    }
    
    if (trelloTasksViewModal) trelloTasksViewModal.classList.add('active');
}

const clientHappinessMappingModal = document.getElementById('clientHappinessMappingModal');
const closeClientHappinessMappingModal = document.getElementById('closeClientHappinessMappingModal');
const clientHappinessSpawnDirection = document.getElementById('clientHappinessSpawnDirection');
const clientHappinessTargetPort = document.getElementById('clientHappinessTargetPort');
const generateClientHappinessTrackerBtn = document.getElementById('generateClientHappinessTrackerBtn');
const unlinkClientHappinessTrackerBtn = document.getElementById('unlinkClientHappinessTrackerBtn');

if (unlinkClientHappinessTrackerBtn) {
    unlinkClientHappinessTrackerBtn.onclick = () => {
        if (!pendingSourceList) return;
        const curBoard = boards.find(b => b.id === activeBoardId);
        if (!curBoard || !curBoard.connections) return;
        
        const existingConnIndex = curBoard.connections.findIndex(c => 
            c.source === pendingSourceList.id && curBoard.lists.find(l => l.id === c.target && l.isClientHappiness)
        );
        
        if (existingConnIndex !== -1) {
            const targetId = curBoard.connections[existingConnIndex].target;
            // Remove connection
            curBoard.connections.splice(existingConnIndex, 1);
            // Remove the tracker list itself
            curBoard.lists = curBoard.lists.filter(l => l.id !== targetId);
            
            saveState();
            clientHappinessMappingModal.classList.remove('active');
            render();
            showToast("Unlinked Client Happiness tracker");
        }
    };
}

if (closeClientHappinessMappingModal) {
    if(closeClientHappinessMappingModal) closeClientHappinessMappingModal.onclick = () => clientHappinessMappingModal.classList.remove('active');
}

if (generateClientHappinessTrackerBtn) {
    if(generateClientHappinessTrackerBtn) generateClientHappinessTrackerBtn.onclick = () => {
        if (!pendingSourceList) return;
        
        const spawnDir = clientHappinessSpawnDirection.value;
        const targetPort = clientHappinessTargetPort.value;
        const curBoard = boards.find(b => b.id === activeBoardId);
        
        let actualTargetPort = targetPort;
        if (actualTargetPort === 'auto') {
            const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            actualTargetPort = opp[spawnDir] || 'left';
        }
        
        let targetX = pendingSourceList.x || 0;
        let targetY = pendingSourceList.y || 80;
        
        if (spawnDir === 'right') targetX += 340;
        else if (spawnDir === 'left') targetX -= 340;
        else if (spawnDir === 'bottom') targetY += 200;
        else if (spawnDir === 'top') targetY -= 200;
        
        if (!curBoard.connections) curBoard.connections = [];
        const existingClientHappinessConn = curBoard.connections.find(c => 
            c.source === pendingSourceList.id && curBoard.lists.find(l => l.id === c.target && l.isClientHappiness)
        );
        
        if (existingClientHappinessConn) {
            // Update existing connection and list position
            existingClientHappinessConn.sourcePort = spawnDir;
            existingClientHappinessConn.targetPort = actualTargetPort;
            
            const targetList = curBoard.lists.find(l => l.id === existingClientHappinessConn.target);
            if (targetList) {
                targetList.x = targetX;
                targetList.y = targetY;
            }
            
            showToast("Updated Client Happiness tracker position!");
        } else {
            // Create new
            const newListId = 'list-' + Date.now();
            const newList = {
                id: newListId,
                title: 'Client Happiness',
                cards: [],
                x: targetX,
                y: targetY,
                theme: pendingSourceList.theme || 'default',
                isClientHappiness: true
            };
            
            curBoard.lists.push(newList);
            curBoard.connections.push({
                source: pendingSourceList.id,
                target: newListId,
                sourcePort: spawnDir,
                targetPort: actualTargetPort
            });
            showToast("Created a Client Happiness tracker!");
        }
        
        saveState();
        render();
        
        
        clientHappinessMappingModal.classList.remove('active');
    };
}

const moneySmellingMappingModal = document.getElementById('moneySmellingMappingModal');
const closeMoneySmellingMappingModal = document.getElementById('closeMoneySmellingMappingModal');
const moneySmellingSpawnDirection = document.getElementById('moneySmellingSpawnDirection');
const moneySmellingTargetPort = document.getElementById('moneySmellingTargetPort');
const generateMoneySmellingTrackerBtn = document.getElementById('generateMoneySmellingTrackerBtn');

if (closeMoneySmellingMappingModal) {
    if(closeMoneySmellingMappingModal) closeMoneySmellingMappingModal.onclick = () => moneySmellingMappingModal.classList.remove('active');
}

const newClientsMappingModal = document.getElementById('newClientsMappingModal');
const closeNewClientsMappingModal = document.getElementById('closeNewClientsMappingModal');
const newClientsSpawnDirection = document.getElementById('newClientsSpawnDirection');
const newClientsTargetPort = document.getElementById('newClientsTargetPort');
const generateNewClientsTrackerBtn = document.getElementById('generateNewClientsTrackerBtn');

if (closeNewClientsMappingModal) {
    if(closeNewClientsMappingModal) closeNewClientsMappingModal.onclick = () => newClientsMappingModal.classList.remove('active');
}

if (generateMoneySmellingTrackerBtn) {
    if(generateMoneySmellingTrackerBtn) generateMoneySmellingTrackerBtn.onclick = () => {
        if (!pendingSourceList) return;
        
        const spawnDir = moneySmellingSpawnDirection.value;
        const targetPort = moneySmellingTargetPort.value;
        const curBoard = boards.find(b => b.id === activeBoardId);
        
        let actualTargetPort = targetPort;
        if (actualTargetPort === 'auto') {
            const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            actualTargetPort = opp[spawnDir] || 'left';
        }
        
        let targetX = pendingSourceList.x || 0;
        let targetY = pendingSourceList.y || 80;
        
        if (spawnDir === 'right') targetX += 340;
        else if (spawnDir === 'left') targetX -= 340;
        else if (spawnDir === 'bottom') targetY += 200;
        else if (spawnDir === 'top') targetY -= 200;
        
        if (!curBoard.connections) curBoard.connections = [];
        const existingMoneySmellingConn = curBoard.connections.find(c => 
            c.source === pendingSourceList.id && curBoard.lists.find(l => l.id === c.target && l.isMoneySmelling)
        );
        
        if (existingMoneySmellingConn) {
            // Update existing connection and list position
            existingMoneySmellingConn.sourcePort = spawnDir;
            existingMoneySmellingConn.targetPort = actualTargetPort;
            
            const targetList = curBoard.lists.find(l => l.id === existingMoneySmellingConn.target);
            if (targetList) {
                targetList.x = targetX;
                targetList.y = targetY;
            }
            
            showToast("Updated Money Smelling tracker position!");
        } else {
            // Create new
            const newListId = 'list-' + Date.now();
            const newList = {
                id: newListId,
                title: 'Money Smelling',
                cards: [],
                x: targetX,
                y: targetY,
                theme: pendingSourceList.theme || 'default',
                isMoneySmelling: true
            };
            
            curBoard.lists.push(newList);
            curBoard.connections.push({
                source: pendingSourceList.id,
                target: newListId,
                sourcePort: spawnDir,
                targetPort: actualTargetPort
            });
            showToast("Created a Money Smelling tracker!");
        }
        
        saveState();
        render();
        
        moneySmellingMappingModal.classList.remove('active');
    };
}

if (generateNewClientsTrackerBtn) {
    if(generateNewClientsTrackerBtn) generateNewClientsTrackerBtn.onclick = () => {
        if (!pendingSourceList) return;
        
        const spawnDir = newClientsSpawnDirection.value;
        const targetPort = newClientsTargetPort.value;
        const curBoard = boards.find(b => b.id === activeBoardId);
        
        let actualTargetPort = targetPort;
        if (actualTargetPort === 'auto') {
            const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            actualTargetPort = opp[spawnDir] || 'left';
        }
        
        let targetX = pendingSourceList.x || 0;
        let targetY = pendingSourceList.y || 80;
        
        if (spawnDir === 'right') targetX += 340;
        else if (spawnDir === 'left') targetX -= 340;
        else if (spawnDir === 'bottom') targetY += 200;
        else if (spawnDir === 'top') targetY -= 200;
        
        if (!curBoard.connections) curBoard.connections = [];
        const existingNewClientsConn = curBoard.connections.find(c => 
            c.source === pendingSourceList.id && curBoard.lists.find(l => l.id === c.target && l.isNewClients)
        );
        
        if (existingNewClientsConn) {
            // Update existing connection and list position
            existingNewClientsConn.sourcePort = spawnDir;
            existingNewClientsConn.targetPort = actualTargetPort;
            
            const targetList = curBoard.lists.find(l => l.id === existingNewClientsConn.target);
            if (targetList) {
                targetList.x = targetX;
                targetList.y = targetY;
            }
            
            showToast("Updated New Clients tracker position!");
        } else {
            // Create new
            const newListId = 'list-' + Date.now();
            const newList = {
                id: newListId,
                title: 'New Clients',
                cards: [],
                x: targetX,
                y: targetY,
                theme: pendingSourceList.theme || 'default',
                isNewClients: true
            };
            
            curBoard.lists.push(newList);
            curBoard.connections.push({
                source: pendingSourceList.id,
                target: newListId,
                sourcePort: spawnDir,
                targetPort: actualTargetPort
            });
            showToast("Created a New Clients tracker!");
        }
        
        saveState();
        render();
        
        newClientsMappingModal.classList.remove('active');
    };
}

async function openTrelloTasksMappingModal(sourceList) {
    const curBoard = boards.find(b => b.id === activeBoardId);
    if (!trelloKey || !trelloToken || !curBoard) {
        showToast("Enter Trello Key and Token in settings first!");
        return;
    }
    
    pendingSourceList = sourceList;
    const boardSelect = document.getElementById('trelloTasksMappingBoardSelect');
    const listSelect = document.getElementById('trelloTasksMappingListSelect');
    
    try {
        const boardsRes = await fetch(`https://api.trello.com/1/members/me/boards?fields=name,url&key=${trelloKey}&token=${trelloToken}`);
        if(!boardsRes.ok) throw new Error("Failed");
        const tBoards = await boardsRes.json();
        
        if (boardSelect) {
            boardSelect.innerHTML = '<option value="">-- Choose a Board --</option>';
            tBoards.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                boardSelect.appendChild(opt);
            });
            
            boardSelect.onchange = async () => {
                const selectedBoardId = boardSelect.value;
                if (!selectedBoardId) {
                    listSelect.innerHTML = '<option value="">Select a board first...</option>';
                    return;
                }
                
                listSelect.innerHTML = '<option value="">Loading lists...</option>';
                try {
                    const res = await fetch(`https://api.trello.com/1/boards/${selectedBoardId}/lists?key=${trelloKey}&token=${trelloToken}`);
                    if(!res.ok) throw new Error("Failed");
                    const tLists = await res.json();
                    
                    listSelect.innerHTML = '<option value="">-- Choose a List --</option>';
                    tLists.forEach(tl => {
                        const opt = document.createElement('option');
                        opt.value = tl.id;
                        opt.textContent = tl.name;
                        listSelect.appendChild(opt);
                    });
                } catch (err) {
                    listSelect.innerHTML = '<option value="">Failed to load lists</option>';
                    showToast("Failed to fetch Trello lists");
                }
            };
            
            if (tBoards.length > 0) {
                boardSelect.value = tBoards[0].id;
                boardSelect.dispatchEvent(new Event('change'));
            }
        }
        
        trelloTasksMappingModal.classList.add('active');
    } catch (err) {
        showToast("Failed to fetch Trello boards");
    }
}

if (generateTrelloTasksBtn) {
    if(generateTrelloTasksBtn) generateTrelloTasksBtn.onclick = () => {
        const activeBoard = boards.find(b => b.id === activeBoardId);
        const listSelect = document.getElementById('trelloTasksMappingListSelect');
        const boardSelect = document.getElementById('trelloTasksMappingBoardSelect');
        
        if (!listSelect || !listSelect.value) {
            showToast("Please select a Trello list!");
            return;
        }
        
        pendingSourceList.trelloTasksListId = listSelect.value;
        pendingSourceList.trelloTasksBoardId = boardSelect.value;
        pendingSourceList.trelloListId = null; 
        
        trelloTasksMappingModal.classList.remove('active');
        saveState();
        render();
        syncTrello(); // Trigger an immediate sync
    };
}

const pipedriveMappingModal = document.getElementById('pipedriveMappingModal');
const closePipedriveMappingModal = document.getElementById('closePipedriveMappingModal');
const pipedriveTrackerCheckboxes = document.getElementById('pipedriveTrackerCheckboxes');
const pipedriveSpawnDirection = document.getElementById('pipedriveSpawnDirection');
const generatePipedriveTrackersBtn = document.getElementById('generatePipedriveTrackersBtn');
const pipedriveSelectAllBtn = document.getElementById('pipedriveSelectAllBtn');

if (closePipedriveMappingModal) {
    if(closePipedriveMappingModal) closePipedriveMappingModal.onclick = () => pipedriveMappingModal.classList.remove('active');
}

if (pipedriveSelectAllBtn) {
    if(pipedriveSelectAllBtn) pipedriveSelectAllBtn.onclick = () => {
        const cbs = document.querySelectorAll('.pipedrive-tracker-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => cb.checked = !allChecked);
        pipedriveSelectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    };
}

async function openPipedriveMappingGenerator(sourceList) {
    const curBoard = boards.find(b => b.id === activeBoardId);
    if (!pipedriveDomain || !pipedriveToken || !curBoard) {
        showToast("Connect Pipedrive API in settings first!");
        return;
    }
    
    pendingSourceList = sourceList;
    if (pipedriveSelectAllBtn) pipedriveSelectAllBtn.textContent = 'Select All';
    
    const existingConnections = (curBoard.connections || []).filter(c => c.source === sourceList.id);
    const existingTrackers = existingConnections.map(c => curBoard.lists.find(l => l.id === c.target)).filter(Boolean);
    const existingTrackerPipedriveIds = existingTrackers.map(l => l.pipedriveStageId).filter(Boolean);
    
    let preSelectedPipelineId = null;
    let preSelectedSourcePort = 'top';
    let preSelectedTargetPort = 'auto';

    if (existingTrackers.length > 0) {
        if (existingTrackers[0].pipedrivePipelineId) preSelectedPipelineId = existingTrackers[0].pipedrivePipelineId;
        if (existingConnections.length > 0) {
            preSelectedSourcePort = existingConnections[0].sourcePort || 'top';
            
            const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            if (existingConnections[0].targetPort !== opp[preSelectedSourcePort]) {
                preSelectedTargetPort = existingConnections[0].targetPort || 'auto';
            }
        }
    }
    
    pipedriveSpawnDirection.value = preSelectedSourcePort;
    const targetPortSelect = document.getElementById('pipedriveTargetPort');
    if (targetPortSelect) targetPortSelect.value = preSelectedTargetPort;

    const pipelineSelect = document.getElementById('pipedriveMappingPipelineSelect');
    
    try {
        const [resPipelines, resFields] = await Promise.all([
            fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/pipelines?api_token=${pipedriveToken}`),
            fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/dealFields?api_token=${pipedriveToken}`)
        ]);
        
        if(!resPipelines.ok) throw new Error("Failed to fetch pipelines");
        const payload = await resPipelines.json();
        const pPipelines = payload.data || [];

        const whatsappSelect = document.getElementById('pipedriveWhatsappFieldSelect');
        const qualSelect = document.getElementById('pipedriveQualificationFieldSelect');
        const noteSelect = document.getElementById('pipedriveNoteFieldSelect');
        if (resFields.ok) {
            const fPayload = await resFields.json();
            const rawFields = fPayload.data || [];
            const customFields = rawFields.filter(f => f.edit_flag === true || f.field_type === 'phone' || f.field_type === 'varchar' || f.field_type === 'text' || f.field_type === 'large text');
            
            if (whatsappSelect) {
                whatsappSelect.innerHTML = '<option value="">-- None (No Icon) --</option>';
            }
            if (qualSelect) {
                qualSelect.innerHTML = '<option value="">-- None --</option>';
            }
            if (noteSelect) {
                noteSelect.innerHTML = '<option value="">-- None --</option>';
            }
            
            customFields.forEach(f => {
                if (whatsappSelect) {
                    const wOpt = document.createElement('option');
                    wOpt.value = f.key;
                    wOpt.textContent = `${f.name} (${f.field_type})`;
                    if (curBoard.pipedriveWhatsappFieldKey === f.key) wOpt.selected = true;
                    whatsappSelect.appendChild(wOpt);
                }
                
                if (qualSelect) {
                    const qOpt = document.createElement('option');
                    qOpt.value = f.key;
                    qOpt.textContent = `${f.name} (${f.field_type})`;
                    if (curBoard.pipedriveQualificationFieldKey === f.key) qOpt.selected = true;
                    qualSelect.appendChild(qOpt);
                }
                
                if (noteSelect) {
                    const nOpt = document.createElement('option');
                    nOpt.value = f.key;
                    nOpt.textContent = `${f.name} (${f.field_type})`;
                    if (curBoard.pipedriveNoteFieldKey === f.key) nOpt.selected = true;
                    noteSelect.appendChild(nOpt);
                }
            });
        }
        
        if (pipelineSelect) {
            pipelineSelect.innerHTML = '<option value="">-- Choose a Pipeline --</option>';
            pPipelines.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                
                if (preSelectedPipelineId) {
                    if (preSelectedPipelineId == p.id) opt.selected = true;
                } else if (curBoard.pipedrivePipelineId == p.id) {
                    opt.selected = true;
                }
                
                pipelineSelect.appendChild(opt);
            });
            
            const fetchStagesForPipeline = async (pipelineId) => {
                pipedriveTrackerCheckboxes.innerHTML = '<div style="padding:10px; font-size:13px; color:#5e6c84;">Loading stages...</div>';
                try {
                    const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/stages?pipeline_id=${pipelineId}&api_token=${pipedriveToken}`);
                    if(!res.ok) throw new Error("Failed parameter");
                    const payload = await res.json();
                    const pStages = payload.data || [];
                    
                    pipedriveTrackerCheckboxes.innerHTML = '';
                    pStages.forEach(ps => {
                        const row = document.createElement('label');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.padding = '10px 12px';
                        row.style.margin = '0 0 6px 0';
                        row.style.borderRadius = '6px';
                        row.style.background = '#ffffff';
                        row.style.border = '1px solid #dfe1e6';
                        row.style.cursor = 'pointer';
                        row.style.transition = 'all 0.2s ease';
                        row.onmouseenter = () => { row.style.boxShadow = '0 2px 4px rgba(9, 30, 66, 0.08)'; row.style.borderColor = 'var(--primary-color)'; };
                        row.onmouseleave = () => { row.style.boxShadow = 'none'; row.style.borderColor = '#dfe1e6'; };

                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.value = ps.id;
                        cb.className = 'pipedrive-tracker-cb';
                        cb.dataset.name = ps.name;
                        cb.style.cursor = 'pointer';
                        cb.style.margin = '0';
                        // Keep ID typing isolated safely with string casting checks
                        cb.checked = existingTrackerPipedriveIds.some(existingId => String(existingId) === String(ps.id));

                        const span = document.createElement('span');
                        span.textContent = ps.name;
                        span.style.marginLeft = '12px';
                        span.style.fontSize = '14px';
                        span.style.color = 'var(--text-color)';
                        span.style.fontWeight = '500';

                        row.appendChild(cb);
                        row.appendChild(span);
                        pipedriveTrackerCheckboxes.appendChild(row);
                    });
                } catch (err) {
                    showToast("Failed to fetch Pipedrive stages");
                    pipedriveTrackerCheckboxes.innerHTML = '';
                }
            };

            pipelineSelect.onchange = () => {
                const selectedPipelineId = pipelineSelect.value;
                if (selectedPipelineId) {
                    fetchStagesForPipeline(selectedPipelineId);
                } else {
                    pipedriveTrackerCheckboxes.innerHTML = '';
                }
            };
            
            if (pipelineSelect.value) {
                fetchStagesForPipeline(pipelineSelect.value);
            } else if (pPipelines.length > 0) {
                pipelineSelect.value = pPipelines[0].id;
                fetchStagesForPipeline(pPipelines[0].id);
            } else {
                pipedriveTrackerCheckboxes.innerHTML = '';
            }
        }
    } catch (err) {
        showToast("Failed to load Pipedrive API data.");
    }
    
    pipedriveMappingModal.classList.add('active');
}

if(generateTrelloTrackersBtn) {
    if(generateTrelloTrackersBtn) generateTrelloTrackersBtn.onclick = () => {
        try {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            const checkedList = Array.from(document.querySelectorAll('.trello-tracker-cb')).filter(cb => cb.checked);
            const checkedTrelloIds = checkedList.map(cb => cb.value);
            
            if (!activeBoard.connections) activeBoard.connections = [];
            
            const existingConnections = activeBoard.connections.filter(c => c.source === pendingSourceList.id);
            const typeMatch = window.pendingTrackerType || 'trello';
            const existingTrackers = existingConnections.map(c => activeBoard.lists.find(l => l.id === c.target)).filter(l => Boolean(l) && (l.trackerType || 'trello') === typeMatch);
            const existingTrackerTrelloIds = existingTrackers.map(l => l.trelloListId).filter(Boolean);
            
            const toAdd = checkedList.filter(cb => !existingTrackerTrelloIds.includes(cb.value));
            const toRemoveIds = existingTrackers.filter(l => l.trelloListId && !checkedTrelloIds.includes(String(l.trelloListId))).map(l => l.id);
            
            if (toRemoveIds.length > 0) {
                activeBoard.lists = activeBoard.lists.filter(l => !toRemoveIds.includes(l.id));
                activeBoard.connections = activeBoard.connections.filter(c => !toRemoveIds.includes(c.source) && !toRemoveIds.includes(c.target));
            }
            
            const direction = trelloSpawnDirection.value;
            const spacing = 340; 
            const oppositePorts = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            
            const boardSelect = document.getElementById('trelloMappingBoardSelect');
            const selectedBoardId = boardSelect ? boardSelect.value : null;

            const targetPortSelect = document.getElementById('trelloTargetPort');
            const targetPortValue = targetPortSelect && targetPortSelect.value !== 'auto' ? targetPortSelect.value : oppositePorts[direction];
            
            toAdd.forEach((inputCb) => {
                const targetTrackerType = window.pendingTrackerType || 'trello';
                const existingGlobalList = activeBoard.lists.find(l => l.trelloListId === inputCb.value && (l.trackerType || 'trello') === targetTrackerType);
                
                let targetListId;
                if (existingGlobalList) {
                    targetListId = existingGlobalList.id;
                } else {
                    targetListId = 'list_' + Date.now() + Math.random().toString(36).substr(2, 5);
                    activeBoard.lists.push({
                        id: targetListId,
                        title: inputCb.dataset.name,
                        x: 0,
                        y: 0,
                        cards: [],
                        trelloListId: inputCb.value,
                        trelloBoardId: selectedBoardId,
                        trackerType: targetTrackerType
                    });
                }
                
                activeBoard.connections.push({
                    source: pendingSourceList.id,
                    target: targetListId,
                    sourcePort: direction,
                    targetPort: targetPortValue
                });
            });
            
            const allActiveTrackers = activeBoard.lists.filter(l => 
                activeBoard.connections.some(c => c.source === pendingSourceList.id && c.target === l.id) &&
                l.trelloListId && 
                checkedTrelloIds.includes(l.trelloListId) &&
                (l.trackerType || 'trello') === typeMatch
            );
            
            if (allActiveTrackers.length > 0) {
                const preExistingCountForThisPort = activeBoard.connections.filter(c => 
                    c.source === pendingSourceList.id && 
                    c.sourcePort === direction &&
                    !allActiveTrackers.some(l => l.id === c.target)
                ).length;

                const typeRowOffset = typeMatch === 'ads' ? (pendingSourceList.adsOffsetY !== undefined ? pendingSourceList.adsOffsetY : 600) : 0;
                
                allActiveTrackers.forEach((list, index) => {
                    let nx = pendingSourceList.x;
                    let ny = pendingSourceList.y + typeRowOffset;
                    
                    const cascadeOffset = (index + preExistingCountForThisPort) * 40;
                    
                    if (direction === 'top') {
                        ny -= (400 + cascadeOffset);
                        nx += cascadeOffset;
                    } else if (direction === 'bottom') {
                        ny += (400 + cascadeOffset);
                        nx += cascadeOffset;
                    } else if (direction === 'left') {
                        nx -= (400 + cascadeOffset);
                        ny += cascadeOffset;
                    } else if (direction === 'right') {
                        nx += (400 + cascadeOffset);
                        ny += cascadeOffset;
                    }
                    
                    list.x = nx;
                    list.y = ny;
                    
                    const conn = activeBoard.connections.find(c => c.source === pendingSourceList.id && c.target === list.id);
                    if (conn) {
                        conn.sourcePort = direction;
                        conn.targetPort = targetPortValue;
                    }
                });
            }
            
            saveState();
            render();
            syncTrello();
            
            trelloMappingModal.classList.remove('active');
        } catch (e) {
            alert("JS Error: " + e.message);
        }
    };
}

if(generatePipedriveTrackersBtn) {
    if(generatePipedriveTrackersBtn) generatePipedriveTrackersBtn.onclick = () => {
        try {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            const checkedList = Array.from(document.querySelectorAll('.pipedrive-tracker-cb')).filter(cb => cb.checked);
            const checkedPipedriveIds = checkedList.map(cb => cb.value);
            
            if (!activeBoard.connections) activeBoard.connections = [];
            
            const existingConnections = activeBoard.connections.filter(c => c.source === pendingSourceList.id);
            const existingTrackers = existingConnections.map(c => activeBoard.lists.find(l => l.id === c.target)).filter(Boolean);
            const existingTrackerPipedriveIds = existingTrackers.map(l => l.pipedriveStageId).filter(Boolean);
            
            const toAdd = checkedList.filter(cb => !existingTrackerPipedriveIds.some(id => String(id) === cb.value));
            const toRemoveIds = existingTrackers.filter(l => l.pipedriveStageId && !checkedPipedriveIds.includes(String(l.pipedriveStageId))).map(l => l.id);
            
            if (toRemoveIds.length > 0) {
                activeBoard.lists = activeBoard.lists.filter(l => !toRemoveIds.includes(l.id));
                activeBoard.connections = activeBoard.connections.filter(c => !toRemoveIds.includes(c.source) && !toRemoveIds.includes(c.target));
            }
            
            const direction = pipedriveSpawnDirection.value;
            const spacing = 340; 
            const oppositePorts = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
            
            const pipelineSelect = document.getElementById('pipedriveMappingPipelineSelect');
            const selectedPipelineId = pipelineSelect ? pipelineSelect.value : null;

            const whatsappSelect = document.getElementById('pipedriveWhatsappFieldSelect');
            if (whatsappSelect) {
                activeBoard.pipedriveWhatsappFieldKey = whatsappSelect.value;
            }

            const qualSelect = document.getElementById('pipedriveQualificationFieldSelect');
            if (qualSelect) {
                activeBoard.pipedriveQualificationFieldKey = qualSelect.value;
            }
            
            const noteSelect = document.getElementById('pipedriveNoteFieldSelect');
            if (noteSelect) {
                activeBoard.pipedriveNoteFieldKey = noteSelect.value;
            }
            
            if (checkedPipedriveIds.length > 0) {
                activeBoard.pipedriveFirstStageId = String(checkedPipedriveIds[0]);
            }

            const targetPortSelect = document.getElementById('pipedriveTargetPort');
            const targetPortValue = targetPortSelect && targetPortSelect.value !== 'auto' ? targetPortSelect.value : oppositePorts[direction];
            
            toAdd.forEach((inputCb) => {
                const newListId = 'list_' + Date.now() + Math.random().toString(36).substr(2, 5);
                activeBoard.lists.push({
                    id: newListId,
                    title: inputCb.dataset.name,
                    x: 0,
                    y: 0,
                    cards: [],
                    pipedriveStageId: inputCb.value,
                    pipedrivePipelineId: selectedPipelineId
                });
                
                activeBoard.connections.push({
                    source: pendingSourceList.id,
                    target: newListId,
                    sourcePort: direction,
                    targetPort: targetPortValue
                });
            });
            
            const allActiveTrackers = activeBoard.lists.filter(l => 
                activeBoard.connections.some(c => c.source === pendingSourceList.id && c.target === l.id) &&
                l.pipedriveStageId && 
                checkedPipedriveIds.includes(String(l.pipedriveStageId))
            );
            
            if (allActiveTrackers.length > 0) {
                allActiveTrackers.forEach((list, index) => {
                    let nx = pendingSourceList.x;
                    let ny = pendingSourceList.y;
                    
                    const cascadeOffset = index * 40;
                    
                    if (direction === 'top') {
                        ny -= (400 + cascadeOffset);
                        nx += cascadeOffset;
                    } else if (direction === 'bottom') {
                        ny += (400 + cascadeOffset);
                        nx += cascadeOffset;
                    } else if (direction === 'left') {
                        nx -= (400 + cascadeOffset);
                        ny += cascadeOffset;
                    } else if (direction === 'right') {
                        nx += (400 + cascadeOffset);
                        ny += cascadeOffset;
                    }
                    
                    list.x = nx;
                    list.y = ny;
                    
                    const conn = activeBoard.connections.find(c => c.source === pendingSourceList.id && c.target === list.id);
                    if (conn) {
                        conn.sourcePort = direction;
                        conn.targetPort = targetPortValue;
                    }
                });
            }
            
            saveState();
            render();
            syncPipedrive(); // We will write this shortly!
            
            pipedriveMappingModal.classList.remove('active');
        } catch (e) {
            alert("JS Error: " + e.message);
        }
    };
}

if (localStorage.getItem('nav_position') === 'right') topNavBar.classList.add('pos-right');
if(toggleNavPosBtn) toggleNavPosBtn.onclick = () => {
    topNavBar.classList.toggle('pos-right');
    localStorage.setItem('nav_position', topNavBar.classList.contains('pos-right') ? 'right' : 'center');
};

const navItems = document.querySelectorAll('.nav-item');
if (navItems.length >= 3) {
    // Planner button
    navItems[1].onclick = () => {
        const smBoard = boards.find(b => b.type === 'social_scheduler');
        if (smBoard) {
            activeBoardId = smBoard.id;
            saveState();
            render();
        } else {
            const openAddBtn = document.getElementById('openAddSocialBoardBtn');
            if (openAddBtn) openAddBtn.click();
        }
    };
    // Board button
    navItems[2].onclick = () => {
        const kBoard = boards.find(b => b.type === 'kanban' || b.type === 'timer');
        if (kBoard) {
            activeBoardId = kBoard.id;
            saveState();
            render();
        }
    };
}

const clockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const stopwatchIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"></circle><polyline points="12 9 12 13 14 15"></polyline><line x1="12" y1="2" x2="12" y2="4"></line><line x1="8" y1="2" x2="16" y2="2"></line></svg>`;

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// Global functions
window.deleteBoard = function(boardId) {
    if (confirm("Are you sure you want to delete this entire workspace? All accounts and lists inside it will be lost!")) {
        boards = boards.filter(b => b.id !== boardId);
        if (boards.length > 0) activeBoardId = boards[0].id;
        else {
            boards = [{ id: 'board-' + Date.now(), title: 'Account', type: 'timer', cards: [] }];
            activeBoardId = boards[0].id;
        }
        saveState();
        render();
        showToast("Workspace deleted");
    }
};

window.switchBoard = function(boardId) {
    activeBoardId = boardId;
    saveState();
    render();
    switchBoardModal.classList.remove('active');
};

// Switch Boards Flow
if(openSwitchBoardsBtn) openSwitchBoardsBtn.onclick = () => {
    boardListMenu.innerHTML = '';
    boards.filter(b => b.type !== 'social_scheduler').forEach(b => {
        const item = document.createElement('div');
        item.className = 'board-menu-item' + (b.id === activeBoardId ? ' active' : '');
        
        let countText = b.type === 'kanban' ? `${b.lists.length} lists` : `${b.cards.length} accounts`;
        let tagColor = b.type === 'kanban' ? '#a855f7' : '#0c66e4';
        let bgTagColor = b.type === 'kanban' ? '#f3e8ff' : '#eff6ff';
        
        const leftWrap = document.createElement('div');
        leftWrap.style.display = 'flex';
        leftWrap.style.alignItems = 'center';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = b.title;
        titleSpan.className = 'editable-board-title';
        titleSpan.style.margin = '0 6px 0 0';
        titleSpan.style.cursor = 'text';
        titleSpan.title = 'Click to rename';
        
        if(titleSpan) titleSpan.onclick = (e) => {
            e.stopPropagation();
            titleSpan.contentEditable = 'true';
            titleSpan.classList.add('editing');
            titleSpan.focus();
            
            if (document.caretRangeFromPoint) {
                const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (caret) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(caret);
                }
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) {
                    const sel = window.getSelection();
                    sel.collapse(pos.offsetNode, pos.offset);
                }
            }
        };
        
        titleSpan.onblur = () => {
            titleSpan.contentEditable = 'false';
            titleSpan.classList.remove('editing');
            const newTitle = titleSpan.textContent.trim();
            if (newTitle && newTitle !== b.title) {
                b.title = newTitle;
                saveState();
                render();
            } else {
                titleSpan.textContent = b.title;
            }
        };
        
        titleSpan.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleSpan.blur();
            }
        };

        leftWrap.appendChild(titleSpan);

        const rightWrap = document.createElement('div');
        rightWrap.className = 'menu-right-wrap';

        const countSpan = document.createElement('span');
        countSpan.className = 'board-count-text';
        countSpan.textContent = countText;

        const dupBtn = document.createElement('button');
        dupBtn.className = 'icon-btn duplicate-board-btn';
        dupBtn.title = 'Duplicate Workspace';
        dupBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        
        if(dupBtn) dupBtn.onclick = (e) => {
            e.stopPropagation();
            
            if (!confirm("Are you sure you want to duplicate this workspace?")) return;
            if (!confirm("Are you REALLY sure you want to clone the entire application structure?")) return;

            const newBoard = JSON.parse(JSON.stringify(b));
            newBoard.id = 'board-' + Date.now();
            newBoard.title = b.title + ' Copy';
            
            if (newBoard.type === 'kanban') {
                newBoard.lists.forEach(l => {
                    l.id = 'list-' + Math.random().toString(36).substr(2, 9);
                    l.cards.forEach(c => {
                        c.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                    });
                });
            } else {
                newBoard.cards.forEach(c => {
                    c.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                });
            }
            
            boards.push(newBoard);
            activeBoardId = newBoard.id;
            saveState();
            render();
            switchBoardModal.classList.remove('active');
            showToast("Workspace duplicated!");
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-board-btn';
        deleteBtn.title = 'Delete Workspace';
        deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        
        if(deleteBtn) deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.promptSecureDelete === 'function') {
                window.promptSecureDelete(b.id, b.title || 'هذه المساحة');
            }
        };

        rightWrap.appendChild(countSpan);
        rightWrap.appendChild(dupBtn);
        if (boards.length > 1) {
            rightWrap.appendChild(deleteBtn);
        }

        item.appendChild(leftWrap);
        item.appendChild(rightWrap);

        if(item) item.onclick = () => switchBoard(b.id);
        boardListMenu.appendChild(item);
    });
    
    // Append single unified Social Media App button if clients exist
    const socialBoards = boards.filter(b => b.type === 'social_scheduler');
    if (socialBoards.length > 0) {
        const item = document.createElement('div');
        const isActive = socialBoards.some(b => b.id === activeBoardId);
        item.className = 'board-menu-item' + (isActive ? ' active' : '');
        
        item.innerHTML = `
            <div style="display:flex; align-items:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                <span style="font-weight: 700; color: #1a202c;">Social Media App</span>
            </div>
            <div class="menu-right-wrap">
                <span class="board-count-text">${socialBoards.length} clients</span>
            </div>
        `;
        
        if(item) item.onclick = () => switchBoard(socialBoards[0].id);
        item.style.borderTop = '1px dashed #e2e8f0';
        item.style.marginTop = '4px';
        
        boardListMenu.appendChild(item);
    }

    switchBoardModal.classList.add('active');
};
if(closeSwitchBoardModal) closeSwitchBoardModal.onclick = () => switchBoardModal.classList.remove('active');

const exportBackupBtn = document.getElementById('exportBackupBtn');
if (exportBackupBtn) {
    if(exportBackupBtn) exportBackupBtn.onclick = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(boards, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", "workspace_backup_" + new Date().toISOString().split('T')[0] + ".json");
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        showToast("Backup exported successfully!");
    };
}

const importBackupFile = document.getElementById('importBackupFile');
if (importBackupFile) {
    importBackupFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!confirm("Are you sure you want to import this workspace? This will OVERWRITE your current data!")) {
            importBackupFile.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (Array.isArray(importedData)) {
                    boards = importedData;
                    if (boards.length > 0) activeBoardId = boards[0].id;
                    saveState();
                    render();
                    showToast("Workspace imported successfully!");
                    switchBoardModal.classList.remove('active');
                } else {
                    alert("Invalid backup file: Please provide a valid workspace backup.");
                }
            } catch (err) {
                alert("Failed to read backup file. It might be corrupted.");
            }
        };
        reader.readAsText(file);
        importBackupFile.value = ''; // Reset to allow importing the same file again
    };
}

if (openAddTimerBoardBtn) {
    if(openAddTimerBoardBtn) openAddTimerBoardBtn.onclick = () => {
        switchBoardModal.classList.remove('active');
        newBoardTitle.value = '';
        pendingNewBoardType = 'timer';
        document.querySelector('#addBoardModal h3').textContent = 'Create Timer App';
        addBoardModal.classList.add('active');
        setTimeout(() => newBoardTitle.focus(), 50);
    };
}
if (openAddKanbanBoardBtn) {
    if(openAddKanbanBoardBtn) openAddKanbanBoardBtn.onclick = () => {
        switchBoardModal.classList.remove('active');
        newBoardTitle.value = '';
        pendingNewBoardType = 'kanban';
        document.querySelector('#addBoardModal h3').textContent = 'Create Kanban App';
        addBoardModal.classList.add('active');
        setTimeout(() => newBoardTitle.focus(), 50);
    };
}
if (openAddSocialBoardBtn) {
    if(openAddSocialBoardBtn) openAddSocialBoardBtn.onclick = () => {
        switchBoardModal.classList.remove('active');
        const smCount = boards.filter(b => b.type === 'social_scheduler').length;
        newBoardTitle.value = 'Client ' + (smCount + 1);
        pendingNewBoardType = 'social_scheduler';
        document.querySelector('#addBoardModal h3').textContent = 'Create Social Media Scheduler';
        addBoardModal.classList.add('active');
        setTimeout(() => newBoardTitle.focus(), 50);
    };
}
if(closeAddBoardModal) closeAddBoardModal.onclick = () => addBoardModal.classList.remove('active');
if(confirmAddBoardBtn) confirmAddBoardBtn.onclick = () => {
    const title = newBoardTitle.value.trim();
    if (title) {
        newBoardTitle.blur();
        const newBoard = { id: 'board-' + Date.now(), title: title, type: pendingNewBoardType };
        if (pendingNewBoardType === 'kanban') newBoard.lists = [];
        else newBoard.cards = [];
        
        boards.push(newBoard);
        activeBoardId = newBoard.id;
        saveState();
        render();
        addBoardModal.classList.remove('active');
        showToast("Workspace created!");
    }
};
newBoardTitle.onkeydown = (e) => { if (e.key === 'Enter') confirmAddBoardBtn.click(); };

function render() {
    if (isGlobalDragging) return;
    const activeEl = document.activeElement;
    if (activeEl) {
        const tag = activeEl.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || activeEl.isContentEditable) {
            return;
        }
    }

    const openMenus = document.querySelectorAll('.list-options-menu');
    for (let i = 0; i < openMenus.length; i++) {
        if (openMenus[i].style.display === 'block') {
            return;
        }
    }

    window.listScrolls = window.listScrolls || {};
    window.lastDOMPositions = {};
    document.querySelectorAll('.kanban-list').forEach(listEl => {
        const id = listEl.dataset.id;
        if (id) {
            const cardList = listEl.querySelector('.card-list');
            if (cardList) window.listScrolls[id] = cardList.scrollTop;
            window.lastDOMPositions[id] = { left: listEl.style.left, top: listEl.style.top };
        }
    });

    appContainer.innerHTML = '';
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard) return;
    
    document.title = `${activeBoard.title} | ${activeBoard.type === 'kanban' ? 'Managing' : activeBoard.type === 'social_scheduler' ? 'Social Scheduler' : 'AI Accounts Timer'}`;

    if (activeBoard.type === 'kanban') {
        appContainer.classList.remove('social-scheduler-view');
        appContainer.classList.add('managing-view');
        renderKanbanApp(activeBoard);
        
        // Force hardware-accelerated CSS paint to commit initial cached DOM positions
        appContainer.offsetHeight;
        
        // Execute dynamic geometry algorithms
        if (window.applySmartPacking) {
            const layoutModified = window.applySmartPacking(activeBoard);
            if (layoutModified) saveState();
        }
        
        // Push final mathematical coordinates to trigger native CSS zero-latency gliding
        activeBoard.lists.forEach(list => {
            const domNode = document.querySelector(`.kanban-list[data-id="${list.id}"]`);
            if (domNode) {
                if (domNode.classList.contains('hidden-list') && domNode.dataset.targetX) {
                    domNode.style.left = domNode.dataset.targetX + 'px';
                    domNode.style.top = domNode.dataset.targetY + 'px';
                } else {
                    domNode.style.left = list.x + 'px';
                    domNode.style.top = list.y + 'px';
                }
            }
        });
    } else {
        appContainer.classList.remove('managing-view');
        appContainer.classList.remove('social-scheduler-view');
        renderTimerApp(activeBoard);
    }
    
    // Clear global animation flags after render sequence wraps
    window.isFilterFadingIn = false;
}

window.toggleSentimentFilter = function(listId, type, color) {
    if (typeof boards === 'undefined' || typeof activeBoardId === 'undefined') return;
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard) return;

    if (!activeBoard.sentimentFilters) activeBoard.sentimentFilters = {};
    const key = `${listId}_${type}`;
    if (color === null || activeBoard.sentimentFilters[key] === color) {
        delete activeBoard.sentimentFilters[key];
    } else {
        activeBoard.sentimentFilters[key] = color;
    }
    
    // Animate transition and instantly update state
    window.isFilterFadingIn = true;
    
    const targetedList = activeBoard.lists.find(l => l.id === listId);
    if (targetedList && targetedList.collapsedEdges) {
        // Automatically un-collapse any pipeline edges (the Gold Boxes) hiding downstream lists of this filter type
        targetedList.collapsedEdges = targetedList.collapsedEdges.filter(edgeStr => !edgeStr.endsWith(`:${type}`));
    }
    
    saveState();
    updateAllTrackersSummaries(activeBoard);
    render();
    
    // Ensure connecting svg leader lines flow properly over the newly hidden layout DOM objects 
    if (typeof updateConnections === 'function') {
        setTimeout(updateConnections, 50);
        setTimeout(updateConnections, 360);
    }
};

function updateAllTrackersSummaries(activeBoard) {
    if (!activeBoard || !activeBoard.lists) return;
    activeBoard.lists.forEach(list => {
        const hasOutgoing = activeBoard.connections && activeBoard.connections.some(c => c.source === list.id);
        const isAdsTracker = list.trackerType === 'ads';
        const isTrelloTracker = (list.trelloListId || list.trelloTasksListId || list.trelloBoardId) && list.trackerType !== 'ads' && !list.isClientHappiness && !list.isMoneySmelling;

        if (hasOutgoing || isAdsTracker || isTrelloTracker) {
            let allDescendants = new Set();
            const getSubs = (sId) => {
                activeBoard.connections.forEach(c => {
                    if(c.source === sId && !allDescendants.has(c.target)){
                        allDescendants.add(c.target);
                        getSubs(c.target);
                    }
                });
            };
            getSubs(list.id);

            // Removed: Do not track its own cards in the tracker summary hub, 
            // as this confuses users when the hub also contains tasks that aren't part of the core tracker logic.
            // allDescendants.add(list.id);

            if (allDescendants.size > 0) {
                const summaryEl = document.querySelector(`.kanban-list[data-id="${list.id}"] .downstream-trackers-summary`);
                if (!summaryEl) return;
                
                let pdLeafNodes = Array.from(allDescendants).filter(tid => {
                    const l = activeBoard.lists.find(ll => ll.id === tid);
                    const isLeaf = !activeBoard.connections.some(c => c.source === tid);
                    const isDirectChild = activeBoard.connections.some(c => c.source === list.id && c.target === tid);
                    return l && l.pipedriveStageId && isLeaf && isDirectChild;
                });
                
                if (pdLeafNodes.length > 0) {
                    const lastPipeId = pdLeafNodes[pdLeafNodes.length - 1];
                    let greenCount = 0; let redCount = 0; let normalCount = 0;
                    
                    const l = activeBoard.lists.find(ll => ll.id === lastPipeId);
                    if (l && l.cards) {
                        l.cards.forEach(c => {
                            if (c.isPipedrive) {
                                if (c.color === 'green') greenCount++;
                                else if (c.color === 'red') redCount++;
                                else normalCount++;
                            }
                        });
                    }
                    
                    let htmlStr = '';
                    if (redCount > 0) htmlStr += `<div style="display:flex; align-items:center; background:rgba(201,55,44,0.15); color:#c9372c; padding:4px 8px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); gap:4px;">🔥 ${redCount}</div>`;
                    if (greenCount > 0) htmlStr += `<div style="display:flex; align-items:center; background:rgba(34,160,107,0.15); color:#1f845a; padding:4px 8px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); gap:4px;">✅ ${greenCount}</div>`;
                    if (normalCount > 0) htmlStr += `<div style="display:flex; align-items:center; background:rgba(9,30,66,0.06); color:#5E6C84; padding:4px 8px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); gap:4px;">⚪ ${normalCount}</div>`;
                    
                    if (!htmlStr) htmlStr = `<div style="display:flex; align-items:center; background:rgba(9,30,66,0.06); color:#5E6C84; padding:4px 8px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); gap:4px;">⚪ 0</div>`;
                    const pdLogo = `<div draggable="true" ondragstart="event.dataTransfer.setData('application/x-transfer-pd', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="display:inline-flex; align-items:center; justify-content:center; background:#2a2f35; color:#fff; width:24px; height:24px; border-radius:6px; font-weight:800; font-size:14px; font-family:system-ui,-apple-system,sans-serif; margin-bottom:4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor:grab;" title="Drag to transfer Pipedrive Integration">P</div>`;
                    summaryEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:4px; font-size: 12px; font-weight: 600;">${pdLogo}<div style="display:flex; align-items:center; gap: 8px;">${htmlStr}</div></div>`;
                } else if (list.trackerType === 'ads' || list.trackerType === 'trelloSpeech' || list.trelloListId || list.trelloTasksListId) {
                    let hasTrello = false;
                    let hasAds = false;
                    let hasTs = false;
                    let hasCH = false;
                    let hasMS = false;
                    let hasNC = false;
                    let tCards = 0; let tCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    let aCards = 0; let aCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    let tsCards = 0; let tsCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    let chCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    let msCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    let ncCol = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
                    
                    allDescendants.forEach(tid => {
                        const tList = activeBoard.lists.find(l => l.id === tid);
                        if (tList && tList.cards) {
                            const isAds = tList.trackerType === 'ads';
                            const isTs = tList.trackerType === 'trelloSpeech';
                            const isCH = tList.isClientHappiness;
                            const isMS = tList.isMoneySmelling;
                            const isNC = tList.isNewClients;
                            
                            if (isAds) hasAds = true;
                            else if (isTs) hasTs = true;
                            else if (isCH) hasCH = true;
                            else if (isMS) hasMS = true;
                            else if (isNC) hasNC = true;
                            else hasTrello = true;
                            
                            tList.cards.forEach(c => {
                                if (c.id && (c.id.length === 24 || String(c.id).startsWith('pd_'))) {
                                    const msColValue = (activeBoard.cardColors && activeBoard.cardColors[c.id]) ? activeBoard.cardColors[c.id] : 'default';
                                    const chColValue = (activeBoard.clientHappinessData && activeBoard.clientHappinessData[c.id]) ? activeBoard.clientHappinessData[c.id] : 'default';
                                    
                                    if (isAds) {
                                        aCards++; aCol[msColValue]++;
                                    } else if (isTs) {
                                        tsCards++; tsCol[msColValue]++;
                                    } else {
                                        tCards++;
                                        if (isCH) chCol[chColValue]++;
                                        else if (isMS) msCol[msColValue]++;
                                        else if (isNC) ncCol[msColValue]++;
                                        else tCol[msColValue]++;
                                    }
                                }
                            });
                        }
                    });

                    const buildTally = (counts, pId, type) => {
                        let h = '';
                        const getStyle = (color) => {
                            const key = `${pId}_${type}`;
                            const isActive = activeBoard.sentimentFilters && activeBoard.sentimentFilters[key] === color;
                            return isActive ? 'box-shadow: 0 0 0 2px currentColor; cursor:pointer;' : 'cursor:pointer; opacity:0.85;';
                        };
                        const getClick = (color) => `data-clicker="true" data-pid="${pId}" data-ptype="${type}" data-pcolor="${color}"`;

                        const isMoneyOrNc = type === 'moneySmelling' || type === 'newClients';
                        const svgs = {
                            green: isMoneyOrNc ? '<span style="font-size:14px;line-height:1;margin-top:1px;">🔥</span>' : '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            yellow: isMoneyOrNc ? '<span style="font-size:14px;line-height:1;margin-top:1px;">☀️</span>' : '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            orange: isMoneyOrNc ? '<span style="font-size:14px;line-height:1;margin-top:1px;">⛅</span>' : '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            red: isMoneyOrNc ? '<span style="font-size:14px;line-height:1;margin-top:1px;">❄️</span>' : '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            default: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#8c9bab" stroke-width="2.5"/></svg>'
                        };

                        if (counts.green > 0) h += `<div ${getClick('green')} style="display:flex;align-items:center;background:rgba(34,160,107,0.15);color:#1f845a;padding:2px 6px;border-radius:4px;gap:4px;${getStyle('green')}"><span style="display:flex;">${svgs.green}</span>${counts.green}</div>`;
                        if (counts.yellow > 0) h += `<div ${getClick('yellow')} style="display:flex;align-items:center;background:rgba(245,205,71,0.2);color:#b38600;padding:2px 6px;border-radius:4px;gap:4px;${getStyle('yellow')}"><span style="display:flex;">${svgs.yellow}</span>${counts.yellow}</div>`;
                        if (counts.orange > 0) h += `<div ${getClick('orange')} style="display:flex;align-items:center;background:rgba(255,152,0,0.15);color:#e65100;padding:2px 6px;border-radius:4px;gap:4px;${getStyle('orange')}"><span style="display:flex;">${svgs.orange}</span>${counts.orange}</div>`;
                        if (counts.red > 0) h += `<div ${getClick('red')} style="display:flex;align-items:center;background:rgba(201,55,44,0.15);color:#c9372c;padding:2px 6px;border-radius:4px;gap:4px;${getStyle('red')}"><span style="display:flex;">${svgs.red}</span>${counts.red}</div>`;
                        if (counts.default > 0) h += `<div ${getClick('default')} style="display:flex;align-items:center;background:rgba(9,30,66,0.04);color:#6b778c;padding:2px 6px;border-radius:4px;gap:4px;${getStyle('default')}"><span style="display:flex;">${svgs.default}</span>${counts.default}</div>`;
                        return h;
                    };

                    let finalHtml = `<div style="display:flex; flex-direction:column; gap:6px;">`;
                    
                    if (hasTrello || hasCH || hasMS || hasNC || (!hasTrello && !hasAds && !hasCH && !hasMS && !hasNC)) {
                        const tText = tCards === 1 ? '1 Card' : `${tCards} Cards`;
                        finalHtml += `
                            <div style="display:flex; align-items:center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <div data-clicker="true" data-pid="${list.id}" data-ptype="trello" data-pcolor="null" style="display:flex; align-items:center; gap: 4px; background: rgba(12, 102, 228, 0.08); color: #0c66e4; padding: 4px 10px; border-radius: 6px; cursor:pointer;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g stroke-width="1.8"><circle cx="10" cy="10" r="9.5"></circle><line x1="16.7" y1="16.7" x2="22.5" y2="22.5"></line></g><g transform="translate(10, 10) scale(0.65) translate(-12, -12)" stroke-width="2.77"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></g></svg>
                                    <span>${tText}</span>
                                </div>
                                ${hasCH && buildTally(chCol, list.id, 'clientHappiness') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(chCol, list.id, 'clientHappiness')}</div>` : ''}
                                ${hasMS && buildTally(msCol, list.id, 'moneySmelling') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(msCol, list.id, 'moneySmelling')}</div>` : ''}
                                ${hasNC && buildTally(ncCol, list.id, 'newClients') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(ncCol, list.id, 'newClients')}</div>` : ''}
                                ${hasTrello && buildTally(tCol, list.id, 'trello') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(tCol, list.id, 'trello')}</div>` : ''}
                            </div>
                        `;
                    }
                    
                    
                    if (hasTs) {
                        const tsText = tsCards === 1 ? '1 Task' : `${tsCards} Tasks`;
                        finalHtml += `
                            <div style="display:flex; align-items:center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <div data-clicker="true" data-pid="${list.id}" data-ptype="trelloSpeech" data-pcolor="null" style="display:flex; align-items:center; gap: 4px; background: rgba(156, 39, 176, 0.15); color: #7B1FA2; padding: 4px 10px; border-radius: 6px; cursor:pointer;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="6" x2="18" y2="6"></line></svg>
                                    <span>${tsText}</span>
                                </div>
                                ${buildTally(tsCol, list.id, 'trelloSpeech') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(tsCol, list.id, 'trelloSpeech')}</div>` : ''}
                            </div>
                        `;
                    }
                    
                    if (hasAds) {
                        const aText = aCards === 1 ? '1 Ad' : `${aCards} Ads`;
                        finalHtml += `
                            <div style="display:flex; align-items:center; gap: 8px; font-size: 12px; font-weight: 600;">
                                <div data-clicker="true" data-pid="${list.id}" data-ptype="ads" data-pcolor="null" style="display:flex; align-items:center; gap: 4px; background: rgba(0, 188, 212, 0.15); color: #00838F; padding: 4px 10px; border-radius: 6px; cursor:pointer;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>
                                    <span>${aText}</span>
                                </div>
                                ${buildTally(aCol, list.id, 'ads') !== '' ? `<div style="display:flex; gap:6px;">${buildTally(aCol, list.id, 'ads')}</div>` : ''}
                            </div>
                        `;
                    }
                    
                    finalHtml += `</div>`;

                    const summaryEl = document.querySelector(`.kanban-list[data-id="${list.id}"] .downstream-trackers-summary`);
                    if (summaryEl) {
                        summaryEl.innerHTML = finalHtml;
                        
                        summaryEl.querySelectorAll('[data-clicker="true"]').forEach(el => {
                            if(el) el.onclick = () => {
                                if (typeof window.toggleSentimentFilter === 'function') {
                                    window.toggleSentimentFilter(el.dataset.pid, el.dataset.ptype, el.dataset.pcolor === 'null' ? null : el.dataset.pcolor);
                                }
                            };
                        });
                    }
                }
            }
        }
    });
}

let animatingOutIds = new Set();
let animatingOrigins = {};
function renderKanbanApp(activeBoard) {
    document.body.style.background = '';
    appContainer.style.padding = '';
    if (!activeBoard.camera) activeBoard.camera = { x: 0, y: 0, z: 1 };

    const canvas = document.createElement('div');
    canvas.className = 'board-canvas';
    canvas.id = 'ui-board-canvas';
    canvas.style.backgroundPosition = `${activeBoard.camera.x}px ${activeBoard.camera.y}px`;

    const canvasContent = document.createElement('div');
    canvasContent.className = 'canvas-content';
    canvasContent.style.position = 'absolute';
    canvasContent.style.top = '0';
    canvasContent.style.left = '0';
    canvasContent.style.width = '100%';
    canvasContent.style.height = '100%';
    canvasContent.style.transformOrigin = '0 0';
    canvasContent.style.transform = `translate(${activeBoard.camera.x}px, ${activeBoard.camera.y}px) scale(${activeBoard.camera.z})`;
    canvas.appendChild(canvasContent);

    const svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgLayer.className = 'connections-layer';
    svgLayer.setAttribute('width', '100%');
    svgLayer.setAttribute('height', '100%');
    svgLayer.setAttribute('style', 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:1; overflow:visible;');
    canvasContent.appendChild(svgLayer);

    const getPortInfo = (listEl, edge, isTarget = false, offsetPx = 0) => {
        let px = parseInt(listEl.style.left);
        let py = parseInt(listEl.style.top);
        let nx = 0, ny = 0;
        const padding = isTarget ? 16 : 8;
        
        if (edge === 'top') {
            px += listEl.offsetWidth / 2;
            py -= padding;
            ny = -1;
        } else if (edge === 'bottom') {
            px += listEl.offsetWidth / 2;
            py += listEl.offsetHeight + padding;
            ny = 1;
        } else if (edge === 'left') {
            px -= padding;
            py += listEl.offsetHeight / 2;
            nx = -1;
        } else { // 'right'
            px += listEl.offsetWidth + padding;
            py += listEl.offsetHeight / 2;
            nx = 1;
        }
        
        const toggleEl = listEl.querySelector(`.port-toggle-${edge}`);
        if (toggleEl && !isTarget) {
            if (edge === 'top') { py -= 42; px += offsetPx; }
            else if (edge === 'bottom') { py += 42; px += offsetPx; }
            else if (edge === 'left') { px -= 42; py += offsetPx; }
            else if (edge === 'right') { px += 42; py += offsetPx; }
        }
        
        return { px, py, nx, ny };
    };

    const getBezierPath = (sourceInfo, targetInfo) => {
        const { px: sx, py: sy, nx: snx, ny: sny } = sourceInfo;
        const { px: tx, py: ty, nx: tnx, ny: tny } = targetInfo;
        
        const dist = Math.sqrt(Math.pow(tx - sx, 2) + Math.pow(ty - sy, 2));
        const offsetScale = Math.max(dist / 2, 60);
        
        const cp1x = sx + (snx * offsetScale);
        const cp1y = sy + (sny * offsetScale);
        
        const cp2x = tx + (tnx * offsetScale);
        const cp2y = ty + (tny * offsetScale);
        
        return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
    };

    const updateConnections = () => {
        svgLayer.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#8A94A5"/>
                </marker>
                <marker id="arrowhead-hover" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#c9372c"/>
                </marker>
            </defs>
        `;
        if(!activeBoard.connections) activeBoard.connections = [];
        
        activeBoard.connections.forEach(conn => {
            const sourceEl = canvas.querySelector(`.kanban-list[data-id="${conn.source}"]`);
            const targetEl = canvas.querySelector(`.kanban-list[data-id="${conn.target}"]`);
            if(!sourceEl || !targetEl) return;
            
            if (sourceEl.classList.contains('hidden-list') || targetEl.classList.contains('hidden-list')) {
                return;
            }
            
            const sourceEdge = conn.sourcePort || 'right';
            
            // Support dynamic geometric routing OR explicitly pinned target ports (for manual rewiring)
            const sRect = sourceEl.getBoundingClientRect();
            const tRect = targetEl.getBoundingClientRect();
            const autoTargetEdge = (sRect.left > tRect.left) ? 'right' : 'left';
            const targetEdge = conn.targetPort || autoTargetEdge;
            
            let offsetPx = 0;
            const toggleEl = sourceEl.querySelector(`.port-toggle-${sourceEdge}`);
            if (toggleEl) {
                let hasClientHappiness = false, hasMoneySmelling = false, hasNewClients = false, hasPipedrive = false, hasTrello = false, hasTrelloSpeech = false, hasAds = false;
                activeBoard.connections.forEach(c => {
                    if (c.source === conn.source && c.sourcePort === sourceEdge) {
                        const targList = activeBoard.lists.find(l => l.id === c.target);
                        if (targList) {
                            if (targList.isClientHappiness) hasClientHappiness = true;
                            if (targList.isMoneySmelling) hasMoneySmelling = true;
                            if (targList.isNewClients) hasNewClients = true;
                            if (targList.pipedriveStageId) hasPipedrive = true;
                            if (targList.trackerType === 'trelloSpeech') hasTrelloSpeech = true;
                            if ((targList.trelloTasksListId || targList.trelloBoardId || targList.trelloListId) && targList.trackerType !== 'ads' && targList.trackerType !== 'trelloSpeech') hasTrello = true;
                            if (targList.trackerType === 'ads') hasAds = true;
                        }
                    }
                });
                
                const targetList = activeBoard.lists.find(l => l.id === conn.target);
                let myType = 'trello';
                if (targetList) {
                    if (targetList.isClientHappiness) myType = 'clientHappiness';
                    else if (targetList.isMoneySmelling) myType = 'moneySmelling';
                    else if (targetList.isNewClients) myType = 'newClients';
                    else if (targetList.pipedriveStageId) myType = 'pipedrive';
                    else if (targetList.trackerType === 'ads') myType = 'ads';
                    else if (targetList.trackerType === 'trelloSpeech') myType = 'trelloSpeech';
                }
                
                const activeTypes = [];
                // Sort according to custom user edge preference, backing up to default otherwise
                if (hasClientHappiness) activeTypes.push('clientHappiness');
                if (hasMoneySmelling) activeTypes.push('moneySmelling');
                if (hasNewClients) activeTypes.push('newClients');
                if (hasPipedrive) activeTypes.push('pipedrive');
                if (hasTrello) activeTypes.push('trello');
                if (hasTrelloSpeech) activeTypes.push('trelloSpeech');
                if (hasAds) activeTypes.push('ads');
                
                const sList = activeBoard.lists.find(l => l.id === conn.source);
                const curOrder = sList && sList.edgeOrder && sList.edgeOrder[sourceEdge] ? sList.edgeOrder[sourceEdge] : ['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads'];
                activeTypes.sort((a, b) => {
                    let iA = curOrder.indexOf(a);
                    let iB = curOrder.indexOf(b);
                    if (iA === -1) iA = 999;
                    if (iB === -1) iB = 999;
                    return iA - iB;
                });
                
                let iconIndex = activeTypes.indexOf(myType);
                if (iconIndex === -1) iconIndex = 0;
                
                const totalIcons = activeTypes.length;
                if (totalIcons > 1) {
                    const iconSize = 32;
                    const gap = 18; 
                    const totalSpan = totalIcons * iconSize + (totalIcons - 1) * gap;
                    const startOffset = -totalSpan / 2 + iconSize / 2;
                    offsetPx = startOffset + iconIndex * (iconSize + gap);
                }
            }
            
            const sourceInfo = getPortInfo(sourceEl, sourceEdge, false, offsetPx);
            const targetInfo = getPortInfo(targetEl, targetEdge, true, 0);
            
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute('d', getBezierPath(sourceInfo, targetInfo));
            path.setAttribute('stroke', '#8A94A5');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', 'url(#arrowhead)');
            path.style.cursor = 'pointer';
            path.style.pointerEvents = 'stroke';
            
            path.onmouseenter = () => {
                path.setAttribute('stroke', '#c9372c');
                path.setAttribute('stroke-width', '4');
                path.setAttribute('marker-end', 'url(#arrowhead-hover)');
            };
            path.onmouseleave = () => {
                path.setAttribute('stroke', '#8A94A5');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('marker-end', 'url(#arrowhead)');
            };
            if(path) path.onclick = (e) => {
                e.stopPropagation();
                if(confirm("Disconnect these lists?")) {
                    activeBoard.connections = activeBoard.connections.filter(c => c !== conn);
                    saveState();
                    updateConnections();
                }
            };
            
            svgLayer.appendChild(path);
            
            // Generate an invisible, highly active SVG node precisely at the terminal point of the arrow path
            const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            handle.setAttribute('cx', targetInfo.px);
            handle.setAttribute('cy', targetInfo.py);
            handle.setAttribute('r', '12'); // Larger radius to easily catch user mouse actions (optical bounding box)
            handle.setAttribute('fill', 'transparent');
            handle.style.cursor = 'grab';
            handle.style.pointerEvents = 'all';

            handle.onmousedown = (e) => {
                e.stopPropagation();
                e.preventDefault();
                isGlobalDragging = true;
                
                // Erase the old connection visually and from memory so the user "holds" it natively
                activeBoard.connections = activeBoard.connections.filter(c => c !== conn);
                path.remove();
                handle.remove();
                
                const ghostPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                ghostPath.setAttribute('stroke', '#0c66e4');
                ghostPath.setAttribute('stroke-width', '3');
                ghostPath.setAttribute('stroke-dasharray', '5,5');
                ghostPath.setAttribute('fill', 'none');
                ghostPath.style.pointerEvents = 'none'; 
                
                const initialTarget = { px: targetInfo.px, py: targetInfo.py, nx: targetInfo.nx, ny: targetInfo.ny };
                ghostPath.setAttribute('d', getBezierPath(sourceInfo, initialTarget));
                svgLayer.appendChild(ghostPath);
                
                const onMove = (moveEvt) => {
                    const rect = canvas.getBoundingClientRect();
                    const tx = ((moveEvt.clientX - rect.left) - activeBoard.camera.x) / activeBoard.camera.z;
                    const ty = ((moveEvt.clientY - rect.top) - activeBoard.camera.y) / activeBoard.camera.z;
                    
                    const dx = tx - sourceInfo.px;
                    const dy = ty - sourceInfo.py;
                    let targetNormal = { nx: 0, ny: 0 };
                    if (Math.abs(dx) > Math.abs(dy)) targetNormal.nx = dx > 0 ? -1 : 1;
                    else targetNormal.ny = dy > 0 ? -1 : 1;
                    
                    const tInf = { px: tx, py: ty, nx: targetNormal.nx, ny: targetNormal.ny };
                    ghostPath.setAttribute('d', getBezierPath(sourceInfo, tInf));
                };
                
                const onUp = (upEvt) => {
                    isGlobalDragging = false;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    ghostPath.remove();
                    
                    const dropEl = document.elementFromPoint(upEvt.clientX, upEvt.clientY);
                    if (dropEl) {
                        const targetListContainer = dropEl.closest('.kanban-list');
                        if (targetListContainer) {
                            const targetListId = targetListContainer.dataset.id;
                            if (targetListId && targetListId !== conn.source) {
                                const rect = targetListContainer.getBoundingClientRect();
                                const dists = {
                                    top: Math.abs(upEvt.clientY - rect.top),
                                    bottom: Math.abs(upEvt.clientY - rect.bottom),
                                    left: Math.abs(upEvt.clientX - rect.left),
                                    right: Math.abs(upEvt.clientX - rect.right)
                                };
                                const newTargetEdge = Object.keys(dists).reduce((a, b) => dists[a] < dists[b] ? a : b);
                                
                                activeBoard.connections.push({
                                    source: conn.source,
                                    target: targetListId,
                                    sourcePort: sourceEdge,
                                    targetPort: newTargetEdge
                                });
                            }
                        }
                    }
                    saveState();
                    updateConnections();
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                onMove(e);
            };
            
            svgLayer.appendChild(handle);
        });
    };

    const updateTransform = () => {
        canvasContent.style.transform = `translate(${activeBoard.camera.x}px, ${activeBoard.camera.y}px) scale(${activeBoard.camera.z})`;
        canvas.style.backgroundPosition = `${activeBoard.camera.x}px ${activeBoard.camera.y}px`;
    };

    if(canvas) canvas.addEventListener('wheel', (e) => {
        const isPinch = e.ctrlKey || e.metaKey;
        const scrollableList = e.target.closest('.card-list, .pinned-list');
        
        // If they are scrolling vertically over a list normally, let the list scroll.
        // If they are physically PINCHING over a list, bypass the list and zoom the board.
        if (!isPinch && scrollableList && scrollableList.scrollHeight > Math.ceil(scrollableList.clientHeight) + 2) {
            return;
        }
        e.preventDefault();
        
        // Tuned for buttery smooth Mac Trackpad Pinch/Zoom and Mouse Wheel
        const zoomSensitivity = isPinch ? 0.002 : 0.001;
        const delta = e.deltaY * -zoomSensitivity;
        const newZ = Math.min(Math.max(0.1, activeBoard.camera.z + delta), 3);
        
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        activeBoard.camera.x = mx - (mx - activeBoard.camera.x) * (newZ / activeBoard.camera.z);
        activeBoard.camera.y = my - (my - activeBoard.camera.y) * (newZ / activeBoard.camera.z);
        activeBoard.camera.z = newZ;
        
        updateTransform();
        saveState();
    }, { passive: false });

    if(canvas) canvas.addEventListener('mousedown', (e) => {
        if (e.target === canvas || e.target === svgLayer || e.target === canvasContent) {
            isGlobalDragging = true;
            let startPanX = e.clientX - activeBoard.camera.x;
            let startPanY = e.clientY - activeBoard.camera.y;
            canvas.style.cursor = 'grabbing';

            const onPanMove = (moveEvt) => {
                activeBoard.camera.x = moveEvt.clientX - startPanX;
                activeBoard.camera.y = moveEvt.clientY - startPanY;
                updateTransform();
            };

            const onPanUp = () => {
                isGlobalDragging = false;
                canvas.style.cursor = 'default';
                document.removeEventListener('mousemove', onPanMove);
                document.removeEventListener('mouseup', onPanUp);
                saveState();
            };

            document.addEventListener('mousemove', onPanMove);
            document.addEventListener('mouseup', onPanUp);
        }
    });

    const hiddenListIds = new Set();
    const computeHidden = (sourceId, collapseKey) => {
        if (!activeBoard.connections) return;
        
        let edge = null;
        let tType = null;
        if (collapseKey) {
            const parts = collapseKey.split(':');
            edge = parts[0];
            tType = parts[1];
        }
        
        activeBoard.connections.forEach(c => {
            if (c.source === sourceId && (edge === null || c.sourcePort === edge)) {
                let matches = true;
                if (tType) {
                    const tl = activeBoard.lists.find(l => l.id === c.target);
                    if (tl) {
                        matches = false;
                        if (tType === 'clientHappiness' && tl.isClientHappiness) matches = true;
                        if (tType === 'moneySmelling' && tl.isMoneySmelling) matches = true;
                        if (tType === 'newClients' && tl.isNewClients) matches = true;
                        if (tType === 'pipedrive' && tl.pipedriveStageId) matches = true;
                        if (tType === 'trelloSpeech' && tl.trackerType === 'trelloSpeech') matches = true;
                        if (tType === 'trello' && (tl.trelloTasksListId || tl.trelloBoardId || tl.trelloListId) && tl.trackerType !== 'ads' && tl.trackerType !== 'trelloSpeech') matches = true;
                        if (tType === 'ads' && tl.trackerType === 'ads') matches = true;
                    }
                }
                
                if (matches && !hiddenListIds.has(c.target)) {
                    hiddenListIds.add(c.target);
                    computeHidden(c.target, null);
                }
            }
        });
    };
    
    activeBoard.lists.forEach(l => {
        if (l.collapsedEdges) {
            l.collapsedEdges.forEach(collapseKey => {
                computeHidden(l.id, collapseKey);
            });
        }
    });

    const effectiveFilters = {};
    if (activeBoard.sentimentFilters) {
        Object.keys(activeBoard.sentimentFilters).forEach(key => {
            const lastUS = key.lastIndexOf('_');
            const pId = key.substring(0, lastUS);
            const pType = key.substring(lastUS + 1);
            const color = activeBoard.sentimentFilters[key];
            let allD = new Set();
            const getD = (sId) => {
                if (!activeBoard.connections) return;
                activeBoard.connections.forEach(c => {
                    if (c.source === sId && !allD.has(c.target)) {
                        allD.add(c.target);
                        getD(c.target);
                    }
                    // Upstream graph traversal intentionally removed to prevent sibling branch pollution
                });
            };
            getD(pId);
            allD.forEach(childId => {
                const cl = activeBoard.lists.find(l => l.id === childId);
                if (cl && cl.id !== pId) {
                    if (pType === 'trello' && (cl.trelloTasksListId || cl.trelloBoardId || cl.trelloListId) && cl.trackerType !== 'ads') {
                        effectiveFilters[childId] = { value: color, type: pType };
                    } else if (pType === 'ads' && cl.trackerType === 'ads') {
                        effectiveFilters[childId] = { value: color, type: pType };
                    } else if (pType === 'clientHappiness' && cl.isClientHappiness) {
                        effectiveFilters[childId] = { value: color, type: pType };
                    } else if (pType === 'moneySmelling' && cl.isMoneySmelling) {
                        effectiveFilters[childId] = { value: color, type: pType };
                    } else if (pType === 'newClients' && cl.isNewClients) {
                        effectiveFilters[childId] = { value: color, type: pType };
                    }
                }
            });
        });
    }

    activeBoard.lists.forEach((list, listIndex) => {
        // Scrub accidental debug titles from localstorage
        if (list.title && (list.title.includes('D:[') || list.title.includes('Eff:['))) {
            list.title = list.title.replace(/D:\[.*?\] M:\[.*?\] \|\s*/g, '').replace(/Eff:\[.*?\] M:\[.*?\] \|\s*/g, '').trim();
            saveState();
        }

        let isFilteredOut = false;
        if (effectiveFilters[list.id]) {
            const hasMatch = list.cards.some(c => {
                const isCHContext = effectiveFilters[list.id].type === 'clientHappiness';
                let col = 'default';
                if (isCHContext) {
                    col = (activeBoard.clientHappinessData && activeBoard.clientHappinessData[c.id]) ? activeBoard.clientHappinessData[c.id] : 'default';
                } else {
                    col = (activeBoard.cardColors && activeBoard.cardColors[c.id]) ? activeBoard.cardColors[c.id] : 'default';
                }
                return col === effectiveFilters[list.id].value;
            });
            if (!hasMatch) isFilteredOut = true;
        }

        const isMeList = list.title && list.title.toLowerCase() === 'me';
        if ((list.trelloTasksListId || list.trelloBoardId || list.trelloListId) && list.trackerType !== 'ads' && list.cards.length === 0 && !hiddenListIds.has(list.id) && !isMeList) {
            isFilteredOut = true;
        }
        
        const hasLastPos = window.lastDOMPositions && window.lastDOMPositions[list.id];

        if (isFilteredOut && (!hasLastPos || list.cards.length === 0)) {
            // Guarantee that empty trackers, regardless of cache state or DOM history, are instantly evicted from canvas draw
            return;
        }

        let listCheckBtn, footerRow;
    const listContainer = document.createElement('div');
        listContainer.className = 'kanban-list list-container managing-board';
        if (list.collapsed) listContainer.classList.add('list-collapsed');
        if (list.theme === 'pipedrive' || (!list.theme && list.pipedriveStageId)) {
            listContainer.classList.add('pipedrive-box');
        }
        if (list.pipedriveStageId || list.trackerType === 'ads') listContainer.classList.add('auto-height-list');
        
        const isHiddenOrAnimating = hiddenListIds.has(list.id) || (typeof animatingOutIds !== 'undefined' && animatingOutIds.has(list.id)) || isFilteredOut;
        if (isHiddenOrAnimating) {
            listContainer.classList.add('hidden-list');
            listContainer.style.transition = 'none'; // Ensure CSS transitions don't drag out the death of an object
        }
        listContainer.dataset.id = list.id;
        
        // Universal Canvas Z-Index Engine: The most recently touched container unconditionally jumps to the top relative layer
        if(listContainer) listContainer.addEventListener('mousedown', () => {
            window.highestZIndex = (window.highestZIndex || 1000) + 1;
            // Native styling bypasses WebKit transition locks entirely
            listContainer.style.zIndex = window.highestZIndex;
        });
        
        listContainer.ondragover = (e) => {
            const hasTransfer = Array.from(e.dataTransfer.types).some(t => t.startsWith('application/x-transfer-'));
            if (hasTransfer) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                listContainer.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px #2a2f35';
            }
        };
        listContainer.ondragleave = (e) => {
            listContainer.style.boxShadow = '';
        };
        listContainer.ondrop = (e) => {
            const transferTypeObj = Array.from(e.dataTransfer.types).find(t => t.startsWith('application/x-transfer-'));
            if (transferTypeObj) {
                e.preventDefault();
                e.stopPropagation();
                listContainer.style.boxShadow = '';
                
                const trackerType = transferTypeObj.replace('application/x-transfer-', '');
                const sourceId = e.dataTransfer.getData(transferTypeObj);
                
                if (sourceId && sourceId !== list.id) {
                    const mappedType = trackerType === 'pd' ? 'pipedrive' : (trackerType === 'ch' ? 'clientHappiness' : (trackerType === 'ms' ? 'moneySmelling' : (trackerType === 'nc' ? 'newClients' : (trackerType === 'trello-speech' ? 'trelloSpeech' : trackerType))));
                    const formatNameMap = { 'pipedrive': 'Pipedrive', 'clientHappiness': 'Client Happiness', 'moneySmelling': 'Money Smelling', 'newClients': 'New Clients', 'trello': 'Trello', 'ads': 'Ads', 'trelloSpeech': 'Speech Lists' };
                    const formatName = formatNameMap[mappedType];
                    
                    const checkMatch = (t) => {
                        if (!t) return false;
                        if (mappedType === 'pipedrive') return t.pipedriveStageId;
                        if (mappedType === 'clientHappiness') return t.isClientHappiness;
                        if (mappedType === 'moneySmelling') return t.isMoneySmelling;
                        if (mappedType === 'newClients') return t.isNewClients;
                        if (mappedType === 'ads') return t.trackerType === 'ads';
                        if (mappedType === 'trelloSpeech') return t.trackerType === 'trelloSpeech';
                        if (mappedType === 'trello') return (t.trelloListId || t.trelloTasksListId) && t.trackerType !== 'ads' && t.trackerType !== 'trelloSpeech' && !t.isClientHappiness && !t.isMoneySmelling && !t.isNewClients;
                        return false;
                    };

                    const hasConflict = activeBoard.connections && activeBoard.connections.some(c => {
                        const t = activeBoard.lists.find(l => l.id === c.target);
                        if (c.source !== list.id || !t) return false;
                        return checkMatch(t);
                    });
                    
                    if (hasConflict) {
                        showToast(`This list already has a ${formatName} integration active.`);
                        return;
                    }
                    
                    if (activeBoard.connections) {
                        let transferred = false;
                        activeBoard.connections.forEach(c => {
                            if (c.source === sourceId) {
                                const targetList = activeBoard.lists.find(l => l.id === c.target);
                                if (checkMatch(targetList)) {
                                    c.source = list.id;
                                    transferred = true;
                                }
                            }
                        });
                        
                        if (transferred) {
                            const srcList = activeBoard.lists.find(l => l.id === sourceId);
                            if (srcList) {
                                if (mappedType === 'pipedrive') {
                                    list.pipedriveStageId = srcList.pipedriveStageId;
                                    delete srcList.pipedriveStageId;
                                } else if (mappedType === 'clientHappiness') {
                                    list.isClientHappiness = true;
                                    delete srcList.isClientHappiness;
                                } else if (mappedType === 'moneySmelling') {
                                    list.isMoneySmelling = true;
                                    delete srcList.isMoneySmelling;
                                } else if (mappedType === 'newClients') {
                                    list.isNewClients = true;
                                    delete srcList.isNewClients;
                                } else if (mappedType === 'trello') {
                                    if (srcList.trelloListId) { list.trelloListId = srcList.trelloListId; delete srcList.trelloListId; }
                                    if (srcList.trelloTasksListId) { list.trelloTasksListId = srcList.trelloTasksListId; delete srcList.trelloTasksListId; }
                                    if (srcList.trelloBoardId) { list.trelloBoardId = srcList.trelloBoardId; delete srcList.trelloBoardId; }
                                } else if (mappedType === 'ads') {
                                    list.trackerType = 'ads';
                                    if (srcList.trackerType === 'ads') delete srcList.trackerType;
                                    if (srcList.trelloListId) {
                                        list.trelloListId = srcList.trelloListId;
                                        delete srcList.trelloListId;
                                    }
                                }
                            }

                            if (typeof window.applySmartPacking === 'function') window.applySmartPacking(activeBoard);
                            saveState();
                            if (typeof updateConnections === 'function') updateConnections();
                            render();
                            showToast(`${formatName} Integration Transferred!`);
                        }
                    }
                }
            }
        };
        
        let cx = list.x;
        let cy = list.y;
        
        const needsSpawningVector = isHiddenOrAnimating || !hasLastPos;

        if (needsSpawningVector) {
            const parentConn = activeBoard.connections && activeBoard.connections.find(c => c.target === list.id);
            if (parentConn) {
                const parentList = activeBoard.lists.find(l => l.id === parentConn.source);
                if (parentList) {
                    const cacheKey = typeof animatingOrigins !== 'undefined' && parentList.id + '-' + (parentConn.sourcePort || 'right');
                    const cachedExactPort = typeof animatingOrigins !== 'undefined' ? animatingOrigins[cacheKey] : null;
                    
                    if (cachedExactPort) {
                        cx = cachedExactPort.px - 160;
                        cy = cachedExactPort.py - 50;
                    } else {
                        cx = parentList.x + (parentConn.sourcePort === 'right' ? 320 : parentConn.sourcePort === 'left' ? -160 : 160);
                        cy = parentList.y + (parentConn.sourcePort === 'bottom' ? 100 : parentConn.sourcePort === 'top' ? -100 : 50);
                    }
                }
            }
        }
        
        if (isHiddenOrAnimating) {
            listContainer.dataset.targetX = cx;
            listContainer.dataset.targetY = cy;
        }
        
        if (window.lastDOMPositions && window.lastDOMPositions[list.id]) {
            listContainer.style.left = window.lastDOMPositions[list.id].left;
            listContainer.style.top = window.lastDOMPositions[list.id].top;
        } else {
            listContainer.style.left = `${cx}px`;
            listContainer.style.top = `${cy}px`;
        }

        const header = document.createElement('div');
        header.className = 'list-header';
        header.style.cursor = 'grab';
        
        // Custom Absolute Coordinate Drag Engine
        header.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SVG' || e.target.tagName === 'CIRCLE' || e.target.isContentEditable) return;
            e.preventDefault();
            
            isGlobalDragging = true;
            let startX = e.clientX;
            let startY = e.clientY;
            let initialGrabX = list.x;
            let initialGrabY = list.y;
            list.isManualLayout = true;
            listContainer.classList.add('dragging');
            header.style.cursor = 'grabbing';
            
            let siblingsToMove = [];
            const getGroupType = (l) => {
                if (l.trackerType === 'trelloSpeech') return 'trelloSpeech';
                if (l.trackerType === 'ads') return 'ads';
                if (l.trelloTasksListId) return null; // Explicitly decouple Trello Tasks from cluster grouping
                if ((l.trelloListId || l.trelloBoardId) && !l.isClientHappiness && !l.isMoneySmelling) return 'trello';
                if (l.isClientHappiness) return 'ch';
                if (l.isMoneySmelling) return 'ms';
                if (l.pipedriveStageId) return 'pd';
                return null;
            };
            
            if (activeBoard.connections) {
                const groupType = getGroupType(list);
                if (groupType) {
                    const parentConns = activeBoard.connections.filter(c => c.target === list.id);
                    parentConns.forEach(pConn => {
                        activeBoard.connections.forEach(c => {
                            if (c.source === pConn.source && c.target !== list.id) {
                                const sib = activeBoard.lists.find(l => l.id === c.target);
                                if (sib && getGroupType(sib) === groupType && !siblingsToMove.includes(sib)) {
                                    siblingsToMove.push(sib);
                                }
                            }
                        });
                    });
                }
            }
            
            let shiftUsedDuringDrag = false;
            const onMouseMove = (moveEvent) => {
                if (moveEvent.shiftKey) shiftUsedDuringDrag = true;
                const dx = (moveEvent.clientX - startX) / activeBoard.camera.z;
                const dy = (moveEvent.clientY - startY) / activeBoard.camera.z;
                
                list.x += dx;
                list.y += dy;
                
                if (!moveEvent.shiftKey) {
                    siblingsToMove.forEach(sib => {
                        sib.isManualLayout = true; // Ensure siblings also permanently opt-out of mathematical snap-back during mid-drag visual physics
                        sib.x += dx;
                        sib.y += dy;
                        const sibDom = document.querySelector(`.kanban-list[data-id="${sib.id}"]`);
                        if (sibDom) {
                            sibDom.style.left = `${sib.x}px`;
                            sibDom.style.top = `${sib.y}px`;
                        }
                    });
                }
                
                startX = moveEvent.clientX;
                startY = moveEvent.clientY;
                
                listContainer.style.left = `${list.x}px`;
                listContainer.style.top = `${list.y}px`;
                updateConnections();
            };
            
            const onMouseUp = () => {
                isGlobalDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                listContainer.classList.remove('dragging');
                header.style.cursor = 'grab';
                
                const groupType = getGroupType(list);
                if ((groupType === 'trello' || groupType === 'trelloSpeech') && !shiftUsedDuringDrag) {
                    const pConn = activeBoard.connections.find(c => c.target === list.id);
                    const motherList = pConn ? activeBoard.lists.find(l => l.id === pConn.source) : null;
                    if (motherList) {
                        let totalDx = list.x - initialGrabX;
                        let totalDy = list.y - initialGrabY;
                        
                        if (groupType === 'trelloSpeech') {
                            if (motherList.trelloSpeechOffsetX === undefined) motherList.trelloSpeechOffsetX = 800;
                            if (motherList.trelloSpeechSpacingY === undefined) motherList.trelloSpeechSpacingY = 60;
                            motherList.trelloSpeechOffsetX += totalDx;
                            motherList.trelloSpeechSpacingY -= totalDy;
                        } else {
                            if (motherList.trelloOffsetX === undefined) motherList.trelloOffsetX = 0;
                            if (motherList.trelloSpacingY === undefined) motherList.trelloSpacingY = 60;
                            motherList.trelloOffsetX += totalDx;
                            motherList.trelloSpacingY -= totalDy;
                        }
                        
                        delete list.isManualLayout;
                        siblingsToMove.forEach(s => delete s.isManualLayout);
                        
                        if (window.applySmartPacking) window.applySmartPacking(activeBoard);
                        if (window.render) window.render();
                    }
                }
                
                saveState();
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        
        const titleH2 = document.createElement('h2');
        titleH2.textContent = list.title;
        titleH2.className = 'editable-board-title';
        titleH2.title = 'Click to rename';
        
        if(titleH2) titleH2.onclick = (e) => {
            if (list.trelloListId) {
                navigator.clipboard.writeText(list.title || titleH2.textContent).then(() => {
                    showToast("Title copied to clipboard!");
                }).catch(() => {});
                return;
            }

            titleH2.contentEditable = 'true';
            titleH2.classList.add('editing');
            titleH2.focus();
            
            if (document.caretRangeFromPoint) {
                const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (caret) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(caret);
                }
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) {
                    const sel = window.getSelection();
                    sel.collapse(pos.offsetNode, pos.offset);
                }
            }
        };
        
        titleH2.onblur = () => {
            titleH2.contentEditable = 'false';
            titleH2.classList.remove('editing');
            const newTitle = titleH2.textContent.trim();
            if (newTitle && newTitle !== list.title) {
                list.title = newTitle;
                saveState();
                render();
            } else {
                titleH2.textContent = list.title;
            }
        };
        
        titleH2.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleH2.blur();
            }
        };

        const optionsWrap = document.createElement('div');
        optionsWrap.style.position = 'relative';

        const optionsBtn = document.createElement('button');
        optionsBtn.className = 'icon-btn';
        optionsBtn.title = 'List Options';
        optionsBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>`;

        const optionsMenu = document.createElement('div');
        optionsMenu.className = 'list-options-menu';
        optionsMenu.style.display = 'none';

        const addDiv = () => {
            if (optionsMenu.children.length > 0 && !optionsMenu.lastElementChild.classList.contains('list-option-divider')) {
                const div = document.createElement('div');
                div.className = 'list-option-divider';
                optionsMenu.appendChild(div);
            }
        };

        // GROUP 1: INTEGRATIONS
        if (activeBoard.trelloBoardId && (list.trackerType !== 'ads' && list.trackerType !== 'trelloSpeech' || !list.trelloListId)) {
            const isUnlink = list.trelloListId && list.trackerType !== 'ads' && list.trackerType !== 'trelloSpeech';
            const icon = isUnlink ? `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>` : `<polyline points="20 6 9 17 4 12"></polyline>`;
            const text = isUnlink ? 'Unlink Trello Tracker' : 'Trello Tracker';
            
            const opt = document.createElement('div');
            opt.className = 'list-option-item';
            opt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${text}</span>`;
            if(opt) opt.onclick = (e) => {
                e.stopPropagation();
                if (list.trelloListId) {
                    if(confirm("Unlink this Trello tracker layout?")) {
                        list.trelloListId = null;
                        list.cards = list.cards.filter(c => !c.isTrello);
                        saveState();
                        render();
                    }
                } else openTrelloMappingGenerator(list);
                optionsMenu.style.display = 'none';
            };
            optionsMenu.appendChild(opt);
        }

        if (activeBoard.trelloBoardId && (list.trackerType === 'ads' || !list.trelloListId)) {
            const isUnlink = list.trelloListId && list.trackerType === 'ads';
            const icon = isUnlink ? `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>` : `<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>`;
            const text = isUnlink ? 'Unlink Ads Tracker' : 'Ads Tracker';
            
            const opt = document.createElement('div');
            opt.className = 'list-option-item';
            opt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${text}</span>`;
            if(opt) opt.onclick = (e) => {
                e.stopPropagation();
                if (list.trelloListId && list.trackerType === 'ads') {
                    if(confirm("Unlink this Ads tracker layout?")) {
                        list.trelloListId = null;
                        list.trackerType = null;
                        list.cards = list.cards.filter(c => !c.isTrello);
                        saveState();
                        render();
                    }
                } else openTrelloMappingGenerator(list, 'ads');
                optionsMenu.style.display = 'none';
            };
            optionsMenu.appendChild(opt);
        }

        if (activeBoard.trelloBoardId && (list.trackerType === 'trelloSpeech' || !list.trelloListId)) {
            const isUnlink = list.trelloListId && list.trackerType === 'trelloSpeech';
            const icon = isUnlink ? `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>` : `<line x1="12" y1="4" x2="12" y2="20"></line><line x1="4" y1="4" x2="20" y2="4"></line>`;
            const text = isUnlink ? 'Unlink Trello Tracker 2' : 'Trello Tracker 2';
            
            const opt = document.createElement('div');
            opt.className = 'list-option-item';
            opt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${text}</span>`;
            if(opt) opt.onclick = (e) => {
                e.stopPropagation();
                if (list.trelloListId && list.trackerType === 'trelloSpeech') {
                    if(confirm("Unlink this Trello Tracker 2 layout?")) {
                        list.trelloListId = null;
                        list.trackerType = null;
                        list.cards = list.cards.filter(c => !c.isTrello);
                        saveState();
                        render();
                    }
                } else openTrelloMappingGenerator(list, 'trelloSpeech');
                optionsMenu.style.display = 'none';
            };
            optionsMenu.appendChild(opt);
        }

        if (activeBoard.pipedrivePipelineId) {
            const isUnlink = !!list.pipedriveStageId;
            const icon = isUnlink ? `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>` : `<polyline points="20 6 9 17 4 12"></polyline>`;
            const text = isUnlink ? 'Unlink Pipedrive' : 'Pipedrive Tracker';
            
            const opt = document.createElement('div');
            opt.className = 'list-option-item';
            opt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${text}</span>`;
            if(opt) opt.onclick = (e) => {
                e.stopPropagation();
                if (list.pipedriveStageId) {
                    if(confirm("Unlink this Pipedrive tracker layout?")) {
                        list.pipedriveStageId = null;
                        list.cards = list.cards.filter(c => !c.isPipedrive);
                        saveState();
                        render();
                    }
                } else openPipedriveMappingGenerator(list);
                optionsMenu.style.display = 'none';
            };
            optionsMenu.appendChild(opt);
        }

        const existingClientHappinessConn = (activeBoard.connections || []).find(c => 
            c.source === list.id && activeBoard.lists.find(l => l.id === c.target && l.isClientHappiness)
        );
        const curHappinessIcon = existingClientHappinessConn ? `<polyline points="20 6 9 17 4 12"></polyline>` : `<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>`;
        const curHappinessText = existingClientHappinessConn ? 'Update Client Happiness' : 'Client Happiness';

        const clientHappinessOption = document.createElement('div');
        clientHappinessOption.className = 'list-option-item';
        clientHappinessOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${curHappinessIcon}</svg><span>${curHappinessText}</span>`;
        if(clientHappinessOption) clientHappinessOption.onclick = (e) => {
            e.stopPropagation();
            optionsMenu.style.display = 'none';
            pendingSourceList = list;
            
            const curBoard = boards.find(b => b.id === activeBoardId);
            const existingConnections = (curBoard.connections || []).filter(c => c.source === list.id && curBoard.lists.find(l => l.id === c.target && l.isClientHappiness));
            if (existingConnections.length > 0) {
                const clientHappinessSpawnDirectionEl = document.getElementById('clientHappinessSpawnDirection');
                const clientHappinessTargetPortEl = document.getElementById('clientHappinessTargetPort');
                if (clientHappinessSpawnDirectionEl) clientHappinessSpawnDirectionEl.value = existingConnections[0].sourcePort || 'right';
                const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
                if (existingConnections[0].targetPort !== opp[existingConnections[0].sourcePort || 'right']) {
                    if (clientHappinessTargetPortEl) clientHappinessTargetPortEl.value = existingConnections[0].targetPort || 'auto';
                } else {
                    if (clientHappinessTargetPortEl) clientHappinessTargetPortEl.value = 'auto';
                }
            } else {
                const clientHappinessSpawnDirectionEl = document.getElementById('clientHappinessSpawnDirection');
                const clientHappinessTargetPortEl = document.getElementById('clientHappinessTargetPort');
                if(clientHappinessSpawnDirectionEl) clientHappinessSpawnDirectionEl.value = 'right';
                if(clientHappinessTargetPortEl) clientHappinessTargetPortEl.value = 'auto';
            }
            
            if (clientHappinessMappingModal) {
                document.getElementById('generateClientHappinessTrackerBtn').textContent = existingClientHappinessConn ? "Update Tracker Position" : "Create Tracker";
                const unlinkBtn = document.getElementById('unlinkClientHappinessTrackerBtn');
                if (unlinkBtn) {
                    unlinkBtn.style.display = existingClientHappinessConn ? 'block' : 'none';
                }
                clientHappinessMappingModal.classList.add('active');
            }
        };
        optionsMenu.appendChild(clientHappinessOption);

        const existingMoneySmellingConn = (activeBoard.connections || []).find(c => 
            c.source === list.id && activeBoard.lists.find(l => l.id === c.target && l.isMoneySmelling)
        );
        const curMoneySmellingIcon = existingMoneySmellingConn ? `<polyline points="20 6 9 17 4 12"></polyline>` : `<line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>`;
        const curMoneySmellingText = existingMoneySmellingConn ? 'Update Money Smelling' : 'Money Smelling';

        const moneySmellingOption = document.createElement('div');
        moneySmellingOption.className = 'list-option-item';
        moneySmellingOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${curMoneySmellingIcon}</svg><span>${curMoneySmellingText}</span>`;
        if(moneySmellingOption) moneySmellingOption.onclick = (e) => {
            e.stopPropagation();
            optionsMenu.style.display = 'none';
            pendingSourceList = list;
            
            const curBoard = boards.find(b => b.id === activeBoardId);
            const existingConnections = (curBoard.connections || []).filter(c => c.source === list.id && curBoard.lists.find(l => l.id === c.target && l.isMoneySmelling));
            if (existingConnections.length > 0) {
                const moneySmellingSpawnDirectionEl = document.getElementById('moneySmellingSpawnDirection');
                const moneySmellingTargetPortEl = document.getElementById('moneySmellingTargetPort');
                if (moneySmellingSpawnDirectionEl) moneySmellingSpawnDirectionEl.value = existingConnections[0].sourcePort || 'right';
                const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
                if (existingConnections[0].targetPort !== opp[existingConnections[0].sourcePort || 'right']) {
                    if (moneySmellingTargetPortEl) moneySmellingTargetPortEl.value = existingConnections[0].targetPort || 'auto';
                } else {
                    if (moneySmellingTargetPortEl) moneySmellingTargetPortEl.value = 'auto';
                }
            } else {
                const moneySmellingSpawnDirectionEl = document.getElementById('moneySmellingSpawnDirection');
                const moneySmellingTargetPortEl = document.getElementById('moneySmellingTargetPort');
                if(moneySmellingSpawnDirectionEl) moneySmellingSpawnDirectionEl.value = 'right';
                if(moneySmellingTargetPortEl) moneySmellingTargetPortEl.value = 'auto';
            }
            
            if (moneySmellingMappingModal) {
                document.getElementById('generateMoneySmellingTrackerBtn').textContent = existingMoneySmellingConn ? "Update Tracker Position" : "Create Tracker";
                moneySmellingMappingModal.classList.add('active');
            }
        };
        optionsMenu.appendChild(moneySmellingOption);

        const existingNewClientsConn = (activeBoard.connections || []).find(c => 
            c.source === list.id && activeBoard.lists.find(l => l.id === c.target && l.isNewClients)
        );
        const curNewClientsIcon = existingNewClientsConn ? `<polyline points="20 6 9 17 4 12"></polyline>` : `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>`;
        const curNewClientsText = existingNewClientsConn ? 'Update New Clients' : 'New Clients';

        const newClientsOption = document.createElement('div');
        newClientsOption.className = 'list-option-item';
        newClientsOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${curNewClientsIcon}</svg><span>${curNewClientsText}</span>`;
        if(newClientsOption) newClientsOption.onclick = (e) => {
            e.stopPropagation();
            optionsMenu.style.display = 'none';
            pendingSourceList = list;
            
            const curBoard = boards.find(b => b.id === activeBoardId);
            const existingConnections = (curBoard.connections || []).filter(c => c.source === list.id && curBoard.lists.find(l => l.id === c.target && l.isNewClients));
            if (existingConnections.length > 0) {
                const newClientsSpawnDirectionEl = document.getElementById('newClientsSpawnDirection');
                const newClientsTargetPortEl = document.getElementById('newClientsTargetPort');
                if (newClientsSpawnDirectionEl) newClientsSpawnDirectionEl.value = existingConnections[0].sourcePort || 'right';
                const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
                if (existingConnections[0].targetPort !== opp[existingConnections[0].sourcePort || 'right']) {
                    if (newClientsTargetPortEl) newClientsTargetPortEl.value = existingConnections[0].targetPort || 'auto';
                } else {
                    if (newClientsTargetPortEl) newClientsTargetPortEl.value = 'auto';
                }
            } else {
                const newClientsSpawnDirectionEl = document.getElementById('newClientsSpawnDirection');
                const newClientsTargetPortEl = document.getElementById('newClientsTargetPort');
                if(newClientsSpawnDirectionEl) newClientsSpawnDirectionEl.value = 'right';
                if(newClientsTargetPortEl) newClientsTargetPortEl.value = 'auto';
            }
            
            if (newClientsMappingModal) {
                document.getElementById('generateNewClientsTrackerBtn').textContent = existingNewClientsConn ? "Update Tracker Position" : "Create Tracker";
                newClientsMappingModal.classList.add('active');
            }
        };
        optionsMenu.appendChild(newClientsOption);
        
        // GROUP 2: LAYOUT SETTINGS
        if (activeBoard.trelloBoardId) {
            addDiv();
            const layoutOption = document.createElement('div');
            layoutOption.className = 'list-option-item';
            layoutOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M3 9h18"></path><path d="M9 21V9"></path></svg><span>Set Trello Layout</span>`;
            if(layoutOption) layoutOption.onclick = (e) => {
                e.stopPropagation();
                optionsMenu.style.display = 'none';
                openTrelloLayoutModal(list);
            };
            optionsMenu.appendChild(layoutOption);
            
            const adsLayoutOption = document.createElement('div');
            adsLayoutOption.className = 'list-option-item';
            adsLayoutOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M3 9h18"></path><path d="M9 21V9"></path></svg><span>Set Ads Layout</span>`;
            if(adsLayoutOption) adsLayoutOption.onclick = (e) => {
                e.stopPropagation();
                optionsMenu.style.display = 'none';
                openAdsLayoutModal(list);
            };
            optionsMenu.appendChild(adsLayoutOption);

            const isTasksUnlink = !!list.trelloTasksListId;
            const tasksIcon = isTasksUnlink ? `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>` : `<path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>`;
            const tasksText = isTasksUnlink ? 'Unlink Trello Tasks' : 'Link Trello Tasks';
            
            const tasksOption = document.createElement('div');
            tasksOption.className = 'list-option-item';
            tasksOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tasksIcon}</svg><span>${tasksText}</span>`;
            if(tasksOption) tasksOption.onclick = (e) => {
                e.stopPropagation();
                if (list.trelloTasksListId) {
                    if(confirm("Unlink this Trello tasks list?")) {
                        list.trelloTasksListId = null;
                        list.trelloTasksBoardId = null;
                        list.cards = list.cards.filter(c => !c.isTrelloTask);
                        saveState();
                        render();
                    }
                } else openTrelloTasksMappingModal(list);
                optionsMenu.style.display = 'none';
            };
            optionsMenu.appendChild(tasksOption);
        }

        const isShowCheck = activeBoard.showListCheck && activeBoard.showListCheck[list.id];
        const checkOptionText = isShowCheck ? 'Hide List Check' : 'Show List Check';
        const checkOptionIcon = isShowCheck 
            ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"></path>`
            : `<circle cx="12" cy="12" r="10"></circle><path d="M9 12l2 2 4-4"></path>`;

        const checkOption = document.createElement('div');
        checkOption.className = 'list-option-item';
        checkOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${checkOptionIcon}</svg><span>${checkOptionText}</span>`;
        if (checkOption) checkOption.onclick = (e) => {
            e.stopPropagation();
            if (!activeBoard.showListCheck) activeBoard.showListCheck = {};
            const newVal = !activeBoard.showListCheck[list.id];
            activeBoard.showListCheck[list.id] = newVal;
            saveState();
            
            if (newVal) {
                if (footerRow && listCheckBtn) {
                    footerRow.insertBefore(listCheckBtn, footerRow.firstChild);
                }
            } else {
                if (listCheckBtn && listCheckBtn.parentElement) listCheckBtn.parentElement.removeChild(listCheckBtn);
            }

            checkOption.querySelector('span').textContent = newVal ? 'Hide List Check' : 'Show List Check';
            const iconHTML = newVal 
                ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"></path>`
                : `<circle cx="12" cy="12" r="10"></circle><path d="M9 12l2 2 4-4"></path>`;
            checkOption.querySelector('svg').innerHTML = iconHTML;

            optionsMenu.style.display = 'none';
        };
        optionsMenu.appendChild(checkOption);

        addDiv();
        const themeOption = document.createElement('div');
        themeOption.className = 'list-option-item';
        let currentTheme = list.theme || (list.pipedriveStageId ? 'pipedrive' : 'default');
        let nextTheme = currentTheme === 'default' ? 'pipedrive' : 'default';
        let themeName = nextTheme === 'pipedrive' ? 'Dark Theme' : 'Light Theme';
        let themeIcon = nextTheme === 'pipedrive' ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>` : `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
        
        themeOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${themeIcon}</svg><span>Switch to ${themeName}</span>`;
        if(themeOption) themeOption.onclick = (e) => {
            e.stopPropagation();
            list.theme = nextTheme;
            saveState();
            render();
            optionsMenu.style.display = 'none';
        };
        optionsMenu.appendChild(themeOption);

        // GROUP 4: DANGER ZONE
        addDiv();
        const deleteOption = document.createElement('div');
        deleteOption.className = 'list-option-item text-danger';
        deleteOption.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg><span>Delete List</span>`;
        if(deleteOption) deleteOption.onclick = (e) => {
            e.stopPropagation();
            if(confirm("Delete this entire list?")) {
                const actualIndex = activeBoard.lists.findIndex(l => l.id === list.id);
                if (actualIndex > -1) {
                    activeBoard.lists.splice(actualIndex, 1);
                }
                
                // Strictly purge all orphaned geometric connections mapping to or from the destroyed list
                if (activeBoard.connections) {
                    activeBoard.connections = activeBoard.connections.filter(c => c.source !== list.id && c.target !== list.id);
                }
                
                saveState();
                render();
            }
        };
        optionsMenu.appendChild(deleteOption);

        if(optionsBtn) optionsBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.list-options-menu').forEach(m => {
                if(m !== optionsMenu) m.style.display = 'none';
            });
            optionsMenu.style.display = optionsMenu.style.display === 'none' ? 'block' : 'none';
        };

        if(document) document.addEventListener('click', (e) => {
            if (!optionsWrap.contains(e.target)) {
                optionsMenu.style.display = 'none';
            }
        });

        const buttonsSet = document.createElement('div');
        buttonsSet.style.display = 'flex';
        buttonsSet.style.alignItems = 'center';
        buttonsSet.style.gap = '2px';

        buttonsSet.appendChild(optionsBtn);
        optionsWrap.appendChild(buttonsSet);
        optionsWrap.appendChild(optionsMenu);

        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.alignItems = 'center';
        titleRow.style.width = '100%';
        titleRow.style.gap = '8px';
        
        titleH2.style.flexGrow = '1';
        titleH2.style.marginRight = '8px'; // Give title breathing room to the right
        
        const rightControls = document.createElement('div');
        rightControls.style.display = 'flex';
        rightControls.style.alignItems = 'center';
        rightControls.style.gap = '4px';
        rightControls.style.flexShrink = '0';
        
        rightControls.appendChild(optionsWrap);
        
        titleRow.appendChild(titleH2);
        titleRow.appendChild(rightControls);
        
        header.style.flexDirection = 'column';
        header.style.alignItems = 'stretch';
        header.appendChild(titleRow);
        
        if (list.trelloListId) {
            const tBadge = document.createElement('span');
            if (list.trackerType === 'ads') {
                const cardCount = list.cards ? list.cards.length : 0;
                tBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; margin-bottom:-1px;"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>Ads Tracker (${cardCount})`;
                tBadge.title = "Connected as an Ads Tracker";
                tBadge.style.background = 'rgba(0, 188, 212, 0.15)';
                tBadge.style.color = '#00838F';
                tBadge.style.border = '1px solid rgba(0, 188, 212, 0.3)';
            } else if (list.trackerType === 'trelloSpeech') {
                tBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; margin-bottom:-1px;"><line x1="12" y1="4" x2="12" y2="20"></line><line x1="4" y1="4" x2="20" y2="4"></line></svg>Speech Lists`;
                tBadge.title = "Connected to track Speech Lists (Trello Tracker 2)";
                tBadge.style.background = 'rgba(156, 39, 176, 0.15)';
                tBadge.style.color = '#7B1FA2';
                tBadge.style.border = '1px solid rgba(156, 39, 176, 0.3)';
            } else {
                tBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px; margin-bottom:-1px;"><path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3ZM10 17C10 17.5523 9.55228 18 9 18H7C6.44772 18 6 17.5523 6 17V7C6 6.44772 6.44772 6 7 6H9C9.55228 6 10 6.44772 10 7V17ZM18 13C18 13.5523 17.5523 14 17 14H15C14.4477 14 14 13.5523 14 13V7C14 6.44772 14.4477 6 15 6H17C17.5523 6 18 6.44772 18 7V13Z"/></svg>Trello Tracker`;
                tBadge.title = "Connected natively to Trello";
                tBadge.style.background = 'rgba(12, 102, 228, 0.08)';
                tBadge.style.color = '#0c66e4';
                tBadge.style.border = '1px solid rgba(12, 102, 228, 0.2)';
            }
            
            tBadge.style.fontSize = '10px';
            tBadge.style.textTransform = 'uppercase';
            tBadge.style.letterSpacing = '0.5px';
            tBadge.style.fontWeight = '700';
            tBadge.style.padding = '4px 8px';
            tBadge.style.borderRadius = '12px';
            tBadge.style.marginTop = '2px';
            tBadge.style.display = 'inline-flex';
            tBadge.style.alignItems = 'center';
            tBadge.style.alignSelf = 'center';
            rightControls.appendChild(tBadge);
        }
        
        if (list.trelloTasksListId) {
            const tBadge = document.createElement('span');
            tBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; margin-bottom:-1px;"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>Trello Tasks`;
            tBadge.title = "Connected as a Trello Tasks list";
            tBadge.style.background = 'rgba(9, 30, 66, 0.08)';
            tBadge.style.color = '#5e6c84';
            tBadge.style.border = '1px solid rgba(9, 30, 66, 0.2)';
            tBadge.style.fontSize = '10px';
            tBadge.style.textTransform = 'uppercase';
            tBadge.style.letterSpacing = '0.5px';
            tBadge.style.fontWeight = '700';
            tBadge.style.padding = '4px 8px';
            tBadge.style.borderRadius = '12px';
            tBadge.style.marginTop = '2px';
            tBadge.style.display = 'inline-flex';
            tBadge.style.alignItems = 'center';
            tBadge.style.alignSelf = 'center';
            rightControls.appendChild(tBadge);
        }
        listContainer.appendChild(header);
        
        let listTotalValue = 0;
        let showListTotal = false;

        if (list.pipedriveStageId || list.isMoneySmelling || list.isNewClients) {
            showListTotal = true;
            list.cards.forEach(c => {
                if (c.isPipedrive && c.pipedriveData && c.pipedriveData.value) {
                    listTotalValue += Number(c.pipedriveData.value);
                } else if (!c.isPipedrive && c.dealValue) {
                    listTotalValue += Number(c.dealValue);
                }
            });
        }

        if (showListTotal && listTotalValue > 0) {
            const listTotalHeader = document.createElement('div');
            listTotalHeader.style.padding = "0px 16px 12px 16px";
            listTotalHeader.style.fontSize = "12px";
            listTotalHeader.style.fontWeight = "700";
            listTotalHeader.style.color = "#00875A";
            listTotalHeader.style.letterSpacing = "0.5px";
            listTotalHeader.style.display = "flex";
            listTotalHeader.style.alignItems = "center";
            listTotalHeader.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" style="width: 1.2em; height: 1.2em; margin-right: 6px; display: inline-block; flex-shrink: 0;">
                    <path fill="currentColor" d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"></path>
                    <path fill="currentColor" d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"></path>
                </svg>
                TOTAL: ${listTotalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            `;
            listContainer.appendChild(listTotalHeader);
        }


        const edges = ['top', 'right', 'bottom', 'left'];
        edges.forEach(edge => {
            const port = document.createElement('div');
            port.className = `board-port port-${edge}`;
            port.dataset.listId = list.id;
            port.dataset.edge = edge;
            
            port.onmousedown = (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                isGlobalDragging = true;
                const sourceInfo = getPortInfo(listContainer, edge, false);
                const ghostPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                ghostPath.setAttribute('stroke', '#0c66e4');
                ghostPath.setAttribute('stroke-width', '3');
                ghostPath.setAttribute('stroke-dasharray', '5,5');
                ghostPath.setAttribute('fill', 'none');
                ghostPath.style.pointerEvents = 'none'; 
                
                const initialTarget = { px: sourceInfo.px + sourceInfo.nx*40, py: sourceInfo.py + sourceInfo.ny*40, nx: -sourceInfo.nx, ny: -sourceInfo.ny };
                ghostPath.setAttribute('d', getBezierPath(sourceInfo, initialTarget));
                svgLayer.appendChild(ghostPath);
                
                const onMove = (moveEvt) => {
                    const rect = canvas.getBoundingClientRect();
                    const tx = ((moveEvt.clientX - rect.left) - activeBoard.camera.x) / activeBoard.camera.z;
                    const ty = ((moveEvt.clientY - rect.top) - activeBoard.camera.y) / activeBoard.camera.z;
                    
                    const dx = tx - sourceInfo.px;
                    const dy = ty - sourceInfo.py;
                    let targetNormal = { nx: 0, ny: 0 };
                    if (Math.abs(dx) > Math.abs(dy)) targetNormal.nx = dx > 0 ? -1 : 1;
                    else targetNormal.ny = dy > 0 ? -1 : 1;
                    
                    const targetInfo = { px: tx, py: ty, nx: targetNormal.nx, ny: targetNormal.ny };
                    ghostPath.setAttribute('d', getBezierPath(sourceInfo, targetInfo));
                };
                
                const onUp = (upEvt) => {
                    isGlobalDragging = false;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    ghostPath.remove();
                    
                    const dropEl = document.elementFromPoint(upEvt.clientX, upEvt.clientY);
                    if (dropEl) {
                        const targetListContainer = dropEl.closest('.kanban-list');
                        if (targetListContainer) {
                            const targetListId = targetListContainer.dataset.id;
                            if (targetListId && targetListId !== list.id) {
                                const rect = targetListContainer.getBoundingClientRect();
                                const dists = {
                                    top: Math.abs(upEvt.clientY - rect.top),
                                    bottom: Math.abs(upEvt.clientY - rect.bottom),
                                    left: Math.abs(upEvt.clientX - rect.left),
                                    right: Math.abs(upEvt.clientX - rect.right)
                                };
                                const targetEdge = Object.keys(dists).reduce((a, b) => dists[a] < dists[b] ? a : b);
                                
                                if (!activeBoard.connections) activeBoard.connections = [];
                                const exists = activeBoard.connections.find(c => c.source === list.id && c.target === targetListId && c.sourcePort === edge && c.targetPort === targetEdge);
                                if (!exists) {
                                    activeBoard.connections.push({ source: list.id, target: targetListId, sourcePort: edge, targetPort: targetEdge });
                                    saveState();
                                    updateConnections();
                                }
                            }
                        }
                    }
                };
                
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            };
            listContainer.appendChild(port);

            const hasTrelloTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.trelloListId && l.trackerType !== 'ads' && l.trackerType !== 'trelloSpeech')
            );
            const hasTrelloSpeechTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.trelloListId && l.trackerType === 'trelloSpeech')
            );
            const hasAdsTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.trelloListId && l.trackerType === 'ads')
            );
            const hasPipedriveTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.pipedriveStageId)
            );
            const hasClientHappinessTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.isClientHappiness)
            );
            const hasMoneySmellingTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.isMoneySmelling)
            );
            const hasNewClientsTrackers = activeBoard.connections && activeBoard.connections.some(c => 
                c.source === list.id && c.sourcePort === edge && activeBoard.lists.find(l => l.id === c.target && l.isNewClients)
            );
            
            const hasTrackersOnEdge = hasTrelloTrackers || hasTrelloSpeechTrackers || hasAdsTrackers || hasPipedriveTrackers || hasClientHappinessTrackers || hasMoneySmellingTrackers || hasNewClientsTrackers;
            
            if (hasTrackersOnEdge) {
                const toggleBtn = document.createElement('div');
                toggleBtn.className = `port-toggle port-toggle-${edge}`;
                
                if (!list.collapsedEdges) list.collapsedEdges = [];
                const isCollapsed = list.collapsedEdges.includes(edge);
                
                let iconsHtml = '';
                
                if (!list.collapsedEdges) list.collapsedEdges = [];
                // Migrate legacy all-edge collapse state to granular state if needed
                if (list.collapsedEdges.includes(edge)) {
                    list.collapsedEdges = list.collapsedEdges.filter(e => e !== edge);
                    if (hasClientHappinessTrackers) list.collapsedEdges.push(`${edge}:clientHappiness`);
                    if (hasMoneySmellingTrackers) list.collapsedEdges.push(`${edge}:moneySmelling`);
                    if (hasNewClientsTrackers) list.collapsedEdges.push(`${edge}:newClients`);
                    if (hasPipedriveTrackers) list.collapsedEdges.push(`${edge}:pipedrive`);
                    if (hasTrelloTrackers) list.collapsedEdges.push(`${edge}:trello`);
                    if (hasTrelloSpeechTrackers) list.collapsedEdges.push(`${edge}:trelloSpeech`);
                }
                
                list.edgeOrder = list.edgeOrder || {};
                const userOrder = list.edgeOrder[edge] || ['clientHappiness', 'moneySmelling', 'newClients', 'pipedrive', 'trello', 'trelloSpeech', 'ads'];
                const edgeDict = {};
                
                if (hasClientHappinessTrackers) {
                    const isChCollapsed = list.collapsedEdges.includes(`${edge}:clientHappiness`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'clientHappiness');"`;
                    if (isChCollapsed) {
                        edgeDict['clientHappiness'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ch', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="clientHappiness" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); transform: scale(1.1); margin-top:2px;">
                                <circle cx="12" cy="12" r="10" fill="#FFCA28" stroke="#F57F17" stroke-width="1.5"/>
                                <circle cx="8.5" cy="9" r="1.5" fill="#4E342E"/>
                                <circle cx="15.5" cy="9" r="1.5" fill="#4E342E"/>
                                <path d="M7 13.5 Q12 18.5 17 13.5" fill="none" stroke="#4E342E" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['clientHappiness'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ch', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="clientHappiness" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 0px 12px rgba(255, 202, 40, 0.9)); transform: scale(1.1); margin-top:-2px;">
                                <circle cx="12" cy="12" r="10" fill="#FFE082" stroke="#FF8F00" stroke-width="1.5"/>
                                <circle cx="8.5" cy="9" r="1.5" fill="#4E342E"/>
                                <circle cx="15.5" cy="9" r="1.5" fill="#4E342E"/>
                                <path d="M7 13 Q12 19.5 17 13" fill="none" stroke="#4E342E" stroke-width="2.5" stroke-linecap="round"/>
                                <ellipse cx="6" cy="12" rx="1.5" ry="1" fill="#FF8A65" opacity="0.6"/>
                                <ellipse cx="18" cy="12" rx="1.5" ry="1" fill="#FF8A65" opacity="0.6"/>
                            </svg>
                        </div>`;
                    }
                }
                
                if (hasMoneySmellingTrackers) {
                    const isMsCollapsed = list.collapsedEdges.includes(`${edge}:moneySmelling`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'moneySmelling');"`;
                    if (isMsCollapsed) {
                        edgeDict['moneySmelling'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ms', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="moneySmelling" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); transform: scale(1.1); margin-top:2px;">
                                <circle cx="12" cy="12" r="10" fill="#2E7D32" stroke="#1B5E20" stroke-width="1.5"/>
                                <g transform="translate(2.4, 2.4) scale(0.8)">
                                    <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" fill="#FFFFFF"/>
                                </g>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['moneySmelling'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ms', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="moneySmelling" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 0px 12px rgba(76, 175, 80, 0.9)); transform: scale(1.1); margin-top:-2px;">
                                <circle cx="12" cy="12" r="10" fill="#4CAF50" stroke="#2E7D32" stroke-width="1.5"/>
                                <g transform="translate(2.4, 2.4) scale(0.8)">
                                    <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" fill="#FFFFFF"/>
                                </g>
                            </svg>
                        </div>`;
                    }
                }

                if (hasNewClientsTrackers) {
                    const isNcCollapsed = list.collapsedEdges.includes(`${edge}:newClients`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'newClients');"`;
                    if (isNcCollapsed) {
                        edgeDict['newClients'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-nc', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="newClients" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); transform: scale(1.1); margin-top:2px;">
                                <circle cx="12" cy="12" r="10" fill="#1b8859" stroke="#126340" stroke-width="1.5"/>
                                <path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 7a5 5 0 0 1 10 0" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['newClients'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-nc', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="newClients" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 0px 12px rgba(34, 160, 107, 0.9)); transform: scale(1.1); margin-top:-2px;">
                                <circle cx="12" cy="12" r="10" fill="#22a06b" stroke="#1b8859" stroke-width="1.5"/>
                                <path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 7a5 5 0 0 1 10 0" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>`;
                    }
                }
                
                if (hasPipedriveTrackers) {
                    const isPdCollapsed = list.collapsedEdges.includes(`${edge}:pipedrive`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'pipedrive');"`;
                    if (isPdCollapsed) {
                        edgeDict['pipedrive'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-pd', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="pipedrive" width="32" height="32" viewBox="0 0 100 100" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); transform: scale(1.2); margin-top:2px;">
                                <text x="50" y="80" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="90" fill="#ffffff" stroke="#26292c" stroke-width="4" text-anchor="middle" letter-spacing="-2">p</text>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['pipedrive'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-pd', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="pipedrive" width="32" height="32" viewBox="0 0 100 100" style="filter: drop-shadow(0 0px 12px rgba(34, 197, 94, 0.9)); transform: scale(1.2); margin-top:-2px;">
                                <text x="50" y="80" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="90" fill="#ffffff" stroke="#26292c" stroke-width="4" text-anchor="middle" letter-spacing="-2">p</text>
                            </svg>
                        </div>`;
                    }
                }
                
                if (hasTrelloTrackers) {
                    const isTlCollapsed = list.collapsedEdges.includes(`${edge}:trello`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'trello');"`;
                    const chestId = `clip-${list.id}-${edge}`;
                    
                    if (isTlCollapsed) {
                        edgeDict['trello'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-trello', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="trello" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); transform: scale(1.1);">
                                <defs><clipPath id="${chestId}"><path d="M3 10 C3 3 21 3 21 10 Z"/></clipPath></defs>
                                <path d="M3 10 L21 10 L21 20 C21 21.1 20.1 22 19 22 L5 22 C3.9 22 3 21.1 3 20 Z" fill="#6D4C41" stroke="#3E2723" stroke-width="1.5" stroke-linejoin="round"/>
                                <rect x="5.5" y="10" width="3.5" height="12" fill="#FFC107" stroke="#FF8F00" stroke-width="1"/>
                                <rect x="15" y="10" width="3.5" height="12" fill="#FFC107" stroke="#FF8F00" stroke-width="1"/>
                                <path d="M3 10 C3 3 21 3 21 10 Z" fill="#795548"/>
                                <rect x="5.5" y="3" width="3.5" height="7" fill="#FFC107" stroke="#FF8F00" stroke-width="1" clip-path="url(#${chestId})"/>
                                <rect x="15" y="3" width="3.5" height="7" fill="#FFC107" stroke="#FF8F00" stroke-width="1" clip-path="url(#${chestId})"/>
                                <path d="M3 10 C3 3 21 3 21 10 Z" fill="none" stroke="#3E2723" stroke-width="1.5"/>
                                <path d="M4 7 Q12 5 20 7" fill="none" stroke="#5D4037" stroke-width="1.5" clip-path="url(#${chestId})"/>
                                <rect x="10" y="8" width="4" height="5" rx="1.5" fill="#FFD54F" stroke="#F57F17" stroke-width="1.5"/>
                                <circle cx="12" cy="10" r="1" fill="#3E2723"/>
                                <path d="M11.5 10 L11.5 11.5 L12.5 11.5 L12.5 10 Z" fill="#3E2723"/>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['trello'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-trello', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="trello" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 8px rgba(255,215,0,0.7)); transform: scale(1.1);">
                                <path d="M3 12 L21 12 L21 20 C21 21.1 20.1 22 19 22 L5 22 C3.9 22 3 21.1 3 20 Z" fill="#6D4C41" stroke="#3E2723" stroke-width="1.5" stroke-linejoin="round"/>
                                <rect x="5.5" y="12" width="3.5" height="10" fill="#FFC107" stroke="#FF8F00" stroke-width="1"/>
                                <rect x="15" y="12" width="3.5" height="10" fill="#FFC107" stroke="#FF8F00" stroke-width="1"/>
                                <ellipse cx="12" cy="12" rx="9" ry="3" fill="#3E2723"/>
                                <ellipse cx="12" cy="11.5" rx="7" ry="2" fill="#FFE082" />
                                <path d="M5 11.5 Q12 -5 19 11.5 Z" fill="#FFF59D" opacity="0.6"/>
                                <path d="M8 11.5 Q12 -2 16 11.5 Z" fill="#FFFFFF" opacity="0.8"/>
                                <path d="M3 11 C3 8 21 8 21 11 L19 5 C19 1 5 1 5 5 Z" fill="#795548" stroke="#3E2723" stroke-width="1.5" stroke-linejoin="round"/>
                                <path d="M3 11 C3 8 21 8 21 11" fill="none" stroke="#5D4037" stroke-width="1"/>
                                <path d="M6 10.5 L6.5 5.5" fill="none" stroke="#FFC107" stroke-width="3"/>
                                <path d="M18 10.5 L17.5 5.5" fill="none" stroke="#FFC107" stroke-width="3"/>
                                <rect x="10" y="12" width="4" height="3" rx="1.5" fill="#FFD54F" stroke="#F57F17" stroke-width="1.5"/>
                            </svg>
                        </div>`;
                    }
                }
                
                if (hasTrelloSpeechTrackers) {
                    const isTsCollapsed = list.collapsedEdges.includes(`${edge}:trelloSpeech`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'trelloSpeech');"`;
                    
                    if (isTsCollapsed) {
                        edgeDict['trelloSpeech'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-trello-speech', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="trelloSpeech" width="28" height="28" viewBox="0 0 24 24" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); background: rgba(156, 39, 176, 0.8); border-radius: 6px; border: 2px solid #7B1FA2; margin-top: 3px;">
                                <circle cx="12" cy="12" r="10" fill="transparent"/>
                                <line x1="12" y1="6" x2="12" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round"></line>
                                <line x1="6" y1="6" x2="18" y2="6" stroke="#fff" stroke-width="3" stroke-linecap="round"></line>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['trelloSpeech'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-trello-speech', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="trelloSpeech" width="28" height="28" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 8px rgba(156, 39, 176, 0.7)); background: #9C27B0; border-radius: 6px; border: 2px solid #7B1FA2; margin-top: 3px;">
                                <circle cx="12" cy="12" r="10" fill="transparent"/>
                                <line x1="12" y1="6" x2="12" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round"></line>
                                <line x1="6" y1="6" x2="18" y2="6" stroke="#fff" stroke-width="3" stroke-linecap="round"></line>
                            </svg>
                        </div>`;
                    }
                }
                
                if (hasAdsTrackers) {
                    const isAdsCollapsed = list.collapsedEdges.includes(`${edge}:ads`);
                    const dropAttr = `ondragover="event.preventDefault();" ondrop="if(window.handleToggleReorder) window.handleToggleReorder(event, '${list.id}', '${edge}', 'ads');"`;
                    if (isAdsCollapsed) {
                        edgeDict['ads'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ads', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="ads" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); transform: scale(1.1);">
                                <circle cx="12" cy="12" r="10" fill="#00838F" stroke="#004D40" stroke-width="1.5"/>
                                <path d="M7 15 L11 11 L14 14 L18 10" fill="none" stroke="#18FFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <polyline points="15 10 18 10 18 13" fill="none" stroke="#18FFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <circle cx="7" cy="15" r="1.5" fill="#FFFFFF"/>
                                <circle cx="11" cy="11" r="1.5" fill="#FFFFFF"/>
                                <circle cx="14" cy="14" r="1.5" fill="#FFFFFF"/>
                                <circle cx="18" cy="10" r="1.5" fill="#FFFFFF"/>
                            </svg>
                        </div>`;
                    } else {
                        edgeDict['ads'] = `<div ${dropAttr} draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('application/x-transfer-ads', '${list.id}'); event.dataTransfer.effectAllowed='move';" style="cursor:inherit; display:inline-flex; align-items:center; justify-content:center;">
                            <svg data-tracker-type="ads" width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 8px rgba(0, 229, 255, 0.7)); transform: scale(1.1);">
                                <circle cx="12" cy="12" r="11" fill="none" stroke="#00E5FF" stroke-width="1" stroke-dasharray="2 2" opacity="0.8"/>
                                <circle cx="12" cy="12" r="9" fill="#006064" stroke="#00251A" stroke-width="1.5"/>
                                <path d="M7 14 L11 10 L14 13 L18 8" fill="none" stroke="#18FFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <polyline points="15 8 18 8 18 11" fill="none" stroke="#18FFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <circle cx="18" cy="8" r="1.5" fill="#FFFFFF"/>
                            </svg>
                        </div>`;
                    }
                }
                
                userOrder.forEach(type => {
                    if (edgeDict[type]) {
                        iconsHtml += edgeDict[type];
                        delete edgeDict[type];
                    }
                });
                
                Object.values(edgeDict).forEach(htmlStr => iconsHtml += htmlStr);
                const getTargs = (sId, sEdge, targetSet) => {
                    if(!activeBoard.connections) return;
                    activeBoard.connections.forEach(c => {
                        if(c.source === sId && (sEdge === null || c.sourcePort === sEdge)) {
                            if(!targetSet.has(c.target)){
                                targetSet.add(c.target);
                                getTargs(c.target, null, targetSet);
                            }
                        }
                    });
                };
                
                toggleBtn.innerHTML = iconsHtml;
                toggleBtn.title = 'Toggle Trackers';
                toggleBtn.onmousedown = (e) => e.stopPropagation();
                if(toggleBtn) toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    const svgNode = e.target.closest('svg');
                    if (!svgNode) return;
                    
                    const tType = svgNode.getAttribute('data-tracker-type');
                    if (!tType) return;
                    
                    const collapseKey = `${edge}:${tType}`;
                    const willCollapse = !list.collapsedEdges.includes(collapseKey);
                    
                    // Filter exact targets for this clicked tracker type
                    const specificTargets = new Set();
                    activeBoard.connections.forEach(c => {
                        if(c.source === list.id && c.sourcePort === edge) {
                            const tl = activeBoard.lists.find(l => l.id === c.target);
                            if (!tl) return;
                            
                            let matches = false;
                            if (tType === 'clientHappiness' && tl.isClientHappiness) matches = true;
                            if (tType === 'moneySmelling' && tl.isMoneySmelling) matches = true;
                            if (tType === 'newClients' && tl.isNewClients) matches = true;
                            if (tType === 'pipedrive' && tl.pipedriveStageId) matches = true;
                            if (tType === 'trelloSpeech' && tl.trackerType === 'trelloSpeech') matches = true;
                            if (tType === 'trello' && (tl.trelloTasksListId || tl.trelloBoardId || tl.trelloListId) && tl.trackerType !== 'ads' && tl.trackerType !== 'trelloSpeech') matches = true;
                            if (tType === 'ads' && tl.trelloListId && tl.trackerType === 'ads') matches = true;
                            
                            if (matches) {
                                specificTargets.add(c.target);
                                getTargs(c.target, null, specificTargets);
                            }
                        }
                    });

                    if (willCollapse) {
                        list.collapsedEdges.push(collapseKey);
                        saveState();
                        
                        specificTargets.forEach(tid => {
                            const el = document.querySelector(`.kanban-list[data-id="${tid}"]`);
                            if (el) {
                                el.classList.add('hidden-list');
                                const tConn = activeBoard.connections.find(c => c.target === tid);
                                if (tConn) {
                                    const pEl = document.querySelector(`.kanban-list[data-id="${tConn.source}"]`);
                                    if (pEl) {
                                        const pInfo = getPortInfo(pEl, tConn.sourcePort || 'right');
                                        el.style.left = `${pInfo.px - 160}px`;
                                        el.style.top = `${pInfo.py - (el.offsetHeight / 2)}px`;
                                    }
                                }
                            }
                        });
                        
                        updateConnections();
                        setTimeout(() => render(), 360);
                    } else {
                        list.collapsedEdges = list.collapsedEdges.filter(st => st !== collapseKey);
                        saveState();
                        
                        if (typeof animatingOrigins !== 'undefined') {
                            animatingOrigins[list.id + '-' + edge] = getPortInfo(listContainer, edge);
                        }

                        specificTargets.forEach(tid => animatingOutIds.add(tid));
                        render();
                    }
                };
                listContainer.appendChild(toggleBtn);
            }
        });

        const pinnedListEl = document.createElement('div');
        pinnedListEl.className = 'pinned-list';
        pinnedListEl.dataset.listId = list.id;
        pinnedListEl.style.display = 'flex';
        pinnedListEl.style.flexDirection = 'column';
        pinnedListEl.style.gap = '8px';
        pinnedListEl.style.padding = '10px 12px 0 12px';
        pinnedListEl.style.marginBottom = '8px';
        pinnedListEl.style.maxHeight = '40vh';
        pinnedListEl.style.overflowY = 'auto';
        pinnedListEl.style.flexShrink = '0';

        const cardListEl = document.createElement('div');
        cardListEl.className = 'card-list';
        cardListEl.dataset.listId = list.id;
        
        if (window.isFilterFadingIn && (list.isClientHappiness || list.isMoneySmelling)) {
            cardListEl.style.opacity = '0';
            cardListEl.style.transform = 'translateY(-5px)';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    cardListEl.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out';
                    cardListEl.style.opacity = '1';
                    cardListEl.style.transform = 'translateY(0px)';
                });
            });
        }
        
        if (list.trelloTasksListId) {
            const showBtn = document.createElement('button');
            showBtn.className = 'add-card-btn';
            showBtn.style.margin = '4px 4px 8px 4px';
            showBtn.style.width = 'calc(100% - 8px)';
            showBtn.style.display = 'flex';
            showBtn.style.justifyContent = 'flex-start';
            showBtn.style.alignItems = 'center';
            showBtn.style.backgroundColor = 'transparent';
            showBtn.style.color = '#5e6c84';
            showBtn.style.fontWeight = '500';
            showBtn.style.fontSize = '14px';
            showBtn.style.padding = '8px 10px';
            showBtn.style.borderRadius = '8px';
            showBtn.style.transition = 'background-color 0.2s ease, color 0.2s ease';
            showBtn.onmouseover = () => { showBtn.style.backgroundColor = '#091e4214'; showBtn.style.color = '#172b4d'; };
            showBtn.onmouseout = () => { showBtn.style.backgroundColor = 'transparent'; showBtn.style.color = '#5e6c84'; };
            const taskCount = list.cards.filter(c => c.isTrelloTask && !c.isPinned).length;
            
            window.expandedTrelloLists = window.expandedTrelloLists || new Set();
            let isExpanded = window.expandedTrelloLists.has(list.id);
            
            // Initial z-index assignment based on expanded state
            if (isExpanded) {
                listContainer.style.zIndex = Math.max(window.highestZIndex || 1000, 1000);
            } else {
                listContainer.style.zIndex = '10';
            }
            
            if (isExpanded) {
                showBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M18 15l-6-6-6 6"></path></svg> Hide Tasks (${taskCount})`;
            } else {
                showBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M6 9l6 6 6-6"></path></svg> Show Tasks (${taskCount})`;
            }
            
            if(showBtn) showBtn.onclick = (e) => {
                e.stopPropagation();
                isExpanded = !isExpanded;
                
                // Elevate z-index so the expanded tasks drop definitively over neighboring nodes below
                if (isExpanded) {
                    window.highestZIndex = (window.highestZIndex || 1000) + 1;
                    listContainer.style.zIndex = window.highestZIndex;
                } else {
                    listContainer.style.zIndex = '10';
                }
                
                if (isExpanded) {
                    window.expandedTrelloLists.add(list.id);
                    showBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M18 15l-6-6-6 6"></path></svg> Hide Tasks (${taskCount})`;
                } else {
                    window.expandedTrelloLists.delete(list.id);
                    showBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M6 9l6 6 6-6"></path></svg> Show Tasks (${taskCount})`;
                }
                
                const taskCards = cardListEl.querySelectorAll('.trello-task-card');
                taskCards.forEach(c => {
                    if (isExpanded) c.classList.remove('collapsed');
                    else c.classList.add('collapsed');
                });
                
                const start = performance.now();
                const animateConnections = (time) => {
                    if (typeof updateConnections === 'function') updateConnections();
                    if (time - start < 400) requestAnimationFrame(animateConnections);
                };
                requestAnimationFrame(animateConnections);
            };
            cardListEl.appendChild(showBtn);
        }

        let cardsToRender = list.cards;
        if (activeBoard.isolateCardId) {
            cardsToRender = list.cards.filter(c => c.id === activeBoard.isolateCardId);
        } else if (list.isClientHappiness || list.isMoneySmelling || list.isNewClients) {
            let activeH = null, activeS = null;
            const h = activeBoard.happinessFilters || {};
            const s = activeBoard.serviceFilters || {};
            
            if (list.isClientHappiness && (h['clientHappiness'] || s['clientHappiness'])) { 
                activeH = h['clientHappiness']; activeS = s['clientHappiness']; 
            } else if (list.isMoneySmelling && (h['moneySmelling'] || s['moneySmelling'])) { 
                activeH = h['moneySmelling']; activeS = s['moneySmelling']; 
            } else if (list.isNewClients && (h['newClients'] || s['newClients'])) { 
                activeH = h['newClients']; activeS = s['newClients']; 
            }
            
            if (activeH || activeS) {
                cardsToRender = list.cards.filter(card => {
                    let match = true;
                    if (activeH) {
                        const color = (activeBoard.clientHappinessData && activeBoard.clientHappinessData[card.id]) ? activeBoard.clientHappinessData[card.id] : 'default';
                        match = match && color === activeH;
                    }
                    if (activeS) {
                        match = match && card.services && card.services.includes(activeS);
                    }
                    return match;
                });
            }
        } else if (effectiveFilters[list.id]) {
            cardsToRender = list.cards.filter(card => {
                const isCHContext = effectiveFilters[list.id].type === 'clientHappiness';
                let color = 'default';
                if (isCHContext) {
                    color = (activeBoard.clientHappinessData && activeBoard.clientHappinessData[card.id]) ? activeBoard.clientHappinessData[card.id] : 'default';
                } else {
                    color = (activeBoard.cardColors && activeBoard.cardColors[card.id]) ? activeBoard.cardColors[card.id] : 'default';
                }
                return color === effectiveFilters[list.id].value;
            });
        }
        
        cardsToRender.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            cardEl.dataset.cardId = card.id;
            
            if (activeBoard.isolateCardId === card.id) {
                cardEl.style.boxShadow = '0 0 0 3px #0c66e4, 0 8px 24px rgba(12, 102, 228, 0.4)';
                cardEl.style.transform = 'scale(1.02)';
            }
            
            if (list.trelloTasksListId) {
                cardEl.classList.add('trello-task-card');
                if ((!window.expandedTrelloLists || !window.expandedTrelloLists.has(list.id)) && !card.isPinned) {
                    cardEl.classList.add('collapsed');
                }
            }
            
            if (card.color === 'red') {
                cardEl.style.borderLeft = '3px solid #ae2e24';
                cardEl.style.backgroundColor = '#fff2f0';
            } else if (card.color === 'green') {
                cardEl.style.borderLeft = '3px solid #22a06b';
                cardEl.style.backgroundColor = '#eaf2e3';
            } else if (card.color === 'yellow') {
                cardEl.style.borderLeft = '3px solid #b38600';
                cardEl.style.backgroundColor = 'rgba(245,205,71,0.15)';
            } else if (card.color === 'orange') {
                cardEl.style.borderLeft = '3px solid #e65100';
                cardEl.style.backgroundColor = 'rgba(255,152,0,0.15)';
            }
            
            if (card.isPipedrive) {
                if(cardEl) cardEl.onclick = () => openPipedriveActionModal(card.id, list.id);
            } else if (card.isTrelloTask) {
                if(cardEl) cardEl.onclick = () => openTrelloCardDetailsModal(card.id, list.id);
                if (!card.color || card.color === 'default') cardEl.style.borderLeft = '3px solid #5e6c84';
            } else if (!card.isTrello) {
                if (list.isMoneySmelling) {
                    if(cardEl) cardEl.onclick = () => openPipedriveActionModal(card.id, list.id);
                    cardEl.style.cursor = 'pointer';
                    // Since it opens PipedriveActionModal, maybe blue border like others:
                    if (!card.color || card.color === 'default') cardEl.style.borderLeft = '3px solid #00875A'; // Smell nice green!
                } else {
                    if(cardEl) cardEl.onclick = () => openTimerModal(card.id, list.id);
                }
            } else if (list.trackerType === 'ads') {
                if (!card.color || card.color === 'default') cardEl.style.borderLeft = '3px solid #0c66e4';
                cardEl.style.cursor = 'default';
            } else {
                if(cardEl) cardEl.onclick = () => openTrelloCardDetailsModal(card.id, list.id);
                if (!card.color || card.color === 'default') cardEl.style.borderLeft = '3px solid #0c66e4';
                cardEl.style.cursor = 'pointer';
            }

            const titleEl = document.createElement('div');
            titleEl.className = 'card-title';
            
            const leftCol = document.createElement('div');
            leftCol.style.flex = "1";
            leftCol.style.paddingRight = "8px";
            leftCol.style.display = "flex";
            leftCol.style.flexDirection = "column";
            leftCol.style.gap = "4px";
            
            const titleTextWrap = document.createElement('span');
            titleTextWrap.textContent = card.title;
            titleTextWrap.style.lineHeight = "1.3";
            titleTextWrap.style.cursor = 'text';
            titleTextWrap.style.padding = '2px';
            titleTextWrap.style.margin = '-2px';
            titleTextWrap.style.borderRadius = '4px';
            titleTextWrap.style.transition = 'background 0.2s';
            titleTextWrap.style.outline = 'none';
            titleTextWrap.dir = 'auto';
            
            if (!card.isTrello) {
                titleTextWrap.contentEditable = 'false';
                if(titleTextWrap) titleTextWrap.onclick = (e) => {
                    e.stopPropagation();
                    if (titleTextWrap.contentEditable !== 'true') {
                        titleTextWrap.contentEditable = 'true';
                        setTimeout(() => {
                            titleTextWrap.focus();
                            // Optional: Select text
                        }, 10);
                    }
                };
                titleTextWrap.onfocus = () => {
                    titleTextWrap.style.background = 'rgba(9, 30, 66, 0.08)';
                    titleTextWrap.style.cursor = 'text';
                };
                titleTextWrap.onblur = async () => {
                    titleTextWrap.contentEditable = 'false';
                    titleTextWrap.style.background = '';
                    titleTextWrap.style.cursor = 'pointer';
                    const newTitle = titleTextWrap.textContent.trim();
                    if (newTitle && newTitle !== card.title) {
                        const oldTitle = card.title;
                        card.title = newTitle;
                        saveState();
                        render();
                        
                        if (card.isPipedrive) {
                            const pId = String(card.id).replace('pd_', '');
                            try {
                                const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${pId}?api_token=${pipedriveToken}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ title: newTitle })
                                });
                                if (!res.ok) throw new Error("Failed");
                                if (card.pipedriveData) card.pipedriveData.title = newTitle;
                                syncPipedrive();
                                const modalInput = document.getElementById('pipedriveActionDealTitleInput');
                                if (modalInput && typeof activePipedriveDealId !== 'undefined' && activePipedriveDealId === pId) {
                                    modalInput.value = newTitle;
                                }
                            } catch (e) {
                                showToast("Failed to rename Pipedrive deal");
                                card.title = oldTitle;
                                saveState();
                                render();
                            }
                        }
                    } else {
                        titleTextWrap.textContent = card.title;
                    }
                };
                titleTextWrap.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        titleTextWrap.blur();
                    }
                };
            }
            
            leftCol.appendChild(titleTextWrap);
            
            let subtitleTextWrap = null;
            if (list.trackerType === 'ads') {
                if (!activeBoard.cardSubtitles) activeBoard.cardSubtitles = {};
                subtitleTextWrap = document.createElement('span');
            subtitleTextWrap.textContent = activeBoard.cardSubtitles[card.id] || 'Add subtitle...';
            if (!activeBoard.cardSubtitles[card.id]) {
                subtitleTextWrap.style.display = 'none';
            }
            
            subtitleTextWrap.style.lineHeight = "1.3";
            subtitleTextWrap.style.cursor = 'text';
            subtitleTextWrap.style.padding = '2px';
            subtitleTextWrap.style.margin = '2px -2px -2px -2px';
            subtitleTextWrap.style.borderRadius = '4px';
            subtitleTextWrap.style.transition = 'background 0.2s';
            subtitleTextWrap.style.outline = 'none';
            subtitleTextWrap.style.fontSize = '12px';
            subtitleTextWrap.style.color = '#5e6c84';
            subtitleTextWrap.dir = 'auto';
            
            subtitleTextWrap.contentEditable = 'false';
            if(subtitleTextWrap) subtitleTextWrap.onclick = (e) => {
                e.stopPropagation();
                if (subtitleTextWrap.contentEditable !== 'true') {
                    subtitleTextWrap.contentEditable = 'true';
                    setTimeout(() => {
                        subtitleTextWrap.focus();
                        if (subtitleTextWrap.textContent === 'Add subtitle...') {
                            subtitleTextWrap.textContent = '';
                        }
                    }, 10);
                }
            };
            subtitleTextWrap.onfocus = () => {
                subtitleTextWrap.style.background = 'rgba(9, 30, 66, 0.08)';
                subtitleTextWrap.style.cursor = 'text';
            };
            subtitleTextWrap.onblur = async () => {
                subtitleTextWrap.contentEditable = 'false';
                subtitleTextWrap.style.background = '';
                subtitleTextWrap.style.cursor = 'pointer';
                const newSubtitle = subtitleTextWrap.textContent.trim();
                
                if (newSubtitle && newSubtitle !== 'Add subtitle...') {
                    if (newSubtitle !== activeBoard.cardSubtitles[card.id]) {
                        activeBoard.cardSubtitles[card.id] = newSubtitle;
                        saveState();
                        render();
                    }
                } else {
                    if (activeBoard.cardSubtitles[card.id]) {
                        activeBoard.cardSubtitles[card.id] = '';
                        saveState();
                    }
                    subtitleTextWrap.textContent = 'Add subtitle...';
                    subtitleTextWrap.style.display = 'none';
                    if (subtitleTextWrap._footerBtn) {
                        subtitleTextWrap._footerBtn.style.display = 'flex';
                    }
                }
            };
                subtitleTextWrap.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        subtitleTextWrap.blur();
                    }
                };
                
                leftCol.appendChild(subtitleTextWrap);
            }
            
            if (card.isTrelloDeleted && card.isTrelloTask) {
                const deletedBadge = document.createElement('div');
                deletedBadge.textContent = "Done";
                deletedBadge.style.backgroundColor = '#ffebe6';
                deletedBadge.style.color = '#bf2600';
                deletedBadge.style.fontSize = '11px';
                deletedBadge.style.fontWeight = '700';
                deletedBadge.style.padding = '3px 6px';
                deletedBadge.style.borderRadius = '3px';
                deletedBadge.style.alignSelf = 'flex-start';
                deletedBadge.style.marginTop = '4px';
                deletedBadge.style.lineHeight = '1';
                leftCol.appendChild(deletedBadge);
                cardEl.style.opacity = '0.6';
            }
            
            if (card.isPipedrive && activeBoard.pipedriveNoteFieldKey && card.pipedriveData) {
                const noteVal = card.pipedriveData[activeBoard.pipedriveNoteFieldKey] || '';
                if (noteVal.trim() !== '') {
                    const noteDisplay = document.createElement('div');
                    noteDisplay.style.fontSize = '12px';
                    noteDisplay.style.color = '#5e6c84';
                    noteDisplay.style.marginTop = '4px';
                    noteDisplay.style.marginBottom = '6px';
                    noteDisplay.style.lineHeight = '1.4';
                    noteDisplay.style.wordBreak = 'break-word';
                    noteDisplay.style.whiteSpace = 'pre-wrap';
                    noteDisplay.textContent = noteVal;
                    leftCol.appendChild(noteDisplay);
                }
            }
            
            let globalValWrap = null;
            
            if (card.isPipedrive || ((list.isMoneySmelling || list.isNewClients) && card.dealValue)) {
                if (card.isPipedrive && activeBoard.pipedriveQualificationFieldKey && 
                    String(list.pipedriveStageId) === String(activeBoard.pipedriveFirstStageId) && 
                    card.pipedriveData && 
                    card.pipedriveData[activeBoard.pipedriveQualificationFieldKey]) {
                        
                    const qualVal = card.pipedriveData[activeBoard.pipedriveQualificationFieldKey];
                    const qualWrap = document.createElement('div');
                    qualWrap.textContent = qualVal;
                    qualWrap.style.fontSize = "11px";
                    qualWrap.style.fontWeight = "600";
                    qualWrap.style.color = "#7A869A";
                    qualWrap.style.fontStyle = "italic";
                    qualWrap.style.marginBottom = "4px";
                    
                    leftCol.appendChild(qualWrap);
                }
                
                const metaRow = document.createElement('div');
                metaRow.style.display = 'flex';
                metaRow.style.alignItems = 'center';
                metaRow.style.gap = '8px';
                metaRow.style.flexWrap = 'nowrap';
                metaRow.style.width = '100%';
                let displayValStr = null;
                if (card.isPipedrive && card.pipedriveData && card.pipedriveData.formatted_value) {
                    displayValStr = card.pipedriveData.formatted_value;
                } else if (!card.isPipedrive && card.dealValue) {
                    displayValStr = `SAR ${card.dealValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                }

                if (displayValStr) {
                    globalValWrap = document.createElement('span');
                    let displayVal = displayValStr;
                    if (displayVal.includes('SAR')) {
                        const sarSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" style="width: 1.2em; height: 1.2em; margin-right: 4px; display: inline-block; flex-shrink: 0;"><path fill="currentColor" d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"></path><path fill="currentColor" d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"></path></svg>`;
                        displayVal = displayVal.replace('SAR', sarSvg).trim();
                    }
                    globalValWrap.innerHTML = displayVal;
                    globalValWrap.style.fontSize = "16px";
                    globalValWrap.style.fontWeight = "800";
                    globalValWrap.style.color = "#00875A"; 
                    globalValWrap.style.letterSpacing = "0.3px";
                    globalValWrap.style.display = "flex";
                    globalValWrap.style.alignItems = "center";
                    globalValWrap.style.position = "relative";
                }
                
                const spacer = document.createElement('span');
                spacer.style.flex = "1";
                metaRow.appendChild(spacer);
                
                leftCol.appendChild(metaRow);
            }
            
            titleEl.style.display = 'flex';
            titleEl.style.justifyContent = 'space-between';
            titleEl.style.alignItems = 'flex-start';
            titleEl.appendChild(leftCol);
            
            if (card.isPipedrive && activeBoard.pipedriveWhatsappFieldKey && card.pipedriveData) {
                const waVal = card.pipedriveData[activeBoard.pipedriveWhatsappFieldKey];
                if (waVal) {
                    const waNum = String(waVal).replace(/[^\d+]/g, '');
                    if (waNum.length > 5) {
                        const waLink = document.createElement('a');
                        waLink.href = `https://wa.me/${waNum.startsWith('+') ? waNum.substring(1) : waNum}`;
                        waLink.target = '_blank';
                        if(waLink) waLink.onclick = (e) => e.stopPropagation();
                        waLink.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.878-.788-1.47-1.761-1.643-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`;
                        
                        waLink.style.display = 'flex';
                        waLink.style.alignItems = 'center';
                        waLink.style.justifyContent = 'center';
                        waLink.style.padding = '4px';
                        waLink.style.borderRadius = '50%';
                        waLink.style.background = 'rgba(37, 211, 102, 0.1)';
                        waLink.style.transition = 'all 0.2s ease';
                        
                        waLink.onmouseenter = () => { waLink.style.background = 'rgba(37, 211, 102, 0.2)'; waLink.style.transform = 'scale(1.1)'; };
                        waLink.onmouseleave = () => { waLink.style.background = 'rgba(37, 211, 102, 0.1)'; waLink.style.transform = 'scale(1)'; };
                        
                        titleEl.appendChild(waLink);
                    }
                }
            }
            
            const pinBtn = document.createElement('div');
            pinBtn.className = 'card-pin-btn';
            pinBtn.style.position = 'absolute';
            pinBtn.style.right = '-8px';
            pinBtn.style.top = '-8px';
            pinBtn.style.width = '24px';
            pinBtn.style.height = '24px';
            pinBtn.style.cursor = 'pointer';
            pinBtn.style.opacity = card.isPinned ? '1' : '0';
            pinBtn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
            pinBtn.style.background = card.isPinned ? '#172b4d' : '#fff';
            pinBtn.style.borderRadius = '50%';
            pinBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
            pinBtn.style.zIndex = '10';
            pinBtn.style.display = 'flex';
            pinBtn.style.alignItems = 'center';
            pinBtn.style.justifyContent = 'center';
            pinBtn.title = card.isPinned ? "Unpin card" : "Pin card to top";
            
            const pinSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${card.isPinned ? '#ffffff' : 'none'}" stroke="${card.isPinned ? '#ffffff' : '#172b4d'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`;
            pinBtn.innerHTML = pinSvg;
            
            pinBtn.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            
            if(pinBtn) pinBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                card.isPinned = !card.isPinned;
                saveState();
                render();
            };
            
            if (card.isPinned) pinBtn.classList.add('pinned');
            
            cardEl.style.position = 'relative';
            cardEl.style.overflow = 'visible';
            if (!list.pipedriveStageId) {
                cardEl.appendChild(pinBtn);
            }

            cardEl.appendChild(titleEl);

            if (list.isNewClients) {
                const checklist = ensureCardChecklist(card);
                if (checklist.length > 0) {
                    const checklistWrap = document.createElement('div');
                    checklistWrap.className = 'nc-checklist-wrap';

                    const doneCount = checklist.filter(i => i.checked).length;
                    const checklistHeader = document.createElement('div');
                    checklistHeader.style.display = 'flex';
                    checklistHeader.style.alignItems = 'center';
                    checklistHeader.style.justifyContent = 'space-between';
                    checklistHeader.style.cursor = 'pointer';
                    checklistHeader.style.marginBottom = card.isChecklistCollapsed ? '0px' : '6px';
                    checklistHeader.style.paddingTop = '4px';
                    checklistHeader.style.color = '#5e6c84';
                    checklistHeader.style.fontSize = '12px';
                    checklistHeader.style.fontWeight = '600';
                    
                    const titleWrap = document.createElement('div');
                    titleWrap.style.display = 'flex';
                    titleWrap.style.alignItems = 'center';
                    titleWrap.style.gap = '6px';
                    titleWrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                                           <span>Checklist</span> <span style="opacity:0.7; font-weight:500;">(${doneCount}/${checklist.length})</span>`;

                    const toggleIcon = document.createElement('div');
                    toggleIcon.style.display = 'flex';
                    toggleIcon.innerHTML = card.isChecklistCollapsed ? 
                        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>` : 
                        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

                    checklistHeader.appendChild(titleWrap);
                    checklistHeader.appendChild(toggleIcon);

                    checklistHeader.onclick = (e) => {
                        e.stopPropagation();
                        card.isChecklistCollapsed = !card.isChecklistCollapsed;
                        saveState();
                        render();
                    };

                    checklistWrap.appendChild(checklistHeader);

                    if (!card.isChecklistCollapsed) {
                        const itemsWrap = document.createElement('div');
                        itemsWrap.className = 'nc-checklist-items-wrap';

                        checklist.forEach((item, index) => {
                            const itemContainer = document.createElement('div');
                            itemContainer.style.display = 'flex';
                            itemContainer.style.flexDirection = 'column';
                            itemContainer.style.marginBottom = '2px';
                            itemContainer.dataset.index = index;

                            const row = document.createElement('div');
                            row.className = 'nc-card-row';
                            row.onmousedown = (e) => e.stopPropagation();
                            if(row) row.onclick = (e) => e.stopPropagation();

                            const dragHandle = document.createElement('div');
                            dragHandle.className = 'nc-drag-handle';
                            dragHandle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
                            dragHandle.style.cursor = 'grab';
                            dragHandle.style.padding = '0 2px';
                            dragHandle.style.display = 'flex';
                            dragHandle.style.marginRight = '2px';
                            dragHandle.title = "Drag to reorder";
                            
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.checked = !!item.checked;
                            checkbox.onchange = (e) => {
                                const isChecked = e.target.checked;
                                text.classList.toggle('nc-done', isChecked);
                                setTimeout(() => {
                                    const liveChecklist = ensureCardChecklist(card);
                                    liveChecklist[index].checked = isChecked;
                                    saveState();
                                    render();
                                }, 0);
                            };

                            const text = document.createElement('input');
                            text.type = 'text';
                            text.value = item.text;
                            text.className = 'nc-card-text' + (item.checked ? ' nc-done' : '');
                            text.spellcheck = false;
                            text.style.flex = '1';
                            if(text) text.onclick = (e) => e.stopPropagation();
                            text.oninput = (e) => {
                                const liveChecklist = ensureCardChecklist(card);
                                liveChecklist[index].text = e.target.value;
                            };
                            text.onblur = (e) => {
                                const val = e.target.value.trim();
                                const liveChecklist = ensureCardChecklist(card);
                                if (!val && !liveChecklist[index].comment) {
                                    liveChecklist.splice(index, 1);
                                    saveState();
                                    setTimeout(() => render(), 0);
                                } else {
                                    if (liveChecklist[index] && liveChecklist[index].text !== val) {
                                        liveChecklist[index].text = val;
                                        saveState();
                                    }
                                }
                            };
                            text.onkeydown = (e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    text.blur();
                                }
                            };

                            const commentBtn = document.createElement('div');
                            commentBtn.innerHTML = `<svg style="pointer-events: none;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${item.comment ? '#0c66e4' : '#94a3b8'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
                            commentBtn.style.cursor = 'pointer';
                            commentBtn.style.display = 'flex';
                            commentBtn.style.padding = '0 4px';
                            commentBtn.title = "Add a comment";
                            commentBtn.onclick = (e) => {
                                e.stopPropagation();
                                if (document.activeElement) document.activeElement.blur();
                                const liveChecklist = ensureCardChecklist(card);
                                liveChecklist[index].showComment = !liveChecklist[index].showComment;
                                saveState();
                                setTimeout(() => render(), 0);
                            };

                            row.appendChild(dragHandle);
                            row.appendChild(checkbox);
                            row.appendChild(text);
                            row.appendChild(commentBtn);
                            itemContainer.appendChild(row);

                            if (item.showComment) {
                                const commentWrap = document.createElement('div');
                                commentWrap.style.paddingLeft = '36px'; // adjusted for drag handle
                                commentWrap.style.paddingRight = '20px';
                                commentWrap.style.marginTop = '-2px';
                                commentWrap.style.marginBottom = '6px';
                                
                                const commentInput = document.createElement('textarea');
                                commentInput.value = item.comment || '';
                                commentInput.placeholder = 'Add details or a comment...';
                                commentInput.style.width = '100%';
                                commentInput.style.fontSize = '12px';
                                commentInput.style.color = '#475569';
                                commentInput.style.padding = '4px 8px';
                                commentInput.style.border = '1px solid #e2e8f0';
                                commentInput.style.borderRadius = '4px';
                                commentInput.style.resize = 'vertical';
                                commentInput.style.minHeight = '32px';
                                commentInput.style.backgroundColor = '#f8fafc';
                                commentInput.style.outline = 'none';
                                commentInput.style.fontFamily = 'inherit';
                                commentInput.onmousedown = (e) => e.stopPropagation();
                                commentInput.onclick = (e) => e.stopPropagation();
                                
                                commentInput.oninput = (e) => {
                                    const liveChecklist = ensureCardChecklist(card);
                                    liveChecklist[index].comment = e.target.value;
                                };
                                commentInput.onblur = () => {
                                    saveState();
                                };
                                
                                commentWrap.appendChild(commentInput);
                                itemContainer.appendChild(commentWrap);
                                
                                if (!item.comment) {
                                    setTimeout(() => commentInput.focus(), 0);
                                }
                            }

                            itemsWrap.appendChild(itemContainer);
                        });

                        checklistWrap.appendChild(itemsWrap);
                        
                        // Try to initialize Sortable on the checklist items
                        if (typeof Sortable !== 'undefined') {
                            new Sortable(itemsWrap, {
                                animation: 150,
                                handle: '.nc-drag-handle',
                                onEnd: function (evt) {
                                    const oldIndex = evt.oldIndex;
                                    const newIndex = evt.newIndex;
                                    if (oldIndex !== newIndex && oldIndex !== undefined && newIndex !== undefined) {
                                        const liveChecklist = ensureCardChecklist(card);
                                        const [movedItem] = liveChecklist.splice(oldIndex, 1);
                                        liveChecklist.splice(newIndex, 0, movedItem);
                                        saveState();
                                        render();
                                    }
                                }
                            });
                        }

                        const addBtnWrap = document.createElement('div');
                        addBtnWrap.style.display = 'flex';
                        addBtnWrap.style.alignItems = 'center';
                        addBtnWrap.style.paddingLeft = '4px';
                        addBtnWrap.style.marginTop = '4px';
                        
                        const addIcon = document.createElement('div');
                        addIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                        addIcon.style.cursor = 'pointer';
                        addIcon.style.display = 'flex';
                        addIcon.style.transition = 'stroke 0.2s';
                        addIcon.onmouseover = () => addIcon.querySelector('svg').style.stroke = '#22a06b';
                        addIcon.onmouseout = () => addIcon.querySelector('svg').style.stroke = '#94a3b8';
                        addIcon.onmousedown = (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const liveChecklist = ensureCardChecklist(card);
                            liveChecklist.push({ text: 'New task...', checked: false });
                            saveState();
                            render();
                        };

                        addBtnWrap.appendChild(addIcon);
                        checklistWrap.appendChild(addBtnWrap);
                    }

                    cardEl.appendChild(checklistWrap);
                }
            }
            
            if (list.trackerType === 'ads') {
                const hud = document.createElement('div');
                hud.style.marginTop = '10px';
                hud.style.marginBottom = '2px';
                hud.style.display = 'flex';
                hud.style.justifyContent = 'flex-end';
                hud.style.gap = '6px';
                hud.style.flexWrap = 'wrap';
                
                const m = card.adsMetrics || {};
                
                // 'spendDiv' relocated to metaRow
                
                if (m.roas !== undefined && m.roas !== '' && !isNaN(m.roas)) {
                    hud.innerHTML += `<div style="background:#eaf2e3; color:#1f822b; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; border:1px solid #b3dfb8;">🎯 ${m.roas}x</div>`;
                }
                if (m.cpa !== undefined && m.cpa !== '' && !isNaN(m.cpa)) {
                    hud.innerHTML += `<div style="background:#fff2f0; color:#ae2e24; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; border:1px solid #ffbdad;">💸 CPA $${m.cpa}</div>`;
                }
                if (m.conversions !== undefined && m.conversions !== '' && !isNaN(m.conversions)) {
                    hud.innerHTML += `<div style="background:#f4f5f7; color:#5e6c84; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; border:1px solid #dfe1e6;">👥 ${m.conversions}</div>`;
                }
                // 'platform' relocated to metaRow
                
                if (hud.innerHTML.trim() !== '') {
                    cardEl.appendChild(hud);
                }
            }
            
            let badgeWrap = null;
            let calculatorBadge = null;
            if (card.isTrello || card.isTrelloTask || list.isClientHappiness || list.isMoneySmelling || list.pipedriveStageId || list.trackerType === 'ads') {
                badgeWrap = document.createElement('div');
                badgeWrap.className = 'card-badges';
                badgeWrap.style.marginTop = '8px';
                badgeWrap.style.display = 'flex';
                badgeWrap.style.justifyContent = 'space-between';
                badgeWrap.style.alignItems = 'center';
                
                if (list.trackerType === 'ads') {
                    const m = card.adsMetrics || {};
                    let activePlatforms = Array.isArray(m.platforms) ? m.platforms : (m.platform ? [m.platform] : []);
                    const spendsObj = m.spends || {};
                    if (!m.spends && m.platform && m.spend !== undefined && m.spend !== null) {
                        spendsObj[m.platform] = m.spend;
                    }
                    
                    const isAnyActive = activePlatforms.length > 0;
                    
                    const activePlatWrap = document.createElement('div');
                    activePlatWrap.style.display = "flex";
                    activePlatWrap.style.flexWrap = "wrap";
                    activePlatWrap.style.rowGap = "8px";
                    activePlatWrap.style.columnGap = "8px";
                    if (isAnyActive) activePlatWrap.style.width = "100%";
                    
                    activePlatWrap.ondragover = (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                    };
                    activePlatWrap.ondrop = (e) => {
                        e.preventDefault();
                        try {
                            const pending = JSON.parse(e.dataTransfer.getData('application/json'));
                            if (pending.action === 'reorder' && pending.cardId === card.id) {
                                const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                                if (!liveCard || !liveCard.adsMetrics) return;
                                let mPlats = Array.isArray(liveCard.adsMetrics.platforms) ? [...liveCard.adsMetrics.platforms] : [];
                                const fromIdx = mPlats.indexOf(pending.sourceId);
                                if (fromIdx > -1) {
                                    mPlats.splice(fromIdx, 1);
                                    mPlats.push(pending.sourceId);
                                    liveCard.adsMetrics.platforms = mPlats;
                                    liveCard.adsMetrics.platform = mPlats.length > 0 ? mPlats[0] : null;
                                    const performUpdate = () => { if (document.activeElement) document.activeElement.blur(); saveState(); render(); };
                                    if (document.startViewTransition) document.startViewTransition(() => performUpdate());
                                    else performUpdate();
                                }
                            }
                        } catch(err) {}
                    };
                    
                    const inactivePlatWrap = document.createElement('div');
                    inactivePlatWrap.style.display = "flex";
                    inactivePlatWrap.style.alignItems = "center";
                    inactivePlatWrap.style.gap = "6px";
                    inactivePlatWrap.style.marginRight = "auto";

                    const addPlatformBtn = document.createElement('div');
                    addPlatformBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
                    addPlatformBtn.style.cursor = 'pointer';
                    addPlatformBtn.style.color = '#7A869A';
                    addPlatformBtn.style.background = '#f4f5f7';
                    addPlatformBtn.style.padding = '4px';
                    addPlatformBtn.style.borderRadius = '50%';
                    addPlatformBtn.style.display = 'flex';
                    addPlatformBtn.style.alignItems = 'center';
                    addPlatformBtn.style.justifyContent = 'center';
                    addPlatformBtn.title = 'Add Tracker';
                    addPlatformBtn.style.transition = 'all 0.2s ease';

                    const inactiveIconsDrawer = document.createElement('div');
                    inactiveIconsDrawer.style.display = 'flex';
                    inactiveIconsDrawer.style.alignItems = 'center';
                    inactiveIconsDrawer.style.gap = '6px';
                    inactiveIconsDrawer.style.overflow = 'hidden';
                    inactiveIconsDrawer.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    
                    let drawerExpanded = m.drawerExpanded === true;
                    const updateDrawerUI = () => {
                        inactiveIconsDrawer.style.maxWidth = drawerExpanded ? '150px' : '0px';
                        inactiveIconsDrawer.style.opacity = drawerExpanded ? '1' : '0';
                        addPlatformBtn.style.transform = drawerExpanded ? 'rotate(45deg)' : 'rotate(0deg)';
                        addPlatformBtn.style.background = drawerExpanded ? '#e9f2ff' : '#f4f5f7';
                        addPlatformBtn.style.color = drawerExpanded ? '#0c66e4' : '#7A869A';
                    };
                    updateDrawerUI();

                    if(addPlatformBtn) addPlatformBtn.onclick = (e) => {
                        e.stopPropagation();
                        drawerExpanded = !drawerExpanded;
                        const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                        if (liveCard && liveCard.adsMetrics) liveCard.adsMetrics.drawerExpanded = drawerExpanded;
                        saveState();
                        updateDrawerUI();
                    };

                    inactivePlatWrap.appendChild(addPlatformBtn);
                    
                    const addSubtitleFooterBtn = document.createElement('div');
                    addSubtitleFooterBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
                    addSubtitleFooterBtn.style.cursor = 'pointer';
                    addSubtitleFooterBtn.style.color = '#7A869A';
                    addSubtitleFooterBtn.style.background = '#f4f5f7';
                    addSubtitleFooterBtn.style.padding = '4px';
                    addSubtitleFooterBtn.style.borderRadius = '50%';
                    addSubtitleFooterBtn.style.display = 'flex';
                    addSubtitleFooterBtn.style.alignItems = 'center';
                    addSubtitleFooterBtn.style.justifyContent = 'center';
                    addSubtitleFooterBtn.title = 'Add Subtitle';
                    addSubtitleFooterBtn.style.transition = 'all 0.2s ease';
                    
                    if (!activeBoard.cardSubtitles || !activeBoard.cardSubtitles[card.id]) {
                        addSubtitleFooterBtn.style.display = 'flex';
                    } else {
                        addSubtitleFooterBtn.style.display = 'none';
                    }

                    addSubtitleFooterBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (subtitleTextWrap) {
                            subtitleTextWrap.style.display = 'block';
                            addSubtitleFooterBtn.style.display = 'none';
                            subtitleTextWrap.contentEditable = 'true';
                            setTimeout(() => subtitleTextWrap.focus(), 10);
                            if (subtitleTextWrap.textContent === 'Add subtitle...') {
                                subtitleTextWrap.textContent = '';
                            }
                        }
                    };

                    inactivePlatWrap.appendChild(addSubtitleFooterBtn);
                    
                    if (subtitleTextWrap) {
                        subtitleTextWrap._footerBtn = addSubtitleFooterBtn;
                    }

                    inactivePlatWrap.appendChild(inactiveIconsDrawer);
                    
                    const platforms = [
                        { id: 'Meta', color: '#1877F2', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 1.1em; height: 1.1em; vertical-align: middle;"><path fill="currentColor" d="M504 256C504 119 393 8 256 8S8 119 8 256c0 123.78 90.69 226.38 209.25 245V327.69h-63V256h63v-54.64c0-62.15 37-96.48 93.67-96.48 27.14 0 55.52 4.84 55.52 4.84v61h-31.28c-30.8 0-40.41 19.12-40.41 38.73V256h68.78l-11 71.69h-57.78V501C413.31 482.38 504 379.78 504 256z"/></svg>' },
                        { id: 'IG', color: '#E1306C', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" style="width: 1.1em; height: 1.1em; vertical-align: middle;"><path fill="currentColor" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12.2 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/></svg>' },
                        { id: 'TikTok', color: '#000000', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" style="width: 1.1em; height: 1.1em; vertical-align: middle;"><path fill="currentColor" d="M448 209.91a210.06 210.06 0 0 1-122.77-39.25V349.38A162.55 162.55 0 1 1 185 188.31V278.2a74.62 74.62 0 1 0 52.23 71.18V0l88 0a121.18 121.18 0 0 0 1.86 22.17h0A122.18 122.18 0 0 0 381 102.39a121.43 121.43 0 0 0 67 20.14Z"/></svg>' },
                        { id: 'Google', color: '#4285F4', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512" style="width: 1.1em; height: 1.1em; vertical-align: middle;"><path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"/></svg>' },
                        { id: 'Snapchat', color: '#FFFC00', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 1.1em; height: 1.1em; vertical-align: middle;"><path fill="currentColor" d="M496 350.7c-9.6-13.6-28-16.5-34.6-16.4-3.5.1-40.4 1-52.5-16.1 15.6-25.8 52.5-98.3 52.5-149.3 0-51-17.6-96-41.2-124.6C393.5 12 331 0 248 0 165 0 102.5 12 75.8 44.3 52.2 72.9 34.6 117.9 34.6 168.9c0 51 36.9 123.5 52.5 149.3-12.1 17-48.9 16.2-52.5 16.1-6.6-.1-25 2.8-34.6 16.4-15 21.2-17 38.3 2 48.7 15.6 8.5 35 12.5 53.6 14.2 3.8.3 4.2 4.1 3.5 6.9-3.2 12.7-18.4 20-21.6 22-8.5 5.2-11.4 11.2-11.4 13.5v.3c0 9.2 16.1 19.8 41.1 27.2C89 489.6 130 512 248 512c118 0 159-22.4 180.8-28.5 25-7.4 41.1-18 41.1-27.2v-.3c0-2.3-2.9-8.3-11.4-13.5-3.2-2-18.4-9.3-21.6-22-.7-2.8-.3-6.6 3.5-6.9 18.6-1.7 38-5.7 53.6-14.2 19-10.4 17-27.5 2-48.7z"/></svg>' }
                    ];
                    
                    const safeId = card.id.replace(/[^a-zA-Z0-9]/g, '');
                    const mergedInto = m.mergedInto || {};
                    const childrenPlatforms = Object.keys(mergedInto).filter(child => 
                        activePlatforms.includes(child) && activePlatforms.includes(mergedInto[child])
                    );

                    platforms.forEach(p => {
                        if (childrenPlatforms.includes(p.id)) return;
                        
                        const iconEl = document.createElement('div');
                        iconEl.innerHTML = p.svg;
                        iconEl.style.display = 'flex';
                        iconEl.style.alignItems = 'center';
                        iconEl.style.justifyContent = 'center';
                        iconEl.style.fontSize = '14px';
                        iconEl.title = p.id;
                        iconEl.style.cursor = 'pointer';
                        iconEl.style.transition = 'all 0.15s ease';
                        
                        const cssViewId = p.id.replace(/[^a-zA-Z0-9]/g, '');
                        iconEl.style.viewTransitionName = `p-ico-${safeId}-${cssViewId}`;
                        
                        const isActive = activePlatforms.includes(p.id);
                        
                        const setSnapActive = () => {
                            iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="width: 1.1em; height: 1.1em; vertical-align: middle; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.15));"><rect width="512" height="512" rx="112" fill="#FFFC00"/><path fill="#FFF" stroke="#172b4d" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" transform="translate(65, 60) scale(0.75)" d="M496 350.7c-9.6-13.6-28-16.5-34.6-16.4-3.5.1-40.4 1-52.5-16.1 15.6-25.8 52.5-98.3 52.5-149.3 0-51-17.6-96-41.2-124.6C393.5 12 331 0 248 0 165 0 102.5 12 75.8 44.3 52.2 72.9 34.6 117.9 34.6 168.9c0 51 36.9 123.5 52.5 149.3-12.1 17-48.9 16.2-52.5 16.1-6.6-.1-25 2.8-34.6 16.4-15 21.2-17 38.3 2 48.7 15.6 8.5 35 12.5 53.6 14.2 3.8.3 4.2 4.1 3.5 6.9-3.2 12.7-18.4 20-21.6 22-8.5 5.2-11.4 11.2-11.4 13.5v.3c0 9.2 16.1 19.8 41.1 27.2C89 489.6 130 512 248 512c118 0 159-22.4 180.8-28.5 25-7.4 41.1-18 41.1-27.2v-.3c0-2.3-2.9-8.3-11.4-13.5-3.2-2-18.4-9.3-21.6-22-.7-2.8-.3-6.6 3.5-6.9 18.6-1.7 38-5.7 53.6-14.2 19-10.4 17-27.5 2-48.7z"/></svg>';
                        };
                        
                        if (isActive) {
                            if (p.id === 'Snapchat') {
                                setSnapActive();
                            } else {
                                iconEl.style.color = p.color;
                            }
                            iconEl.style.opacity = '1';
                            iconEl.style.transform = 'scale(1.15)';
                            if (p.id === 'IG') iconEl.style.filter = `drop-shadow(0 0 2px ${p.color})`;
                        } else {
                            iconEl.style.color = '#7A869A';
                            iconEl.style.opacity = isAnyActive ? '0.3' : '0.6';
                        }
                        
                        iconEl.onmouseenter = () => {
                            if (!isActive) {
                                iconEl.style.transform = 'scale(1.1)';
                                if (p.id === 'Snapchat') {
                                    setSnapActive();
                                    iconEl.style.color = '';
                                } else {
                                    iconEl.style.color = p.color;
                                }
                                iconEl.style.opacity = '0.8';
                            }
                        };
                        
                        iconEl.onmouseleave = () => {
                            if (!isActive) {
                                iconEl.style.transform = 'scale(1)';
                                iconEl.innerHTML = p.svg;
                                iconEl.style.color = '#7A869A';
                                iconEl.style.opacity = isAnyActive ? '0.3' : '0.6';
                            }
                        };
                        
                        if(iconEl) iconEl.onclick = (e) => {
                            e.stopPropagation();
                            const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                            if (liveCard) {
                                if (!liveCard.adsMetrics) liveCard.adsMetrics = {};
                                let mPlats = Array.isArray(liveCard.adsMetrics.platforms) ? [...liveCard.adsMetrics.platforms] : (liveCard.adsMetrics.platform ? [liveCard.adsMetrics.platform] : []);
                                
                                if (mPlats.includes(p.id)) {
                                    mPlats = mPlats.filter(id => id !== p.id);
                                } else {
                                    mPlats.push(p.id);
                                    if (!liveCard.adsMetrics.spends) liveCard.adsMetrics.spends = { ...spendsObj };
                                    if (liveCard.adsMetrics.spends[p.id] === undefined) liveCard.adsMetrics.spends[p.id] = 0;
                                }
                                
                                liveCard.adsMetrics.platforms = mPlats;
                                liveCard.adsMetrics.platform = mPlats.length > 0 ? mPlats[0] : null;
                                
                                m.platforms = liveCard.adsMetrics.platforms;
                                m.platform = liveCard.adsMetrics.platform;
                                
                                let total = 0;
                                mPlats.forEach(pId => {
                                    const v = (liveCard.adsMetrics.spends || {})[pId];
                                    if (v) total += parseFloat(v);
                                });
                                liveCard.adsMetrics.spend = liveCard.adsMetrics.taxEnabled ? total * 1.15 : total;
                                
                                const performUpdate = () => {
                                    saveState();
                                    render();
                                };

                                if (document.startViewTransition) {
                                    document.startViewTransition(() => performUpdate());
                                } else {
                                    performUpdate();
                                }
                            }
                        };
                        
                        if (isActive) {
                            const groupEl = document.createElement('div');
                            groupEl.style.display = 'flex';
                            groupEl.style.alignItems = 'center';
                            groupEl.style.gap = '4px';
                            groupEl.style.order = activePlatforms.indexOf(p.id);
                            
                            const cssViewId = p.id.replace(/[^a-zA-Z0-9]/g, '');
                            groupEl.style.viewTransitionName = `p-group-${safeId}-${cssViewId}`;
                            
                            iconEl.draggable = true;
                            iconEl.ondragstart = (e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('application/json', JSON.stringify({ action: 'merge', sourceId: p.id, cardId: card.id }));
                                e.dataTransfer.effectAllowed = 'move';
                                setTimeout(() => iconEl.style.opacity = '0.5', 0);
                            };
                            iconEl.ondragend = (e) => {
                                e.stopPropagation();
                                iconEl.style.opacity = '1';
                            };
                            
                            const handleDragOver = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = 'move';
                            };
                            groupEl.ondragenter = handleDragOver;
                            groupEl.ondragover = handleDragOver;
                            groupEl.ondrop = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                groupEl.style.transform = 'scale(1)';
                                try {
                                    const pending = JSON.parse(e.dataTransfer.getData('application/json'));
                                    if (pending.cardId === card.id && pending.sourceId !== p.id) {
                                        const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                                        if (!liveCard) return;
                                        
                                        if (pending.action === 'merge') {
                                            if (!liveCard.adsMetrics) liveCard.adsMetrics = {};
                                            if (!liveCard.adsMetrics.mergedInto) liveCard.adsMetrics.mergedInto = {};
                                            if (!liveCard.adsMetrics.spends) liveCard.adsMetrics.spends = { ...spendsObj };
                                            
                                            const src = pending.sourceId;
                                            const tgt = p.id;
                                            
                                            Object.keys(liveCard.adsMetrics.mergedInto).forEach(childId => {
                                                if (liveCard.adsMetrics.mergedInto[childId] === src) {
                                                    liveCard.adsMetrics.mergedInto[childId] = tgt;
                                                }
                                            });
                                            liveCard.adsMetrics.mergedInto[src] = tgt;
                                            
                                            // Merging paths stored, values kept separate in 'spends' to prevent loss on un-merge.
                                            
                                            let total = 0;
                                            const activePlats = liveCard.adsMetrics.platforms || [];
                                            activePlats.forEach(pId => {
                                                const v = (liveCard.adsMetrics.spends || {})[pId];
                                                if (v) total += parseFloat(v);
                                            });
                                            liveCard.adsMetrics.spend = liveCard.adsMetrics.taxEnabled ? total * 1.15 : total;
                                            
                                            const performUpdate = () => { if (document.activeElement) document.activeElement.blur(); saveState(); render(); };
                                            if (document.startViewTransition) document.startViewTransition(() => performUpdate());
                                            else performUpdate();
                                        } else if (pending.action === 'reorder') {
                                            if (!liveCard.adsMetrics) return;
                                            let mPlats = Array.isArray(liveCard.adsMetrics.platforms) ? [...liveCard.adsMetrics.platforms] : [];
                                            const fromIdx = mPlats.indexOf(pending.sourceId);
                                            const toIdx = mPlats.indexOf(p.id);
                                            if (fromIdx > -1 && toIdx > -1) {
                                                mPlats.splice(fromIdx, 1);
                                                mPlats.splice(toIdx, 0, pending.sourceId);
                                                liveCard.adsMetrics.platforms = mPlats;
                                                liveCard.adsMetrics.platform = mPlats.length > 0 ? mPlats[0] : null;
                                                const performUpdate = () => { if (document.activeElement) document.activeElement.blur(); saveState(); render(); };
                                                if (document.startViewTransition) document.startViewTransition(() => performUpdate());
                                                else performUpdate();
                                            }
                                        }
                                    }
                                } catch(err) {}
                            };
                            
                            groupEl.appendChild(iconEl);
                            
                            // Append ALL children of this target
                            const myChildren = childrenPlatforms.filter(childId => mergedInto[childId] === p.id);
                            myChildren.forEach(childId => {
                                const childData = platforms.find(x => x.id === childId);
                                if (!childData) return;
                                
                                const childIcon = document.createElement('div');
                                childIcon.innerHTML = childData.svg;
                                childIcon.style.display = 'flex';
                                childIcon.style.alignItems = 'center';
                                childIcon.style.justifyContent = 'center';
                                childIcon.style.fontSize = '14px';
                                childIcon.title = `Drag out to unmerge ${childData.id}`;
                                childIcon.style.cursor = 'grab';
                                childIcon.style.color = childData.color;
                                childIcon.style.filter = `drop-shadow(0 0 2px ${childData.color})`;
                                childIcon.style.transform = 'scale(1.15)';
                                childIcon.style.transition = 'all 0.15s ease';
                                childIcon.style.viewTransitionName = `p-ico-${safeId}-${childData.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                                
                                childIcon.draggable = true;
                                childIcon.ondragstart = (e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', 'unmerge');
                                    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'unmerge_child', childId, cardId: card.id }));
                                    setTimeout(() => childIcon.style.opacity = '0', 0);
                                };
                                childIcon.ondragend = (e) => {
                                    e.stopPropagation();
                                    childIcon.style.opacity = '1';
                                    const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                                    if (liveCard && liveCard.adsMetrics && liveCard.adsMetrics.mergedInto) {
                                        delete liveCard.adsMetrics.mergedInto[childId];
                                        const performUpdate = () => { if (document.activeElement) document.activeElement.blur(); saveState(); render(); };
                                        if (document.startViewTransition) document.startViewTransition(() => performUpdate());
                                        else performUpdate();
                                    }
                                };
                                
                                if(childIcon) childIcon.onclick = (e) => {
                                    e.stopPropagation();
                                    const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                                    if (liveCard && liveCard.adsMetrics) {
                                        if (liveCard.adsMetrics.mergedInto) delete liveCard.adsMetrics.mergedInto[childId];
                                        liveCard.adsMetrics.platforms = liveCard.adsMetrics.platforms.filter(x => x !== childId);
                                        const performUpdate = () => { if (document.activeElement) document.activeElement.blur(); saveState(); render(); };
                                        if (document.startViewTransition) document.startViewTransition(() => performUpdate());
                                        else performUpdate();
                                    }
                                };
                                
                                groupEl.appendChild(childIcon);
                            });
                            
                            const spendDiv = document.createElement('div');
                            spendDiv.style.background = '#f4f5f7';
                            spendDiv.style.color = '#172b4d';
                            spendDiv.style.padding = '3px 6px';
                            spendDiv.style.borderRadius = '5px';
                            spendDiv.style.fontSize = '11px';
                            spendDiv.style.fontWeight = '700';
                            spendDiv.style.border = '1px solid #dfe1e6';
                            spendDiv.style.display = 'flex';
                            spendDiv.style.alignItems = 'center';
                            spendDiv.style.gap = '3px';
                            spendDiv.title = 'Drag by price to reorder';
                            spendDiv.style.cursor = 'grab';
                            
                            spendDiv.draggable = true;
                            spendDiv.ondragstart = (e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder', sourceId: p.id, cardId: card.id }));
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setDragImage(groupEl, 0, 0);
                                setTimeout(() => groupEl.style.opacity = '0.5', 0);
                            };
                            spendDiv.ondragend = (e) => {
                                e.stopPropagation();
                                groupEl.style.opacity = '1';
                            };
                            
                            spendDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" style="width: 0.9em; height: 0.9em; vertical-align: middle;"><path fill="#231f20" d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"></path><path fill="#231f20" d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"></path></svg>`;
                            
                            const formatSpend = (val) => {
                                const parsed = parseFloat(val);
                                if (isNaN(parsed)) return '';
                                return parsed.toLocaleString('en-US', { maximumFractionDigits: 2 });
                            };

                            const spendInput = document.createElement('input');
                            spendInput.type = 'text';

                            const getDisplaySpend = () => {
                                let sum = parseFloat(spendsObj[p.id]) || 0;
                                myChildren.forEach(childId => { sum += parseFloat(spendsObj[childId]) || 0; });
                                return sum;
                            };

                            spendInput.value = formatSpend(getDisplaySpend());
                            spendInput.placeholder = '0';
                            spendInput.style.border = 'none';
                            spendInput.style.background = 'transparent';
                            spendInput.style.color = 'inherit';
                            spendInput.style.fontWeight = 'inherit';
                            spendInput.style.outline = 'none';
                            
                            const adjustWidth = () => {
                                spendInput.style.width = Math.max(48, (spendInput.value.length * 7) + 5) + 'px';
                            };
                            adjustWidth();

                            spendInput.style.padding = '0';
                            spendInput.style.margin = '0';
                            spendInput.style.textAlign = 'right';
                            
                            if(spendInput) spendInput.onclick = (e) => e.stopPropagation();
                            spendInput.ondragover = (e) => e.preventDefault();
                            spendInput.ondrop = (e) => e.preventDefault();
                            
                            spendInput.onfocus = () => { 
                                const s = getDisplaySpend();
                                spendInput.value = s > 0 ? s : ''; 
                                adjustWidth();
                            };
                            spendInput.onblur = () => { 
                                spendInput.value = formatSpend(getDisplaySpend()); 
                                adjustWidth();
                            };
                            spendInput.oninput = (e) => {
                                adjustWidth();
                                const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                                if (liveCard) {
                                    if (!liveCard.adsMetrics) liveCard.adsMetrics = {};
                                    if (!liveCard.adsMetrics.spends) liveCard.adsMetrics.spends = { ...spendsObj };
                                    
                                    const raw = parseFloat(e.target.value.replace(/,/g, ''));
                                    liveCard.adsMetrics.spends[p.id] = !isNaN(raw) ? raw : undefined;
                                    spendsObj[p.id] = liveCard.adsMetrics.spends[p.id];
                                    
                                    myChildren.forEach(childId => {
                                        liveCard.adsMetrics.spends[childId] = 0;
                                        spendsObj[childId] = 0;
                                    });
                                    
                                    let total = 0;
                                    const activePlats = liveCard.adsMetrics.platforms || [];
                                    activePlats.forEach(pId => {
                                        const v = (liveCard.adsMetrics.spends || {})[pId];
                                        if (v) total += parseFloat(v);
                                    });
                                    liveCard.adsMetrics.spend = liveCard.adsMetrics.taxEnabled ? total * 1.15 : total;
                                    
                                    m.spends = liveCard.adsMetrics.spends;
                                    saveState();
                                    if (card.updateReadonlyBadges) card.updateReadonlyBadges();
                                }
                            };
                            
                            spendDiv.appendChild(spendInput);
                            groupEl.appendChild(spendDiv);
                            activePlatWrap.appendChild(groupEl);
                        } else {
                            inactiveIconsDrawer.appendChild(iconEl);
                        }
                    });
                    if (activePlatWrap.children.length > 0) {
                        badgeWrap.appendChild(activePlatWrap);
                    }
                    if (inactiveIconsDrawer.children.length > 0) {
                        badgeWrap.appendChild(inactivePlatWrap);
                    }
                    
                    const statsWrap = document.createElement('div');
                    statsWrap.style.display = 'flex';
                    statsWrap.style.flexDirection = 'column';
                    statsWrap.style.gap = '8px';
                    statsWrap.style.marginTop = '8px';
                    statsWrap.style.paddingTop = '8px';
                    statsWrap.style.borderTop = '1px solid #ebecf0';
                    statsWrap.style.width = '100%';
                    statsWrap.style.fontSize = '12px';
                    statsWrap.style.fontWeight = '600';

                    const row1 = document.createElement('div');
                    row1.style.display = 'flex';
                    row1.style.flexWrap = 'wrap';
                    row1.style.gap = '6px';
                    row1.style.alignItems = 'center';

                    const row2 = document.createElement('div');
                    row2.style.display = 'flex';
                    row2.style.justifyContent = 'space-between';
                    row2.style.alignItems = 'flex-start';
                    row2.style.width = '100%';

                    const row2Left = document.createElement('div');
                    row2Left.style.display = 'flex';
                    row2Left.style.flexDirection = 'column';
                    row2Left.style.gap = '6px';
                    row2Left.style.alignItems = 'flex-start';

                    const formatNum = (v) => {
                        const parsed = parseFloat(v);
                        if (isNaN(parsed)) return '';
                        return parsed.toLocaleString('en-US', { maximumFractionDigits: 2 });
                    };

                    if (!document.getElementById('ads-hud-tooltip')) {
                        const style = document.createElement('style');
                        style.textContent = `
                            #ads-hud-tooltip {
                                position: fixed;
                                background: #172b4d;
                                color: #ffffff;
                                padding: 6px 10px;
                                border-radius: 4px;
                                font-size: 11.5px;
                                font-weight: 500;
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                pointer-events: none;
                                z-index: 999999;
                                opacity: 0;
                                transition: opacity 0.1s ease, transform 0.1s ease;
                                white-space: nowrap;
                                box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                                transform: translate(-50%, calc(-100% - 4px));
                            }
                            #ads-hud-tooltip::after {
                                content: '';
                                position: absolute;
                                top: 100%;
                                left: 50%;
                                transform: translateX(-50%);
                                border-width: 5px;
                                border-style: solid;
                                border-color: #172b4d transparent transparent transparent;
                            }
                            #ads-hud-tooltip.active {
                                opacity: 1;
                                transform: translate(-50%, calc(-100% - 8px));
                            }
                        `;
                        document.head.appendChild(style);
                        const tt = document.createElement('div');
                        tt.id = 'ads-hud-tooltip';
                        document.body.appendChild(tt);
                    }

                    const attachTooltip = (element, text) => {
                        if (!text) return;
                        if(element) element.addEventListener('mouseenter', () => {
                            const tt = document.getElementById('ads-hud-tooltip');
                            if (!tt) return;
                            tt.innerHTML = text;
                            const rect = element.getBoundingClientRect();
                            tt.style.left = (rect.left + rect.width / 2) + 'px';
                            tt.style.top = rect.top + 'px';
                            tt.classList.add('active');
                        });
                        if(element) element.addEventListener('mouseleave', () => {
                            const tt = document.getElementById('ads-hud-tooltip');
                            if (tt) tt.classList.remove('active');
                        });
                        if(element) element.addEventListener('click', () => {
                            const tt = document.getElementById('ads-hud-tooltip');
                            if (tt) tt.classList.remove('active');
                        });
                        element.removeAttribute('title');
                    };

                    const createInputBadge = (iconStr, bg, color, initVal, onInputCallback, onIconClick, tooltipText) => {
                        const b = document.createElement('div');
                        if (tooltipText) attachTooltip(b, tooltipText);
                        b.style.background = bg;
                        b.style.color = color;
                        b.style.padding = '4px 8px';
                        b.style.borderRadius = '6px';
                        b.style.border = `1px solid ${color}33`;
                        b.style.display = 'flex';
                        b.style.alignItems = 'center';
                        b.style.gap = '4px';

                        const span = document.createElement('span');
                        span.textContent = iconStr;

                        const inp = document.createElement('input');
                        if (onIconClick) {
                            span.style.cursor = 'pointer';
                            span.style.userSelect = 'none';
                            span.title = 'Click to toggle mode';
                            if(span) span.onclick = (e) => {
                                e.stopPropagation();
                                onIconClick(span, inp);
                            };
                        }
                        b.appendChild(span);
                        inp.type = 'text';
                        inp.value = formatNum(initVal);
                        inp.placeholder = '0';
                        inp.style.border = 'none';
                        inp.style.background = 'transparent';
                        inp.style.color = 'inherit';
                        inp.style.fontWeight = 'inherit';
                        inp.style.outline = 'none';
                        inp.style.padding = '0';
                        inp.style.margin = '0';
                        inp.style.textAlign = 'right';

                        const adjustW = () => { inp.style.width = Math.max(30, (inp.value.length * 7.5) + 5) + 'px'; };
                        adjustW();

                        if(inp) inp.onclick = (e) => e.stopPropagation();
                        inp.onfocus = () => { inp.value = initVal !== undefined && initVal !== 0 ? initVal : ''; adjustW(); };
                        inp.onblur = () => { inp.value = formatNum(initVal); adjustW(); };

                        inp.oninput = (e) => {
                            adjustW();
                            const sanitized = e.target.value.replace(/[^0-9.]/g, '');
                            if (sanitized !== e.target.value) e.target.value = sanitized;
                            
                            const parsed = parseFloat(sanitized);
                            initVal = !isNaN(parsed) ? parsed : 0;
                            
                            const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                            if (liveCard) {
                                if (!liveCard.adsMetrics) liveCard.adsMetrics = {};
                                onInputCallback(liveCard.adsMetrics, initVal);
                                saveState();
                                if (card.updateReadonlyBadges) card.updateReadonlyBadges();
                            }
                        };
                        b.appendChild(inp);
                        return { badge: b, input: inp };
                    };

                    const revObj = createInputBadge('💰', '#e3fcef', '#006644', m.revenue || 0, (metrics, val) => {
                        metrics.revenue = val;
                        m.revenue = val;
                    }, null, 'Total Revenue');

                    let costIsPct = m.costIsPercentage === true;
                    const costObj = createInputBadge(costIsPct ? '⚙️ %' : '⚙️', '#ffebe6', '#bf2600', m.cost || 0, (metrics, val) => {
                        metrics.cost = val;
                        m.cost = val;
                    }, (span, inp) => {
                        costIsPct = !costIsPct;
                        m.costIsPercentage = costIsPct;
                        span.textContent = costIsPct ? '⚙️ %' : '⚙️';
                        const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                        if (liveCard && liveCard.adsMetrics) {
                            liveCard.adsMetrics.costIsPercentage = costIsPct;
                            saveState();
                            if (card.updateReadonlyBadges) card.updateReadonlyBadges();
                        }
                    }, 'Cost of Goods / Profit Margin');

                    calculatorBadge = document.createElement('div');
                    attachTooltip(calculatorBadge, 'Advanced Margin Calculator');
                    calculatorBadge.style.background = 'rgba(9, 30, 66, 0.04)';
                    calculatorBadge.style.color = '#172b4d';
                    calculatorBadge.style.padding = '4px 8px';
                    calculatorBadge.style.borderRadius = '6px';
                    calculatorBadge.style.display = 'flex';
                    calculatorBadge.style.alignItems = 'center';
                    calculatorBadge.style.cursor = 'pointer';
                    calculatorBadge.style.border = '1px solid rgba(9, 30, 66, 0.08)';
                    calculatorBadge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect width="16" height="20" x="4" y="2" rx="2"></rect><line x1="8" x2="16" y1="6" y2="6"></line><line x1="16" x2="16" y1="14" y2="14.01"></line><line x1="16" x2="16" y1="18" y2="18.01"></line><line x1="12" x2="12" y1="14" y2="14.01"></line><line x1="12" x2="12" y1="18" y2="18.01"></line><line x1="8" x2="8" y1="14" y2="14.01"></line><line x1="8" x2="8" y1="18" y2="18.01"></line></svg><span style="font-weight:600; font-size:11px; letter-spacing:0.5px;">KPI</span>`;
                    calculatorBadge.onmouseenter = () => calculatorBadge.style.background = 'rgba(9, 30, 66, 0.08)';
                    calculatorBadge.onmouseleave = () => calculatorBadge.style.background = 'rgba(9, 30, 66, 0.04)';
                    if(calculatorBadge) calculatorBadge.onclick = (e) => {
                        e.stopPropagation();
                        if(window.openAdsCalculatorModal) window.openAdsCalculatorModal(card.id);
                    };

                    const roasBadge = document.createElement('div');
                    attachTooltip(roasBadge, 'Current ROAS (Return on Ad Spend)');
                    roasBadge.style.background = '#deebff';
                    roasBadge.style.color = '#0747a6';
                    roasBadge.style.padding = '4px 8px';
                    roasBadge.style.borderRadius = '6px';
                    roasBadge.style.display = 'flex';
                    roasBadge.style.alignItems = 'center';

                    const grossBadge = document.createElement('div');
                    attachTooltip(grossBadge, 'Gross Profit (Revenue - Ad Spend)');
                    grossBadge.style.background = '#e6fcff';
                    grossBadge.style.color = '#006644';
                    grossBadge.style.padding = '4px 8px';
                    grossBadge.style.borderRadius = '6px';
                    grossBadge.style.display = 'flex';
                    grossBadge.style.alignItems = 'center';

                    const netBadge = document.createElement('div');
                    attachTooltip(netBadge, 'Net Profit (Revenue - Spend - Cost)');
                    netBadge.style.background = '#eae6ff';
                    netBadge.style.color = '#403294';
                    netBadge.style.padding = '4px 8px';
                    netBadge.style.borderRadius = '6px';
                    netBadge.style.display = 'flex';
                    netBadge.style.alignItems = 'center';

                    const breakevenBadge = document.createElement('div');
                    attachTooltip(breakevenBadge, 'Breakeven ROAS (Minimum return to be profitable)');
                    breakevenBadge.style.background = '#fff0b3';
                    breakevenBadge.style.color = '#d97008';
                    breakevenBadge.style.padding = '4px 8px';
                    breakevenBadge.style.borderRadius = '6px';
                    breakevenBadge.style.display = 'flex';
                    breakevenBadge.style.alignItems = 'center';

                    const taxBadge = document.createElement('div');
                    const isTax = m.taxEnabled === true;
                    taxBadge.style.background = isTax ? '#ffbdad' : '#f4f5f7';
                    taxBadge.style.color = isTax ? '#bf2600' : '#5e6c84';
                    taxBadge.style.padding = '4px 8px';
                    taxBadge.style.borderRadius = '6px';
                    taxBadge.style.border = isTax ? '1px solid #bf260033' : '1px solid #5e6c8433';
                    taxBadge.style.cursor = 'pointer';
                    taxBadge.style.display = 'flex';
                    taxBadge.style.alignItems = 'center';
                    taxBadge.style.gap = '4px';
                    attachTooltip(taxBadge, 'Add 15% Tax to Ad Spend');
                    
                    if(taxBadge) taxBadge.onclick = (e) => {
                        e.stopPropagation();
                        m.taxEnabled = !m.taxEnabled;
                        const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                        if (liveCard && liveCard.adsMetrics) {
                            liveCard.adsMetrics.taxEnabled = m.taxEnabled;
                            
                            let baseTotal = 0;
                            const activePlats = liveCard.adsMetrics.platforms || [];
                            activePlats.forEach(pId => {
                                const v = (liveCard.adsMetrics.spends || {})[pId];
                                if (v) baseTotal += parseFloat(v);
                            });
                            const finalTotal = m.taxEnabled ? baseTotal * 1.15 : baseTotal;
                            liveCard.adsMetrics.spend = finalTotal;
                            
                            saveState();
                            if (card.updateReadonlyBadges) card.updateReadonlyBadges();
                            if (card.adsTotalSpendEl) card.adsTotalSpendEl.innerText = formatNum(finalTotal);
                            
                            taxBadge.style.background = m.taxEnabled ? '#ffbdad' : '#f4f5f7';
                            taxBadge.style.color = m.taxEnabled ? '#bf2600' : '#5e6c84';
                            taxBadge.style.border = m.taxEnabled ? '1px solid #bf260033' : '1px solid #5e6c8433';
                        }
                    };

                    const toggleBadge = document.createElement('div');
                    const isMetricsExpanded = m.metricsExpanded === true;
                    toggleBadge.style.cursor = 'pointer';
                    toggleBadge.style.borderRadius = '6px';
                    toggleBadge.style.background = isMetricsExpanded ? '#e9f2ff' : '#f4f5f7';
                    toggleBadge.style.color = isMetricsExpanded ? '#0c66e4' : '#5e6c84';
                    toggleBadge.style.border = isMetricsExpanded ? '1px solid #c7dfff' : '1px solid #dfe1e6';
                    toggleBadge.style.display = 'inline-flex';
                    toggleBadge.style.alignItems = 'center';
                    toggleBadge.style.overflow = 'hidden';
                    toggleBadge.style.whiteSpace = 'nowrap';
                    toggleBadge.style.boxSizing = 'border-box';
                    toggleBadge.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    toggleBadge.title = isMetricsExpanded ? 'Hide Tracker Metrics' : 'Show Tracker Metrics';
                    
                    toggleBadge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`;

                    if(toggleBadge) toggleBadge.onclick = (e) => {
                        e.stopPropagation();
                        m.metricsExpanded = !m.metricsExpanded;
                        const liveCard = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                        if (liveCard && liveCard.adsMetrics) liveCard.adsMetrics.metricsExpanded = m.metricsExpanded;
                        saveState();
                        
                        statsWrap.style.display = m.metricsExpanded ? 'flex' : 'none';
                        toggleBadge.style.background = m.metricsExpanded ? '#e9f2ff' : '#f4f5f7';
                        toggleBadge.style.color = m.metricsExpanded ? '#0c66e4' : '#5e6c84';
                        toggleBadge.style.border = m.metricsExpanded ? '1px solid #c7dfff' : '1px solid #dfe1e6';
                        toggleBadge.title = m.metricsExpanded ? 'Hide Tracker Metrics' : 'Show Tracker Metrics';
                        toggleBadge.style.marginBottom = m.metricsExpanded ? '6px' : '0';
                        
                        setTimeout(render, 10);
                    };

                    card.updateReadonlyBadges = () => {
                        const ls = activeBoard.lists.flatMap(la => la.cards).find(ca => ca.id === card.id);
                        const metrics = (ls && ls.adsMetrics) ? ls.adsMetrics : m;
                        
                        const s = metrics.spend || 0;
                        const r = metrics.revenue || 0;
                        const rawCost = metrics.cost || 0;
                        const c = metrics.costIsPercentage ? (r * (rawCost / 100)) : rawCost;
                        
                        if (s === 0) {
                            toggleBadge.style.opacity = '0';
                            toggleBadge.style.maxWidth = '0px';
                            toggleBadge.style.padding = '0';
                            toggleBadge.style.margin = '0';
                            toggleBadge.style.borderWidth = '0';
                            toggleBadge.style.transform = 'scale(0.8) translateY(4px)';
                            statsWrap.style.display = 'none';
                        } else {
                            toggleBadge.style.opacity = '1';
                            toggleBadge.style.maxWidth = '40px';
                            toggleBadge.style.padding = '6px';
                            toggleBadge.style.borderWidth = '1px';
                            toggleBadge.style.transform = 'scale(1) translateY(0)';
                            toggleBadge.style.marginRight = '4px';
                            toggleBadge.style.marginBottom = metrics.metricsExpanded ? '6px' : '0';
                            statsWrap.style.display = metrics.metricsExpanded ? 'flex' : 'none';
                        }
                        
                        if (r === 0 && s === 0 && rawCost === 0 && !metrics.taxEnabled) {
                            row2.style.display = 'none';
                        } else {
                            row2.style.display = 'flex';
                        }
                        
                        const roas = s > 0 ? (r / s).toFixed(2) : '0.00';
                        const gross = r - s;
                        const net = r - s - c;
                        const margin = r > 0 ? ((net / r) * 100).toFixed(1) : '0.0';

                        let beRoas = '0.00';
                        if (metrics.costIsPercentage && rawCost > 0 && rawCost < 100) {
                            beRoas = (1 / ((100 - rawCost) / 100)).toFixed(2);
                        } else if (!metrics.costIsPercentage && r > 0 && r > rawCost) {
                            const beMargin = (r - rawCost) / r;
                            beRoas = beMargin > 0 ? (1 / beMargin).toFixed(2) : '0.00';
                        }

                        roasBadge.innerHTML = `<span style="margin-right:4px">🚀</span> <span>${roas}x</span>`;
                        grossBadge.innerHTML = `<span style="margin-right:4px">📈</span> <span>${formatNum(gross)}</span>`;
                        netBadge.innerHTML = `<span style="margin-right:4px">💎</span> <span>${formatNum(net)}</span> <span style="font-size:9.5px;opacity:0.8;margin-left:4px">(${margin}%)</span>`;
                        breakevenBadge.innerHTML = `<span style="font-size:10px;opacity:0.8;margin-right:4px">Breakeven</span> <span style="font-weight:700">${beRoas}x</span>`;
                        
                        if (metrics.taxEnabled) {
                            taxBadge.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;height:14px;width:14px;">⚖️</span>`;
                        } else {
                            taxBadge.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;height:14px;width:14px;opacity:0.7;">⚖️</span>`;
                        }
                    };

                    card.updateReadonlyBadges();

                    // Pushes subsequent cost and tax badges to the right edge
                    revObj.badge.style.marginRight = 'auto';
                    
                    // Removed calculatorBadge from row1
                    row1.appendChild(revObj.badge);
                    row1.appendChild(costObj.badge);
                    row1.appendChild(taxBadge);
                    
                    row2Left.appendChild(roasBadge);
                    row2Left.appendChild(grossBadge);
                    row2Left.appendChild(netBadge);
                    
                    row2.appendChild(row2Left);
                    row2.appendChild(breakevenBadge);

                    statsWrap.appendChild(row1);
                    statsWrap.appendChild(row2);

                    badgeWrap.appendChild(toggleBadge);
                    badgeWrap.appendChild(statsWrap);
                }
            }
            
            let creationTimestamp = 0;
            let showAgeBadge = false;
            
            if (card.id && String(card.id).length === 24) {
                const hexTimestamp = card.id.substring(0, 8);
                creationTimestamp = parseInt(hexTimestamp, 16) * 1000;
                showAgeBadge = true;
            } else if (card.id && String(card.id).startsWith('pd_')) {
                if (card.pipedriveData && card.pipedriveData.add_time) {
                    creationTimestamp = new Date(card.pipedriveData.add_time).getTime();
                    showAgeBadge = true;
                }
            } else if (list.isClientHappiness || list.isMoneySmelling || !card.isTrello) {
                creationTimestamp = card.customCreationTimestamp || parseInt(String(card.id).replace('loc_', ''), 10);
                if (!isNaN(creationTimestamp) && creationTimestamp > 1000000000000) {
                    showAgeBadge = true;
                }
            }

            const needsTimeBadge = (card.isTrello || card.isPipedrive) && card.startTime && list.trackerType !== 'ads';

            if (!badgeWrap && (needsTimeBadge || showAgeBadge)) {
                badgeWrap = document.createElement('div');
                badgeWrap.className = 'badges';
                badgeWrap.style.display = 'flex';
                badgeWrap.style.alignItems = 'center';
                badgeWrap.style.flexWrap = 'wrap';
                badgeWrap.style.gap = '8px';
                badgeWrap.style.marginTop = '8px';
                badgeWrap.style.fontSize = '12px';
            }

            let createdTimeBadge = null;
            if (needsTimeBadge) {
                // Time in List Badge
                const timeBadge = document.createElement('div');
                timeBadge.className = 'badge badge-timer trello-clock';
                timeBadge.dataset.startTime = card.startTime;
                timeBadge.style.background = 'rgba(12, 102, 228, 0.08)';
                timeBadge.style.color = '#0c66e4';
                timeBadge.style.border = '1px solid rgba(12, 102, 228, 0.2)';
                timeBadge.style.padding = '4px 8px';
                timeBadge.style.borderRadius = '6px';
                timeBadge.style.display = 'flex';
                timeBadge.style.alignItems = 'center';
                
                const initialText = typeof formatTrelloTime === 'function' ? formatTrelloTime(card.startTime) : '0m';
                timeBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> <span class="clock-text" style="font-weight:600; letter-spacing:0.5px; font-size:11px; line-height: 1;">${initialText}</span>`;
                timeBadge.title = "Time spent in current list";
                createdTimeBadge = timeBadge;
            }
            
            if (badgeWrap) {
                let rightBadgeGroup = document.createElement('div');
                rightBadgeGroup.style.marginLeft = 'auto';
                rightBadgeGroup.style.display = 'flex';
                rightBadgeGroup.style.alignItems = 'center';
                rightBadgeGroup.style.gap = '4px';

                if (typeof calculatorBadge !== 'undefined' && calculatorBadge) {
                    rightBadgeGroup.appendChild(calculatorBadge);
                }
                
                if (createdTimeBadge) {
                    if (card.color === 'red') {
                        const fireBadge = document.createElement('span');
                        fireBadge.textContent = '🔥';
                        fireBadge.style.fontSize = '13px';
                        fireBadge.style.lineHeight = '1';
                        fireBadge.style.marginRight = '1px';
                        rightBadgeGroup.appendChild(fireBadge);
                    }
                    rightBadgeGroup.appendChild(createdTimeBadge);
                }
                
                if (showAgeBadge) {
                    const ageBadge = document.createElement('div');
                    ageBadge.className = 'badge badge-timer trello-age-clock';
                    if (list.isClientHappiness || list.isMoneySmelling) ageBadge.classList.add('hide-hours');
                    ageBadge.dataset.startTime = creationTimestamp;
                    
                    if (!activeBoard.clientHappinessData) activeBoard.clientHappinessData = {};
                    if (!activeBoard.cardColors) activeBoard.cardColors = {};
                    
                    const moneyColor = activeBoard.cardColors[card.id] || 'default';
                    const happinessColor = activeBoard.clientHappinessData[card.id] || 'default';
                    const activeColor = list.isClientHappiness ? happinessColor : moneyColor;
                    
                    let bgColor = 'rgba(9, 30, 66, 0.04)';
                    let txtColor = 'var(--text-color)';
                    let borderColor = 'rgba(9, 30, 66, 0.08)';
                    let badgeOpacity = '0.85';
                    
                    if (activeColor === 'green') {
                        bgColor = 'rgba(34, 160, 107, 0.15)'; 
                        txtColor = '#1f845a'; 
                        borderColor = 'rgba(34, 160, 107, 0.3)';
                        badgeOpacity = '1';
                    } else if (activeColor === 'yellow') {
                        bgColor = 'rgba(245, 205, 71, 0.2)'; 
                        txtColor = '#b38600'; 
                        borderColor = 'rgba(245, 205, 71, 0.4)';
                        badgeOpacity = '1';
                    } else if (activeColor === 'orange') {
                        bgColor = 'rgba(255, 152, 0, 0.15)'; 
                        txtColor = '#e65100'; 
                        borderColor = 'rgba(255, 152, 0, 0.3)';
                        badgeOpacity = '1';
                    } else if (activeColor === 'red') {
                        bgColor = 'rgba(201, 55, 44, 0.15)'; 
                        txtColor = '#c9372c'; 
                        borderColor = 'rgba(201, 55, 44, 0.3)';
                        badgeOpacity = '1';
                    }
                    
                    ageBadge.style.background = bgColor;
                    ageBadge.style.color = txtColor;
                    ageBadge.style.border = `1px solid ${borderColor}`;
                    ageBadge.style.padding = '4px 8px';
                    ageBadge.style.borderRadius = '6px';
                    ageBadge.style.opacity = badgeOpacity;
                    ageBadge.style.cursor = 'pointer';
                    ageBadge.style.position = 'relative';
                    ageBadge.style.display = 'flex';
                    ageBadge.style.alignItems = 'center';
                    
                    let ageEmoji = '';
                    const listIsMoney = list.isMoneySmelling || list.isNewClients;
                    if (listIsMoney) {
                        if (moneyColor === 'green') ageEmoji = `<span style="font-size:14px;line-height:1;margin-right:4px;">🔥</span>`;
                        else if (moneyColor === 'yellow') ageEmoji = `<span style="font-size:14px;line-height:1;margin-right:4px;">☀️</span>`;
                        else if (moneyColor === 'orange') ageEmoji = `<span style="font-size:14px;line-height:1;margin-right:4px;">⛅</span>`;
                        else if (moneyColor === 'red') ageEmoji = `<span style="font-size:14px;line-height:1;margin-right:4px;">❄️</span>`;
                    } else {
                        if (activeColor === 'green') ageEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                        else if (activeColor === 'yellow') ageEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                        else if (activeColor === 'orange') ageEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                        else if (activeColor === 'red') ageEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                    }
                    
                    const ageText = typeof formatTrelloTime === 'function' ? formatTrelloTime(creationTimestamp, true, list.isClientHappiness || list.isMoneySmelling) : '0h';
                    ageBadge.innerHTML = `<span class="age-icon-lock" style="display:flex; align-items:center;">${ageEmoji}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></span> <span class="clock-text" style="font-weight:600; letter-spacing:0.5px; font-size:11px;">${ageText}</span>`;
                    ageBadge.title = "Total age of card since creation. Click to set status.";
                    
                    if(ageBadge) ageBadge.onclick = (e) => {
                        e.stopPropagation();
                        
                        const isMineOpen = ageBadge.dataset.pickerOpen === 'true';
                        
                        // Close any existing menus globally
                        document.querySelectorAll('.age-color-picker-active').forEach(el => el.remove());
                        document.querySelectorAll('.trello-age-clock').forEach(b => b.dataset.pickerOpen = 'false');
                        
                        // If my menu was already open, the above lines closed it, so we just stop here.
                        if (isMineOpen) return;
                        
                        ageBadge.dataset.pickerOpen = 'true';
                        
                        const rect = ageBadge.getBoundingClientRect();
                        
                        const picker = document.createElement('div');
                        // Use a blank class name so legacy CSS doesn't accidentally trigger opacity:0
                        picker.className = 'age-color-picker-active'; 
                        picker.style.cssText = `
                            position: fixed;
                            top: ${rect.bottom + 6}px;
                            left: ${rect.left}px;
                            background: #ffffff;
                            border: 1px solid rgba(0,0,0,0.1);
                            border-radius: 8px;
                            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                            padding: 6px;
                            display: flex;
                            gap: 6px;
                            z-index: 9999999;
                            opacity: 0;
                            pointer-events: none;
                            transform: translateY(-5px);
                            transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                        `;
                        
                        const emjsForPicker = {
                            green: listIsMoney ? '<span style="font-size:22px;line-height:1;">🔥</span>' : '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            yellow: listIsMoney ? '<span style="font-size:22px;line-height:1;">☀️</span>' : '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            orange: listIsMoney ? '<span style="font-size:22px;line-height:1;">⛅</span>' : '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            red: listIsMoney ? '<span style="font-size:22px;line-height:1;">❄️</span>' : '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>',
                            default: '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e9e9e9" stroke="#cbd5e1" stroke-width="2"/></svg>'
                        };

                        const colorsList = ['default', 'green', 'yellow', 'orange', 'red'];
                        colorsList.forEach(col => {
                            const dot = document.createElement('div');
                            dot.style.cssText = `
                                width: 24px; height: 24px; border-radius: 50%;
                                cursor: pointer; border: 2px solid transparent;
                                display: flex; align-items: center; justify-content: center;
                                transition: transform 0.1s;
                            `;
                            dot.innerHTML = emjsForPicker[col];
                            
                            dot.onmouseover = () => dot.style.transform = 'scale(1.15)';
                            dot.onmouseout = () => dot.style.transform = 'scale(1)';
                            
                            if(dot) dot.onclick = (ev) => {
                                ev.stopPropagation();
                                if (list.isClientHappiness) {
                                    if (!activeBoard.clientHappinessData) activeBoard.clientHappinessData = {};
                                    activeBoard.clientHappinessData[card.id] = col;
                                } else {
                                    activeBoard.cardColors[card.id] = col;
                                }
                                saveState();
                                
                                picker.style.opacity = '0';
                                picker.style.transform = 'translateY(-5px)';
                                picker.style.pointerEvents = 'none';
                                
                                // Surgically scan the DOM array right away for zero-latency feedback
                                updateAllTrackersSummaries(activeBoard);
                                
                                setTimeout(() => {
                                    picker.remove();
                                }, 160);
                                ageBadge.dataset.pickerOpen = 'false';
                                
                                // Instantly mutate the DOM element locally for zero-latency feedback
                                let popBgColor = 'rgba(9, 30, 66, 0.04)';
                                let popTxtColor = 'var(--text-color)';
                                let popBorderColor = 'rgba(9, 30, 66, 0.08)';
                                let popOpacity = '0.85';
                                
                                if (col === 'green') {
                                    popBgColor = 'rgba(34, 160, 107, 0.15)'; popTxtColor = '#1f845a'; popBorderColor = 'rgba(34, 160, 107, 0.3)'; popOpacity = '1';
                                } else if (col === 'yellow') {
                                    popBgColor = 'rgba(245, 205, 71, 0.2)'; popTxtColor = '#b38600'; popBorderColor = 'rgba(245, 205, 71, 0.4)'; popOpacity = '1';
                                } else if (col === 'orange') {
                                    popBgColor = 'rgba(255, 152, 0, 0.15)'; popTxtColor = '#e65100'; popBorderColor = 'rgba(255, 152, 0, 0.3)'; popOpacity = '1';
                                } else if (col === 'red') {
                                    popBgColor = 'rgba(201, 55, 44, 0.15)'; popTxtColor = '#c9372c'; popBorderColor = 'rgba(201, 55, 44, 0.3)'; popOpacity = '1';
                                }
                                
                                ageBadge.style.background = popBgColor;
                                ageBadge.style.color = popTxtColor;
                                ageBadge.style.border = `1px solid ${popBorderColor}`;
                                ageBadge.style.opacity = popOpacity;
                                
                                let newEmoji = '';
                                if (col === 'green') newEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                                if (col === 'yellow') newEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                                if (col === 'orange') newEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                                if (col === 'red') newEmoji = `<svg width="14" height="14" viewBox="0 0 24 24" style="margin-right:6px; flex-shrink:0;"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>`;
                                
                                const innerSpan = ageBadge.querySelector('.age-icon-lock');
                                if (innerSpan) {
                                    innerSpan.innerHTML = `${newEmoji}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
                                }
                            };
                            picker.appendChild(dot);
                        });
                        
                        if (list.isClientHappiness || list.isMoneySmelling || (!card.isTrello && !card.pipedriveData)) {
                            const ageDivider = document.createElement('div');
                            ageDivider.style.width = '1px';
                            ageDivider.style.background = '#e1e3e8';
                            ageDivider.style.margin = '0 2px';
                            picker.appendChild(ageDivider);
                            
                            const manualMoInput = document.createElement('input');
                            manualMoInput.type = 'number';
                            manualMoInput.min = '0';
                            manualMoInput.placeholder = 'mo';
                            manualMoInput.title = 'Months (press Enter to save)';
                            manualMoInput.style.cssText = 'width: 38px; font-size: 11px; padding: 2px 4px; border: 1px solid #dfe1e6; border-radius: 3px; outline: none; margin-left: 2px; text-align: center; color: #172b4d;';
                            
                            const manualDayInput = document.createElement('input');
                            manualDayInput.type = 'number';
                            manualDayInput.min = '0';
                            manualDayInput.placeholder = 'd';
                            manualDayInput.title = 'Days (press Enter to save)';
                            manualDayInput.style.cssText = 'width: 34px; font-size: 11px; padding: 2px 4px; border: 1px solid #dfe1e6; border-radius: 3px; outline: none; margin-left: 2px; text-align: center; color: #172b4d;';
                            
                            const currentDays = Math.floor((Date.now() - creationTimestamp) / 86400000);
                            if (currentDays >= 0) {
                                manualMoInput.value = Math.floor(currentDays / 30);
                                manualDayInput.value = currentDays % 30;
                            }
                            
                            const handleEnter = (e) => {
                                if (e.key === 'Enter') {
                                    e.stopPropagation();
                                    const mo = parseInt(manualMoInput.value, 10) || 0;
                                    const d = parseInt(manualDayInput.value, 10) || 0;
                                    if (mo >= 0 && d >= 0) {
                                        const totDays = (mo * 30) + d;
                                        card.customCreationTimestamp = Date.now() - (totDays * 86400000);
                                        saveState();
                                        document.querySelectorAll('.age-color-picker-active').forEach(el => el.remove());
                                        render();
                                    }
                                }
                            };
                            
                            if(manualMoInput) manualMoInput.onclick = manualDayInput.onclick = (e) => e.stopPropagation();
                            manualMoInput.onkeydown = manualDayInput.onkeydown = handleEnter;
                            
                            picker.appendChild(manualMoInput);
                            picker.appendChild(manualDayInput);
                        }
                        
                        document.body.appendChild(picker);
                        
                        // Force a reflow then apply visible styles instantly to pop it in smoothly
                        void picker.offsetWidth;
                        picker.style.opacity = '1';
                        picker.style.pointerEvents = 'auto';
                        picker.style.transform = 'translateY(0)';
                        
                        const closePicker = (ev) => {
                            if (!picker.contains(ev.target)) {
                                picker.style.opacity = '0';
                                picker.style.transform = 'translateY(-5px)';
                                picker.style.pointerEvents = 'none';
                                setTimeout(() => picker.remove(), 150);
                                ageBadge.dataset.pickerOpen = 'false';
                                document.removeEventListener('click', closePicker);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', closePicker), 10);
                    };
                    
                    rightBadgeGroup.appendChild(ageBadge);
                    
                    if (list.isClientHappiness || list.isMoneySmelling) {
                        const happinessWrap = document.createElement('div');
                        happinessWrap.style.display = 'flex';
                        happinessWrap.style.gap = '4px';
                        happinessWrap.style.marginLeft = '4px';
                        
                        const states = [
                            { val: 'green', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(34, 160, 107, 0.15)' },
                            { val: 'yellow', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(245, 205, 71, 0.2)' },
                            { val: 'orange', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(255, 152, 0, 0.15)' },
                            { val: 'red', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(201, 55, 44, 0.15)' }
                        ];
                        
                        const currentHappiness = activeBoard.clientHappinessData?.[card.id] || 'default';
                        
                        states.forEach(st => {
                            const btn = document.createElement('div');
                            btn.innerHTML = st.svg;
                            btn.style.width = '24px';
                            btn.style.height = '24px';
                            btn.style.display = 'flex';
                            btn.style.alignItems = 'center';
                            btn.style.justifyContent = 'center';
                            btn.style.borderRadius = '6px';
                            btn.style.cursor = 'pointer';
                            btn.style.transition = 'all 0.15s ease';
                            
                            if (currentHappiness === st.val) {
                                btn.style.background = st.bg;
                                btn.style.opacity = '1';
                                btn.style.transform = 'scale(1.1)';
                            } else {
                                btn.style.background = 'transparent';
                                btn.style.opacity = currentHappiness === 'default' ? '0.6' : '0.3';
                            }
                            
                            btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
                            btn.onmouseleave = () => btn.style.transform = currentHappiness === st.val ? 'scale(1.1)' : 'scale(1)';
                            
                            if(btn) btn.onclick = (e) => {
                                e.stopPropagation();
                                if (!activeBoard.clientHappinessData) activeBoard.clientHappinessData = {};
                                
                                if (activeBoard.clientHappinessData[card.id] === st.val) {
                                    activeBoard.clientHappinessData[card.id] = 'default';
                                } else {
                                    activeBoard.clientHappinessData[card.id] = st.val;
                                }
                                saveState();
                                render();
                            };
                            
                            happinessWrap.appendChild(btn);
                        });
                        
                        rightBadgeGroup.appendChild(happinessWrap);
                    }
                }
                
                if (rightBadgeGroup.hasChildNodes()) {
                    badgeWrap.appendChild(rightBadgeGroup);
                }
                
                if (globalValWrap) {
                    badgeWrap.insertBefore(globalValWrap, badgeWrap.firstChild);
                }
                
                cardEl.appendChild(badgeWrap);
            } else if (globalValWrap) {
                const tempBadgeWrap = document.createElement('div');
                tempBadgeWrap.className = 'badges card-badges';
                tempBadgeWrap.style.display = 'flex';
                tempBadgeWrap.style.alignItems = 'center';
                tempBadgeWrap.style.marginTop = '8px';
                
                tempBadgeWrap.appendChild(globalValWrap);
                
                cardEl.appendChild(tempBadgeWrap);
            }

            if ((list.isClientHappiness || list.isMoneySmelling) && card.services && card.services.length > 0) {
                const svcsWrap = document.createElement('div');
                svcsWrap.style.marginTop = '6px';
                svcsWrap.style.display = 'flex';
                svcsWrap.style.flexWrap = 'wrap';
                svcsWrap.style.gap = '6px';
                
                const emojiMap = {
                    'Store': { icon: '🛍️' },
                    'Paid Ads': { icon: '🚀' },
                    'Social Media': { icon: '📱' },
                    'SEO': { icon: '🔎' },
                    'WA API': { icon: '💬' },
                    'Website monitoring': { icon: '⚡' },
                    'Marketplaces': { icon: '🛒' }
                };
                
                card.services.forEach(svc => {
                    const mapped = emojiMap[svc] || { icon: '🔧' };
                    
                    const pillEl = document.createElement('div');
                    pillEl.style.display = 'flex';
                    pillEl.style.alignItems = 'center';
                    pillEl.style.gap = '4px';
                    pillEl.style.background = 'rgba(9, 30, 66, 0.04)';
                    pillEl.style.border = '1px solid rgba(9, 30, 66, 0.08)';
                    pillEl.style.borderRadius = '3px';
                    pillEl.style.padding = '2px 5px';
                    pillEl.style.fontSize = '11.5px';
                    pillEl.style.fontWeight = '500';
                    pillEl.style.color = 'var(--text-color)';
                    pillEl.title = svc;
                    
                    const animSpan = document.createElement('span');
                    animSpan.innerHTML = mapped.icon;
                    
                    const txtSpan = document.createElement('span');
                    txtSpan.textContent = svc;
                    
                    pillEl.appendChild(animSpan);
                    pillEl.appendChild(txtSpan);
                    svcsWrap.appendChild(pillEl);
                });
                
                cardEl.appendChild(svcsWrap);
            }

            const isRedMS = list.isMoneySmelling && activeBoard.cardColors && activeBoard.cardColors[card.id] === 'red';
            const isRedCH = list.isClientHappiness && activeBoard.clientHappinessData && activeBoard.clientHappinessData[card.id] === 'red';

            if (isRedMS || isRedCH) {
                const reasonWrap = document.createElement('div');
                reasonWrap.style.marginTop = '6px';
                
                const reasonInput = document.createElement('textarea');
                reasonInput.placeholder = 'Reason for being angry...';
                reasonInput.value = card.angryReason || '';
                reasonInput.dir = 'auto';
                reasonInput.style.cssText = 'width: 100%; font-size: 11.5px; padding: 6px; border: 1px solid #ffcccc; border-radius: 4px; outline: none; background: #fff5f5; color: #c9372c; resize: none; min-height: 28px; box-sizing: border-box; font-family: inherit; line-height: 1.4; overflow: hidden;';
                
                if(reasonInput) reasonInput.onclick = (e) => e.stopPropagation();
                
                const autoResize = () => {
                    reasonInput.style.height = 'auto';
                    reasonInput.style.height = Math.min(reasonInput.scrollHeight, 100) + 'px';
                };
                
                reasonInput.oninput = autoResize;
                setTimeout(autoResize, 0);
                
                const saveReason = () => {
                    const val = reasonInput.value.trim();
                    if (val !== (card.angryReason || '')) {
                        card.angryReason = val;
                        saveState();
                    }
                };
                
                reasonInput.onblur = saveReason;
                reasonInput.onkeydown = (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        reasonInput.blur();
                    }
                };
                
                reasonWrap.appendChild(reasonInput);
                cardEl.appendChild(reasonWrap);
            }

            if (card.isPinned) {
                pinnedListEl.appendChild(cardEl);
            } else {
                cardListEl.appendChild(cardEl);
            }
        });
        
        listContainer.appendChild(cardListEl);

        let scrollRAF = null;
        let lastScrollY = 0;
        if(listContainer) listContainer.addEventListener('dragover', (e) => {
            const rect = listContainer.getBoundingClientRect();
            let dist = 0;
            if (e.clientY < rect.top + 100) dist = -15;
            else if (e.clientY > rect.bottom - 100) dist = 15;
            
            if (dist !== 0) {
                lastScrollY = dist;
                if (!scrollRAF) {
                    const doScroll = () => {
                        if (lastScrollY !== 0) {
                            cardListEl.scrollTop += lastScrollY;
                            scrollRAF = requestAnimationFrame(doScroll);
                        } else {
                            scrollRAF = null;
                        }
                    };
                    scrollRAF = requestAnimationFrame(doScroll);
                }
            } else {
                lastScrollY = 0;
            }
        });
        if(listContainer) listContainer.addEventListener('dragleave', () => lastScrollY = 0);
        if(listContainer) listContainer.addEventListener('drop', () => lastScrollY = 0);

        const addBtn = document.createElement('button');
        addBtn.className = 'add-card-btn managing-add-btn';
        
        let ctaText = 'Add a card';
        if (list.pipedriveStageId) ctaText = 'Add a deal';
        if (list.trelloTasksListId) ctaText = 'Add a task';
        
        if (list.trelloListId) addBtn.style.display = 'none';
        
        addBtn.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>${ctaText}</span>
            </div>
        `;
        
        if(addBtn) addBtn.onclick = () => {
            newCardTitle.value = '';
            activeTargetListId = list.id;
            
            const addCardTimerSection = document.getElementById('addCardTimerSection');
            if (addCardTimerSection) addCardTimerSection.style.display = 'none';
            
            const isTrelloTask = !!list.trelloTasksListId;
            const isPipedrive = !!list.pipedriveStageId;
            const isMoneySmelling = !!list.isMoneySmelling;
            
            document.querySelector('#addCardModal h3').textContent = (isPipedrive || isMoneySmelling) ? 'Add New Deal' : (isTrelloTask ? 'Add New Trello Task' : 'Add New Card');
            const mainLabel = document.querySelector('#addCardModal label#mainTitleLabel');
            if (mainLabel) mainLabel.textContent = (isPipedrive || isMoneySmelling) ? 'Deal Title' : (isTrelloTask ? 'Task Title' : 'Card Title');
            else document.querySelector('#addCardModal label').textContent = (isPipedrive || isMoneySmelling) ? 'Deal Title' : (isTrelloTask ? 'Task Title' : 'Card Title');
            document.getElementById('newCardTitle').placeholder = (isPipedrive || isMoneySmelling) ? 'e.g. Acme Corp Deal' : (isTrelloTask ? 'e.g. Write documentation...' : 'e.g. New Task or Item');
            document.getElementById('confirmAddBtn').textContent = (isPipedrive || isMoneySmelling) ? 'Add Deal' : (isTrelloTask ? 'Add Task' : 'Add Card');
            
            const pipedriveExtras = document.getElementById('pipedriveExtras');
            if (pipedriveExtras) {
                pipedriveExtras.style.display = (isPipedrive || isMoneySmelling) ? 'block' : 'none';
                if (isPipedrive || isMoneySmelling) {
                    const valInput = document.getElementById('newDealValue');
                    const waInput = document.getElementById('newDealWaLink');
                    const noteInput = document.getElementById('newDealNote');
                    if (valInput) valInput.value = '';
                    if (waInput) waInput.value = '';
                    if (noteInput) noteInput.value = '';
                }
            }

            addCardModal.classList.add('active');
            setTimeout(() => newCardTitle.focus(), 50);
        };
        footerRow = document.createElement('div');
        footerRow.className = 'list-footer-row';
        footerRow.style.display = 'flex';
        footerRow.style.alignItems = 'center';
        footerRow.style.gap = '8px';
        footerRow.style.padding = '0 8px 8px';
        
        listCheckBtn = document.createElement('div');
        listCheckBtn.style.cursor = 'pointer';
        listCheckBtn.style.display = 'flex';
        listCheckBtn.style.alignItems = 'center';
        listCheckBtn.style.justifyContent = 'center';
        listCheckBtn.style.width = '28px';
        listCheckBtn.style.height = '28px';
        listCheckBtn.style.marginLeft = '4px';
        listCheckBtn.style.borderRadius = '50%';
        listCheckBtn.style.transition = 'all 0.2s';
        listCheckBtn.style.flexShrink = '0';
        
        const updateCheckBtnVisuals = () => {
            if (activeBoard.listChecks && activeBoard.listChecks[list.id]) {
                listCheckBtn.style.background = '#20c997'; 
                listCheckBtn.style.boxShadow = '0 0 10px rgba(32, 201, 151, 0.4)';
                listCheckBtn.innerHTML = `
                    <svg width="28" height="28" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" stroke-width="2"/>
                        <path d="M9.5 12 L11.5 14 L15 9.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
            } else {
                listCheckBtn.style.background = 'transparent';
                listCheckBtn.style.boxShadow = 'none';
                listCheckBtn.innerHTML = `
                    <svg width="28" height="28" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(107, 119, 140, 0.2)" stroke-width="1.5"/>
                        <circle cx="12" cy="12" r="6" fill="none" stroke="#8c9bab" stroke-width="2"/>
                        <path d="M9.5 12 L11.5 14 L15 9.5" fill="none" stroke="#8c9bab" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
            }
        };

        updateCheckBtnVisuals();

        listCheckBtn.onclick = (e) => {
            e.stopPropagation();
            if (!activeBoard.listChecks) activeBoard.listChecks = {};
            activeBoard.listChecks[list.id] = !activeBoard.listChecks[list.id];
            saveState();
            updateCheckBtnVisuals();
        };

        if (activeBoard.showListCheck && activeBoard.showListCheck[list.id]) {
            footerRow.appendChild(listCheckBtn);
        }

        addBtn.style.flexGrow = '1';
        addBtn.style.margin = '0'; 
        footerRow.appendChild(addBtn);

        listContainer.appendChild(footerRow);

        const hasOutgoing = activeBoard.connections && activeBoard.connections.some(c => c.source === list.id);

        const __allHappinessTargets = (activeBoard.connections || [])
            .filter(c => c.source === list.id)
            .map(c => activeBoard.lists.find(l => l.id === c.target));
            
        const renderTrackerStats = (trackerType, checkFn, svgIcon, xferData) => {
            const targets = __allHappinessTargets.filter(l => l && checkFn(l));
            if (targets.length === 0) return;
            
            const counts = {};
            const colorCounts = { green: 0, yellow: 0, orange: 0, red: 0, default: 0 };
            let totalCards = 0;
            
            targets.forEach(happinessList => {
                if (happinessList.cards) {
                    totalCards += happinessList.cards.length;
                    happinessList.cards.forEach(c => {
                        const col = (activeBoard.clientHappinessData && activeBoard.clientHappinessData[c.id]) ? activeBoard.clientHappinessData[c.id] : 'default';
                        if (colorCounts[col] !== undefined) colorCounts[col]++;
                        
                        if (c.services && c.services.length > 0) {
                            c.services.forEach(svc => {
                                counts[svc] = (counts[svc] || 0) + 1;
                            });
                        }
                    });
                }
            });
            
            const emojiMap = {
                'Store': '🛍️',
                'Paid Ads': '🚀',
                'Social Media': '📱',
                'SEO': '🔎',
                'WA API': '💬',
                'Website monitoring': '⚡',
                'Marketplaces': '🛒'
            };
            
            let localTotalSummaryEl = null;
            
            if (totalCards > 0) {
                const totalSummaryEl = document.createElement('div');
                totalSummaryEl.className = 'client-happiness-total tracker-total-' + trackerType;
                totalSummaryEl.style.display = 'flex';
                totalSummaryEl.style.gap = '6px';
                totalSummaryEl.style.margin = '0px 20px 6px 20px';
                
                localTotalSummaryEl = totalSummaryEl;
                
                const totalPill = document.createElement('div');
                totalPill.style.display = 'flex';
                totalPill.style.alignItems = 'center';
                totalPill.style.gap = '4px';
                totalPill.style.background = 'rgba(9, 30, 66, 0.08)';
                totalPill.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                totalPill.style.borderRadius = '6px';
                totalPill.style.padding = '4px 8px';
                totalPill.style.fontSize = '12px';
                totalPill.style.fontWeight = '700';
                totalPill.style.color = '#172b4d';
                totalPill.title = trackerType === 'clientHappiness' ? 'Total Clients Tracked' : 'Total Money Tracked';
                totalPill.style.cursor = 'pointer';
                
                const allTrackerCards = targets.flatMap(l => l.cards || []);
                const titleText = trackerType === 'clientHappiness' ? 'Total Clients Tracked' : 'Total Money Tracked';
                if(totalPill) totalPill.onclick = () => openServiceCardsModal(titleText, '👥', allTrackerCards);
                
                totalPill.innerHTML = `<span style="font-size:14px;">👥</span> <span>${totalCards}</span>`;
                totalSummaryEl.appendChild(totalPill);
                listContainer.insertBefore(totalSummaryEl, cardListEl);
            }

            const filterStates = [
                { val: 'green', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#43A047"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 15 Q12 19 16 15" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(34, 160, 107, 0.15)', textCol: '#22a06b' },
                { val: 'yellow', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FDD835"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><line x1="8" y1="15" x2="16" y2="15" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(245, 205, 71, 0.2)', textCol: '#b07b00' },
                { val: 'orange', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FF9800"/><circle cx="8" cy="10" r="1.5" fill="#212121"/><circle cx="16" cy="10" r="1.5" fill="#212121"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(255, 152, 0, 0.15)', textCol: '#d97706' },
                { val: 'red', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E53935"/><circle cx="8" cy="11" r="1.5" fill="#212121"/><circle cx="16" cy="11" r="1.5" fill="#212121"/><line x1="6" y1="8" x2="10" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="8" x2="14" y2="10" stroke="#212121" stroke-width="2" stroke-linecap="round"/><path d="M8 17 Q12 13 16 17" fill="none" stroke="#212121" stroke-width="2" stroke-linecap="round"/></svg>', bg: 'rgba(201, 55, 44, 0.15)', textCol: '#ae2e24' },
                { val: 'default', svg: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#8c9bab" stroke-width="2.5"/></svg>', bg: 'rgba(9, 30, 66, 0.08)', textCol: '#5e6c84' }
            ];

            const colorSummaryEl = document.createElement('div');
            colorSummaryEl.className = 'client-happiness-colors tracker-colors-' + trackerType;
            colorSummaryEl.style.display = 'flex';
            colorSummaryEl.style.flexWrap = 'wrap';
            colorSummaryEl.style.gap = '6px';
            colorSummaryEl.style.margin = '-4px 16px 2px 16px';
            colorSummaryEl.style.padding = '4px';

            let addedAnyColors = false;

            filterStates.forEach(st => {
                const count = colorCounts[st.val];
                if (count > 0) {
                    const pill = document.createElement('div');
                    pill.style.display = 'flex';
                    pill.style.alignItems = 'center';
                    pill.style.justifyContent = 'center';
                    pill.style.height = '24px';
                    pill.style.padding = '0 8px 0 6px';
                    pill.style.background = st.bg;
                    pill.style.borderRadius = '6px';
                    pill.style.cursor = 'pointer';
                    pill.style.transition = 'all 0.15s ease';
                    pill.style.position = 'relative';
                    pill.style.boxSizing = 'border-box';
                    
                    const currentFilter = activeBoard.happinessFilters ? activeBoard.happinessFilters[trackerType] : null;
                    if (currentFilter === st.val) {
                        pill.style.transform = 'scale(1.1)';
                        pill.style.boxShadow = '0 0 0 1px ' + st.textCol;
                        pill.style.opacity = '1';
                        pill.style.zIndex = '10';
                    } else {
                        pill.style.boxShadow = 'none';
                        pill.style.opacity = currentFilter ? '0.4' : '1';
                        pill.style.zIndex = '1';
                    }
                    
                    pill.onmouseenter = () => { if (currentFilter !== st.val) { pill.style.transform = 'scale(1.05)'; pill.style.zIndex = '5'; } pill.style.opacity = '1'; };
                    pill.onmouseleave = () => { if (currentFilter !== st.val) { pill.style.transform = 'scale(1)'; pill.style.opacity = currentFilter ? '0.4' : '1'; pill.style.zIndex = '1'; } };
                    
                    if(pill) pill.onclick = (e) => {
                        e.stopPropagation();
                        activeBoard.happinessFilters = activeBoard.happinessFilters || {};
                        activeBoard.happinessFilters[trackerType] = activeBoard.happinessFilters[trackerType] === st.val ? null : st.val;
                        saveState();
                        
                        const cl = pill.closest('.kanban-list').querySelector('.card-list');
                        if (cl) {
                            cl.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
                            cl.style.opacity = '0';
                            cl.style.transform = 'translateY(10px)';
                            setTimeout(() => { window.isFilterFadingIn = true; render(); }, 150);
                        } else {
                            window.isFilterFadingIn = true;
                            render();
                        }
                    };
                    
                    pill.innerHTML = `${st.svg} <span style="font-weight:700; font-size:14px; margin-left:4px; margin-bottom:-1px; color:${st.textCol};">${count}</span>`;
                    
                    colorSummaryEl.appendChild(pill);
                    addedAnyColors = true;
                }
            });

            if (activeBoard.isolateCardId) {
                const exitBtn = document.createElement('div');
                exitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                exitBtn.style.width = '24px';
                exitBtn.style.height = '24px';
                exitBtn.style.background = 'rgba(9, 30, 66, 0.08)';
                exitBtn.style.color = '#5e6c84';
                exitBtn.style.borderRadius = '6px';
                exitBtn.style.display = 'flex';
                exitBtn.style.alignItems = 'center';
                exitBtn.style.justifyContent = 'center';
                exitBtn.style.cursor = 'pointer';
                exitBtn.style.marginLeft = 'auto'; 
                exitBtn.style.transition = 'all 0.15s ease';
                
                exitBtn.onmouseenter = () => { exitBtn.style.background = 'rgba(9, 30, 66, 0.15)'; exitBtn.style.color = '#172b4d'; };
                exitBtn.onmouseleave = () => { exitBtn.style.background = 'rgba(9, 30, 66, 0.08)'; exitBtn.style.color = '#5e6c84'; };
                
                if(exitBtn) exitBtn.onclick = (e) => {
                    e.stopPropagation();
                    activeBoard.isolateCardId = null;
                    saveState();
                    render();
                };
                
                colorSummaryEl.appendChild(exitBtn);
                addedAnyColors = true;
            }

            if (addedAnyColors) {
                const labelWrap = document.createElement('div');
                labelWrap.style.margin = '10px 20px 4px 20px'; // Add slight top margin to separate blocks visually
                
                const labelPill = document.createElement('div');
                labelPill.style.display = 'inline-flex';
                labelPill.style.alignItems = 'center';
                labelPill.style.justifyContent = 'center';
                labelPill.style.width = '24px';
                labelPill.style.height = '24px';
                labelPill.style.background = 'transparent';
                labelPill.style.borderRadius = '6px';
                labelPill.style.fontSize = '14px';
                labelPill.title = `Drag to transfer ${trackerType} tracking`;
                labelPill.draggable = true;
                labelPill.style.cursor = 'default';
                labelPill.onmousedown = () => labelPill.style.cursor = 'grabbing';
                labelPill.onmouseup = () => labelPill.style.cursor = 'default';
                labelPill.onmouseleave = () => labelPill.style.cursor = 'default';
                labelPill.ondragstart = (e) => {
                    e.dataTransfer.setData(xferData, list.id);
                    e.dataTransfer.effectAllowed = 'move';
                };
                labelPill.innerHTML = svgIcon;
                
                labelWrap.appendChild(labelPill);
                
                if (localTotalSummaryEl) {
                    listContainer.insertBefore(labelWrap, localTotalSummaryEl);
                } else {
                    listContainer.insertBefore(labelWrap, cardListEl);
                }
                listContainer.insertBefore(colorSummaryEl, cardListEl);
            }

            let hasAnyServices = false;
            Object.keys(counts).forEach(svc => {
                if (counts[svc] > 0) hasAnyServices = true;
            });
            
            if (hasAnyServices) {
                const serviceSummaryEl = document.createElement('div');
                serviceSummaryEl.className = 'client-happiness-services tracker-services-' + trackerType;
                serviceSummaryEl.style.display = 'flex';
                serviceSummaryEl.style.flexWrap = 'wrap';
                serviceSummaryEl.style.gap = '6px';
                serviceSummaryEl.style.margin = '-4px 16px 6px 16px';
                serviceSummaryEl.style.padding = '4px';
                
                Object.keys(counts).forEach(svc => {
                    if (counts[svc] > 0) {
                        const pill = document.createElement('div');
                        pill.style.display = 'flex';
                        pill.style.alignItems = 'center';
                        pill.style.gap = '4px';
                        pill.style.borderRadius = '6px';
                        pill.style.padding = '4px 8px';
                        pill.style.fontSize = '12px';
                        pill.style.fontWeight = '600';
                        pill.style.color = '#5E6C84';
                        pill.title = `${svc} Active: ${counts[svc]}`;
                        pill.style.cursor = 'pointer';
                        pill.style.transition = 'all 0.15s ease';
                        
                        const curSvcFilter = activeBoard.serviceFilters ? activeBoard.serviceFilters[trackerType] : null;
                        if (curSvcFilter === svc) {
                            pill.style.transform = 'scale(1.1)';
                            pill.style.background = 'rgba(9, 30, 66, 0.15)';
                            pill.style.border = '1px solid rgba(9, 30, 66, 0.5)';
                            pill.style.opacity = '1';
                        } else {
                            pill.style.transform = 'scale(1)';
                            pill.style.background = 'rgba(9, 30, 66, 0.04)';
                            pill.style.border = '1px solid transparent';
                            pill.style.opacity = curSvcFilter ? '0.4' : '1';
                        }
                        
                        pill.onmouseenter = () => { if (curSvcFilter !== svc) { pill.style.transform = 'scale(1.05)'; } pill.style.opacity = '1'; };
                        pill.onmouseleave = () => { if (curSvcFilter !== svc) { pill.style.transform = 'scale(1)'; pill.style.opacity = curSvcFilter ? '0.4' : '1'; } };
                        
                        if(pill) pill.onclick = (e) => {
                            e.stopPropagation();
                            activeBoard.serviceFilters = activeBoard.serviceFilters || {};
                            activeBoard.serviceFilters[trackerType] = activeBoard.serviceFilters[trackerType] === svc ? null : svc;
                            saveState();
                            
                            const cl = pill.closest('.kanban-list').querySelector('.card-list');
                            if (cl) {
                                cl.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
                                cl.style.opacity = '0';
                                cl.style.transform = 'translateY(10px)';
                                setTimeout(() => { window.isFilterFadingIn = true; render(); }, 150);
                            } else {
                                window.isFilterFadingIn = true;
                                render();
                            }
                        };
                        
                        pill.innerHTML = `<span style="font-size:14px;">${emojiMap[svc] || '🔧'}</span> <span style="margin-left:4px; font-weight:500; font-size:11px;">${svc}</span> <span style="margin-left:6px; font-weight:700; opacity:0.8;">${counts[svc]}</span>`;
                        serviceSummaryEl.appendChild(pill);
                    }
                });
                
                listContainer.insertBefore(serviceSummaryEl, cardListEl);
            }
        };

        const staticSvgCH = `<svg data-tracker-type="clientHappiness" width="22" height="22" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); margin-top:2px;">
            <circle cx="12" cy="12" r="10" fill="#FFCA28" stroke="#F57F17" stroke-width="1.5"></circle>
            <circle cx="8.5" cy="9" r="1.5" fill="#4E342E"></circle>
            <circle cx="15.5" cy="9" r="1.5" fill="#4E342E"></circle>
            <path d="M7 13.5 Q12 18.5 17 13.5" fill="none" stroke="#4E342E" stroke-width="2" stroke-linecap="round"></path>
        </svg>`;

        const staticSvgMS = `<svg data-tracker-type="moneySmelling" width="22" height="22" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); margin-top:2px;">
            <circle cx="12" cy="12" r="10" fill="#2E7D32" stroke="#1B5E20" stroke-width="1.5"/>
            <g transform="translate(2.4, 2.4) scale(0.8)">
                <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" fill="#FFFFFF"/>
            </g>
        </svg>`;

        renderTrackerStats('moneySmelling', l => l.isMoneySmelling, staticSvgMS, 'application/x-transfer-ms');
        renderTrackerStats('clientHappiness', l => l.isClientHappiness, staticSvgCH, 'application/x-transfer-ch');

        const isAdsTrackerNode = list.trackerType === 'ads';
        const isTrelloTrackerNode = (list.trelloListId || list.trelloTasksListId || list.trelloBoardId) && list.trackerType !== 'ads' && !list.isClientHappiness && !list.isMoneySmelling;

        if (hasOutgoing || isAdsTrackerNode || isTrelloTrackerNode) {
            const summaryEl = document.createElement('div');
            summaryEl.className = 'downstream-trackers-summary';
            summaryEl.style.display = 'flex';
            summaryEl.style.width = 'fit-content';
            summaryEl.style.alignSelf = 'flex-start';
            summaryEl.style.flexShrink = '0';
            summaryEl.style.margin = '16px 20px 10px 20px';
            
            listContainer.insertBefore(summaryEl, cardListEl);
        }

        const hideCardsBtn = document.createElement('button');
        hideCardsBtn.className = 'add-card-btn';
        hideCardsBtn.style.margin = '4px 12px 0 12px';
        hideCardsBtn.style.width = 'calc(100% - 24px)';
        hideCardsBtn.style.display = 'flex';
        hideCardsBtn.style.justifyContent = 'flex-start';
        hideCardsBtn.style.alignItems = 'center';
        hideCardsBtn.style.backgroundColor = 'transparent';
        hideCardsBtn.style.color = '#5e6c84';
        hideCardsBtn.style.fontWeight = '500';
        hideCardsBtn.style.fontSize = '14px';
        hideCardsBtn.style.padding = '8px 10px';
        hideCardsBtn.style.borderRadius = '8px';
        hideCardsBtn.style.transition = 'background-color 0.2s ease, color 0.2s ease';
        hideCardsBtn.onmouseover = () => { hideCardsBtn.style.backgroundColor = '#091e4214'; hideCardsBtn.style.color = '#172b4d'; };
        hideCardsBtn.onmouseout = () => { hideCardsBtn.style.backgroundColor = 'transparent'; hideCardsBtn.style.color = '#5e6c84'; };

        hideCardsBtn.innerHTML = list.collapsed 
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M6 9l6 6 6-6"></path></svg> Show Cards (${list.cards.length})` 
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M18 15l-6-6-6 6"></path></svg> Hide Cards (${list.cards.length})`;

        if(hideCardsBtn) hideCardsBtn.onclick = (e) => {
            e.stopPropagation();
            list.collapsed = !list.collapsed;
            saveState();
            
            if (list.collapsed) listContainer.classList.add('list-collapsed');
            else listContainer.classList.remove('list-collapsed');

            hideCardsBtn.innerHTML = list.collapsed 
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M6 9l6 6 6-6"></path></svg> Show Cards (${list.cards.length})` 
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M18 15l-6-6-6 6"></path></svg> Hide Cards (${list.cards.length})`;

            const start = performance.now();
            const animateConnections = (time) => {
                if (typeof updateConnections === 'function') updateConnections();
                if (time - start < 450) requestAnimationFrame(animateConnections);
            };
            requestAnimationFrame(animateConnections);
        };

        if (list.cards.length > 0 && !list.trelloTasksListId && list.trackerType !== 'ads' && !list.pipedriveStageId) {
            listContainer.insertBefore(hideCardsBtn, cardListEl);
        }

        // Strictly ensure pinned cards render natively BELOW all emoji badges and summary elements
        if (pinnedListEl.hasChildNodes()) {
            listContainer.insertBefore(pinnedListEl, cardListEl);
        }

        // --- Trackpad Hardware Acceleration Bypass with Smooth Physics ---
        // By manually intercepting hardware wheel deltas and wrapping them in a high-fidelity 
        // physics interpolation loop (Lerp), we mathematically simulate native MacOS momentum 
        // elasticity directly within the Javascript thread.
        const hardwareScrollBypass = (e) => {
            if (!e.ctrlKey && !e.metaKey) {
                const target = e.currentTarget;
                if (target.scrollHeight > target.clientHeight) {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    if (target.targetScrollTop === undefined) {
                        target.targetScrollTop = target.scrollTop;
                    }
                    
                    // Accumulate target destination based on hardware output
                    target.targetScrollTop += e.deltaY;
                    
                    // Strictly clamp the destination matrix to physical DOM boundaries
                    const maxScroll = target.scrollHeight - target.clientHeight;
                    target.targetScrollTop = Math.max(0, Math.min(target.targetScrollTop, maxScroll));
                    
                    if (!target.isSmoothScrolling) {
                        target.isSmoothScrolling = true;
                        
                        const easeRenderLoop = () => {
                            const diff = target.targetScrollTop - target.scrollTop;
                            if (Math.abs(diff) > 0.1) {
                                // Linear interpolate (lerp) 8% for maximum elasticity and buttery drag
                                target.scrollTop += diff * 0.08;
                                requestAnimationFrame(easeRenderLoop);
                            } else {
                                target.scrollTop = target.targetScrollTop;
                                target.isSmoothScrolling = false;
                            }
                        };
                        requestAnimationFrame(easeRenderLoop);
                    }
                }
            }
        };
        cardListEl.addEventListener('wheel', hardwareScrollBypass, { passive: false });
        pinnedListEl.addEventListener('wheel', hardwareScrollBypass, { passive: false });

        canvasContent.appendChild(listContainer);

        if (!list.trelloListId || list.trelloListId) { // Essentially just always true now, but retaining structure
            const sortableConfig = {
                group: 'kanban-cards',
                filter: '.add-card-btn',
                preventOnFilter: false,
                animation: 150,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                direction: 'vertical',
                revertOnSpill: true,
                delay: 50,
                delayOnTouchOnly: true,
                scroll: true,
                scrollSensitivity: 85, // Begin scrolling 85px away from edge 
                scrollSpeed: 20,       // Scroll twice as fast consistently
                bubbleScroll: true,
                scrollSensitivity: 80,
                scrollSpeed: 20,
                bubbleScroll: true,
                onStart: function(evt) {
                    isGlobalDragging = true;
                },
                onEnd: function (evt) {
                    isGlobalDragging = false;
                    const fromId = evt.from.dataset.listId;
                    const toId = evt.to.dataset.listId;
                    if (!fromId || !toId) return;

                    const fromList = activeBoard.lists.find(l => l.id === fromId);
                    const toList = activeBoard.lists.find(l => l.id === toId);

                    const movedId = evt.item.dataset.cardId;
                    const movedItem = fromList.cards.find(c => String(c.id) === String(movedId));
                    if (!movedItem) return;

                    if (evt.to.classList.contains('pinned-list')) {
                        movedItem.isPinned = true;
                    } else if (evt.to.classList.contains('card-list')) {
                        movedItem.isPinned = false;
                    }

                    if (fromId !== toId) {
                        fromList.cards = fromList.cards.filter(c => String(c.id) !== String(movedId));
                        toList.cards.push(movedItem);
                        
                        const fromListEl = document.querySelector(`.kanban-list[data-id="${fromId}"]`);
                        const fromPinned = fromListEl.querySelector('.pinned-list') ? Array.from(fromListEl.querySelector('.pinned-list').children) : [];
                        const fromNormal = fromListEl.querySelector('.card-list') ? Array.from(fromListEl.querySelector('.card-list').children) : [];
                        const fromDomCards = [...fromPinned, ...fromNormal].filter(el => el.classList && el.classList.contains('card'));
                        const fromOrdered = fromDomCards.map(el => el.dataset.cardId);
                        fromList.cards.sort((a,b) => fromOrdered.indexOf(String(a.id)) - fromOrdered.indexOf(String(b.id)));
                    }

                    const toListEl = document.querySelector(`.kanban-list[data-id="${toId}"]`);
                    const toPinned = toListEl.querySelector('.pinned-list') ? Array.from(toListEl.querySelector('.pinned-list').children) : [];
                    const toNormal = toListEl.querySelector('.card-list') ? Array.from(toListEl.querySelector('.card-list').children) : [];
                    const toDomCards = [...toPinned, ...toNormal].filter(el => el.classList && el.classList.contains('card'));
                    const toOrdered = toDomCards.map(el => el.dataset.cardId);
                    toList.cards.sort((a,b) => toOrdered.indexOf(String(a.id)) - toOrdered.indexOf(String(b.id)));
                    
                    saveState();
                    
                    // Render locally ONLY to immediately sync the CSS pin statuses flawlessly back into the UI
                    render();
                    
                    const isTrelloCard = movedItem.isTrelloTask || movedItem.isTrello;
                    if (isTrelloCard) {
                        const trelloKey = localStorage.getItem('trelloKey');
                        const trelloToken = localStorage.getItem('trelloToken');
                        
                        const newJsIndex = toList.cards.findIndex(c => String(c.id) === String(movedItem.id));
                        
                        let prevTrelloCard = toList.cards.slice(0, newJsIndex).reverse().find(c => c.pos !== undefined);
                        let nextTrelloCard = toList.cards.slice(newJsIndex + 1).find(c => c.pos !== undefined);
                        
                        let newPos = 'bottom';
                        if (!prevTrelloCard && !nextTrelloCard) {
                            newPos = 'bottom';
                        } else if (!prevTrelloCard) {
                            newPos = 'top';
                        } else if (!nextTrelloCard) {
                            newPos = 'bottom';
                        } else {
                            newPos = (prevTrelloCard.pos + nextTrelloCard.pos) / 2;
                        }
                        
                        let url = `https://api.trello.com/1/cards/${movedItem.id}?pos=${newPos}&key=${trelloKey}&token=${trelloToken}`;
                        
                        const targetTrelloListId = toList.trelloListId || toList.trelloTasksListId;
                        if (fromId !== toId && targetTrelloListId) {
                            url += `&idList=${targetTrelloListId}`;
                        } else if (fromId !== toId && !targetTrelloListId) {
                            fetch(`https://api.trello.com/1/cards/${movedItem.id}?key=${trelloKey}&token=${trelloToken}`, {
                                method: 'DELETE'
                            }).then(res => {
                                if (res.ok) {
                                    showToast("Card deleted from Trello and converted to local!");
                                    movedItem.isTrello = false;
                                    movedItem.isTrelloTask = false;
                                    movedItem.id = 'loc_' + Date.now().toString();
                                    saveState();
                                    render();
                                }
                            }).catch(e => console.error("Trello API Delete Error", e));
                            
                            if (fromId !== toId) render();
                            return; 
                        }
                        
                        fetch(url, { method: 'PUT' }).then(res => {
                            if (!res.ok) throw new Error("Pos Update Failed");
                            
                            // Immediately override pos property locally to prevent bouncing if dragged again quickly
                            movedItem.pos = (newPos === 'top') ? ((nextTrelloCard ? nextTrelloCard.pos : 1000) / 2) : 
                                            (newPos === 'bottom') ? ((prevTrelloCard ? prevTrelloCard.pos : 0) + 1024) : newPos; 
                                            
                            showToast("Card reordered in Trello!");
                        }).catch(e => console.error("Trello API Order Update Error", e));
                    } else if (!isTrelloCard && fromId !== toId) {
                        const targetTrelloListId = toList.trelloListId || toList.trelloTasksListId;
                        if (targetTrelloListId) {
                            const trelloKey = localStorage.getItem('trelloKey');
                            const trelloToken = localStorage.getItem('trelloToken');
                            
                            const newPos = 'bottom';
                            const createUrl = `https://api.trello.com/1/cards?idList=${targetTrelloListId}&name=${encodeURIComponent(movedItem.title)}&pos=${newPos}&key=${trelloKey}&token=${trelloToken}`;
                            
                            fetch(createUrl, { method: 'POST' }).then(res => res.json()).then(newCard => {
                                movedItem.id = newCard.id;
                                if (toList.trelloTasksListId) {
                                    movedItem.isTrelloTask = true;
                                } else {
                                    movedItem.isTrello = true;
                                }
                                
                                showToast("Card successfully synced to Trello!");
                                saveState();
                                render(); 
                            }).catch(e => {
                                showToast("Failed to create card in Trello!");
                                console.error(e);
                            });
                        }
                    }
                    
                    if (fromId !== toId) {
                        if (movedItem.isPipedrive && toList.pipedriveStageId && pipedriveDomain && pipedriveToken) {
                            const realDealId = String(movedItem.id).replace('pd_', '');
                            const newStageId = toList.pipedriveStageId;
                            
                            fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${realDealId}?api_token=${pipedriveToken}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ stage_id: newStageId })
                            }).catch(err => console.error("Pipedrive Drag Sync Failed:", err));
                        }
                        render();
                    }
                }
            };
            
            new Sortable(cardListEl, sortableConfig);
            if (pinnedListEl) new Sortable(pinnedListEl, sortableConfig);
        }
    });

    const addListBtn = document.createElement('button');
    addListBtn.className = 'kanban-add-list-btn';
    addListBtn.innerHTML = `+ Add another list`;
    if(addListBtn) addListBtn.onclick = () => {
        const rect = canvas.getBoundingClientRect();
        const screenCenterX = window.innerWidth / 2;
        const screenCenterY = window.innerHeight / 2;
        
        let nx = ((screenCenterX - rect.left) - activeBoard.camera.x) / activeBoard.camera.z - 160;
        let ny = ((screenCenterY - rect.top) - activeBoard.camera.y) / activeBoard.camera.z - 100;
        
        const len = activeBoard.lists.length;
        if (len > 0) {
            nx += (len % 6) * 30;
            ny += (len % 6) * 30;
        }

        const newListId = 'list-' + Date.now();
        activeBoard.lists.push({ 
            id: newListId, 
            title: "New List", 
            cards: [], 
            x: nx, 
            y: ny 
        });
        saveState();
        render();

        setTimeout(() => {
            const newListEl = document.querySelector(`.kanban-list[data-id="${newListId}"]`);
            if (newListEl) {
                const titleEl = newListEl.querySelector('.editable-board-title');
                if (titleEl) titleEl.click();
            }
        }, 50);
    };
    canvas.appendChild(addListBtn);
    appContainer.appendChild(canvas);

    if (typeof animatingOutIds !== 'undefined' && animatingOutIds.size > 0) {
        const ids = Array.from(animatingOutIds);
        animatingOutIds.clear();

        void canvasContent.offsetWidth; 

        ids.forEach(tid => {
            const el = document.querySelector(`.kanban-list[data-id="${tid}"]`);
            if (el) {
                const pConn = activeBoard.connections && activeBoard.connections.find(c => c.target === tid);
                if (pConn && typeof animatingOrigins !== 'undefined') {
                    const cacheKey = pConn.source + '-' + (pConn.sourcePort || 'right');
                    const cachedPort = animatingOrigins[cacheKey];
                    if (cachedPort) {
                        el.style.transition = 'none';
                        el.style.left = `${cachedPort.px - (el.offsetWidth / 2)}px`;
                        el.style.top = `${cachedPort.py - (el.offsetHeight / 2)}px`;
                    }
                }
            }
        });

        void canvasContent.offsetWidth;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                ids.forEach(tid => {
                    const el = document.querySelector(`.kanban-list[data-id="${tid}"]`);
                    if (el) {
                        el.style.transition = '';
                        el.classList.remove('hidden-list');
                        const listData = activeBoard.lists.find(l => l.id === tid);
                        if (listData) {
                            el.style.left = `${listData.x}px`;
                            el.style.top = `${listData.y}px`;
                        }
                    }
                });
                
                setTimeout(() => updateConnections(), 360);
            });
        });
    }

    updateAllTrackersSummaries(activeBoard);

    const rootBoardHeader = document.createElement('div');
    rootBoardHeader.style.position = 'fixed';
    rootBoardHeader.style.top = '16px';
    rootBoardHeader.style.left = '40px';
    rootBoardHeader.style.display = 'flex';
    rootBoardHeader.style.alignItems = 'center';
    rootBoardHeader.style.gap = '16px';
    rootBoardHeader.style.zIndex = '100';

    const boardTitleEl = document.createElement('h2');
    boardTitleEl.textContent = activeBoard.title;
    boardTitleEl.className = 'editable-board-title';
    boardTitleEl.style.color = 'white';
    boardTitleEl.style.margin = '0';
    boardTitleEl.style.fontSize = '24px';
    boardTitleEl.title = 'Click to rename Workspace';
    
    if(boardTitleEl) boardTitleEl.onclick = (e) => {
        boardTitleEl.contentEditable = 'true';
        boardTitleEl.classList.add('editing');
        boardTitleEl.focus();
        
        if (document.caretRangeFromPoint) {
            const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (caret) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(caret);
            }
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos) {
                const sel = window.getSelection();
                sel.collapse(pos.offsetNode, pos.offset);
            }
        }
    };
    
    boardTitleEl.onblur = () => {
        boardTitleEl.contentEditable = 'false';
        boardTitleEl.classList.remove('editing');
        const newTitle = boardTitleEl.textContent.trim();
        if (newTitle && newTitle !== activeBoard.title) {
            activeBoard.title = newTitle;
            saveState();
            render();
            showToast("Workspace renamed!");
        } else {
            boardTitleEl.textContent = activeBoard.title;
        }
    };
    
    boardTitleEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            boardTitleEl.blur();
        }
    };
    
    const trelloSettingsBtn = document.createElement('button');
    trelloSettingsBtn.className = 'nav-btn-outline';
    trelloSettingsBtn.style.padding = '4px 8px';
    trelloSettingsBtn.style.fontSize = '12px';
    trelloSettingsBtn.style.marginLeft = '16px';
    trelloSettingsBtn.innerHTML = activeBoard.trelloBoardId ? 
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> Trello Link: On` : 
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> Link Trello`;
    if(trelloSettingsBtn) trelloSettingsBtn.onclick = openTrelloSettingsModal;
    
    const pipedriveSettingsBtn = document.createElement('button');
    pipedriveSettingsBtn.className = 'nav-btn-outline';
    pipedriveSettingsBtn.style.padding = '4px 8px';
    pipedriveSettingsBtn.style.fontSize = '12px';
    pipedriveSettingsBtn.style.marginLeft = '8px';
    pipedriveSettingsBtn.innerHTML = activeBoard.pipedrivePipelineId ? 
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg> Pipedrive Link: On` :
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg> Link Pipedrive`;
    if(pipedriveSettingsBtn) pipedriveSettingsBtn.onclick = openPipedriveSettingsModal;
    
    const rootDelBtn = document.createElement('button');
    rootDelBtn.className = 'icon-btn';
    rootDelBtn.style.padding = '4px 8px';
    rootDelBtn.style.fontSize = '12px';
    rootDelBtn.style.color = 'rgba(255, 255, 255, 0.7)';
    rootDelBtn.style.border = '1px solid rgba(255, 255, 255, 0.3)';
    rootDelBtn.style.borderRadius = '4px';
    rootDelBtn.style.background = 'transparent';
    rootDelBtn.style.marginLeft = 'auto'; // push delete to right
    rootDelBtn.innerHTML = 'Delete Workspace';
    if(rootDelBtn) rootDelBtn.onclick = () => deleteBoard(activeBoard.id);
    
    rootBoardHeader.appendChild(boardTitleEl);
    rootBoardHeader.appendChild(trelloSettingsBtn);
    rootBoardHeader.appendChild(pipedriveSettingsBtn);
    rootBoardHeader.appendChild(rootDelBtn);
    appContainer.appendChild(rootBoardHeader);

    // Restore scroll positions for lists after layout calculation
    requestAnimationFrame(() => {
        document.querySelectorAll('.kanban-list').forEach(listEl => {
            const id = listEl.dataset.id;
            const cardList = listEl.querySelector('.card-list');
            if (id && cardList && window.listScrolls && window.listScrolls[id] !== undefined) {
                cardList.scrollTop = window.listScrolls[id];
            }
        });
        updateConnections();
    });
}



function renderTimerApp(activeBoard) {
    document.body.style.background = '';
    appContainer.style.padding = '';
    let savedScrollPos = 0;
    const existingList = document.getElementById('ui-card-list');
    if (existingList) savedScrollPos = existingList.scrollTop;

    const listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    
    const header = document.createElement('div');
    header.className = 'list-header';
    
    const titleH2 = document.createElement('h2');
    titleH2.textContent = activeBoard.title;
    titleH2.className = 'editable-board-title';
    titleH2.title = 'Click to rename';
    
    if(titleH2) titleH2.onclick = (e) => {
        titleH2.contentEditable = 'true';
        titleH2.classList.add('editing');
        titleH2.focus();
        
        if (document.caretRangeFromPoint) {
            const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (caret) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(caret);
            }
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos) {
                const sel = window.getSelection();
                sel.collapse(pos.offsetNode, pos.offset);
            }
        }
    };
    
    titleH2.onblur = () => {
        titleH2.contentEditable = 'false';
        titleH2.classList.remove('editing');
        const newTitle = titleH2.textContent.trim();
        if (newTitle && newTitle !== activeBoard.title) {
            activeBoard.title = newTitle;
            saveState();
            render();
            showToast("Board renamed!");
        } else {
            titleH2.textContent = activeBoard.title;
        }
    };
    
    titleH2.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            titleH2.blur();
        }
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn';
    if(deleteBtn) deleteBtn.onclick = () => deleteBoard(activeBoard.id);
    deleteBtn.title = 'Delete Board';
    deleteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

    header.appendChild(titleH2);
    header.appendChild(deleteBtn);
    listContainer.appendChild(header);

    const cardListEl = document.createElement('div');
    cardListEl.className = 'card-list';
    cardListEl.id = `ui-card-list`;

    activeBoard.cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        if(cardEl) cardEl.onclick = () => openTimerModal(card.id, null);

        const titleEl = document.createElement('div');
        titleEl.className = 'card-title';
        titleEl.textContent = card.title;
        cardEl.appendChild(titleEl);

        if (card.dueDate) {
            const badgesEl = document.createElement('div');
            badgesEl.className = 'card-badges';

            const due = new Date(card.dueDate);
            const now = new Date();
            const diffMs = due - now;

            if (diffMs > 0) {
                const dateBadge = document.createElement('div');
                dateBadge.className = 'badge badge-date';
                dateBadge.innerHTML = `${clockIcon} ${due.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;
                badgesEl.appendChild(dateBadge);
            }

            const timerBadge = document.createElement('div');
            timerBadge.className = 'badge badge-timer';
            let timerHtml = `${stopwatchIcon} `;
            
            if (diffMs <= 0) {
                timerBadge.classList.add('overdue');
                timerHtml += 'Overdue';
            } else {
                const totalMins = Math.floor(diffMs / 60000);
                const d = Math.floor(totalMins / 1440);
                const h = Math.floor((totalMins % 1440) / 60);
                const m = totalMins % 60;

                if (d < 1) timerBadge.classList.add('urgent');

                let timeLeft = '';
                if (d > 0) timeLeft += `${d}d `;
                if (h > 0 || d > 0) timeLeft += `${h}h `;
                timeLeft += `${m}m`;
                timerHtml += timeLeft.trim();
            }

            timerBadge.innerHTML = timerHtml;
            badgesEl.appendChild(timerBadge);
            cardEl.appendChild(badgesEl);
        }
        cardListEl.appendChild(cardEl);
    });

    listContainer.appendChild(cardListEl);

    let scrollRAF = null;
    let lastScrollY = 0;
    if(listContainer) listContainer.addEventListener('dragover', (e) => {
        const rect = listContainer.getBoundingClientRect();
        let dist = 0;
        if (e.clientY < rect.top + 100) dist = -15;
        else if (e.clientY > rect.bottom - 100) dist = 15;
        
        if (dist !== 0) {
            lastScrollY = dist;
            if (!scrollRAF) {
                const doScroll = () => {
                    if (lastScrollY !== 0) {
                        cardListEl.scrollTop += lastScrollY;
                        scrollRAF = requestAnimationFrame(doScroll);
                    } else {
                        scrollRAF = null;
                    }
                };
                scrollRAF = requestAnimationFrame(doScroll);
            }
        } else {
            lastScrollY = 0;
        }
    });
    if(listContainer) listContainer.addEventListener('dragleave', () => lastScrollY = 0);
    if(listContainer) listContainer.addEventListener('drop', () => lastScrollY = 0);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.innerHTML = `
            <span style="display:flex; align-items:center; gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                Add a card
            </span>
        `;

    if(addBtn) addBtn.onclick = () => {
        newCardTitle.value = '';
        if (newCardDays) newCardDays.value = 0;
        if (newCardHours) newCardHours.value = 0;
        if (newCardMins) newCardMins.value = 0;
        
        const addCardTimerSection = document.getElementById('addCardTimerSection');
        if (addCardTimerSection) addCardTimerSection.style.display = 'block';
        
        const modalTitle = document.querySelector('#addCardModal h3');
        const modalLabel = document.querySelector('#addCardModal label');
        const addConfirmBtn = document.getElementById('confirmAddBtn');
        
        if (modalTitle) modalTitle.textContent = 'Add New Account';
        if (modalLabel) modalLabel.textContent = 'Account Email';
        if (newCardTitle) newCardTitle.placeholder = 'e.g. name123@gmail.com';
        if (addConfirmBtn) addConfirmBtn.textContent = 'Add Account';

        addCardModal.classList.add('active');
        setTimeout(() => newCardTitle.focus(), 50);
    };
    listContainer.appendChild(addBtn);

    appContainer.appendChild(listContainer);

    if (savedScrollPos > 0) {
        cardListEl.scrollTop = savedScrollPos;
    }

    new Sortable(cardListEl, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        direction: 'vertical',
        revertOnSpill: true,
        delay: 50,
        delayOnTouchOnly: true,
        scroll: true,
        scrollSensitivity: 80,
        scrollSpeed: 20,
        bubbleScroll: true,
        onStart: function(evt) {
            isGlobalDragging = true;
        },
        onEnd: function (evt) {
            isGlobalDragging = false;
            if (evt.oldIndex !== evt.newIndex) {
                const [movedItem] = activeBoard.cards.splice(evt.oldIndex, 1);
                activeBoard.cards.splice(evt.newIndex, 0, movedItem);
                saveState();
            }
        }
    });

    const hasAnyFilter = (activeBoard.happinessFilters && Object.keys(activeBoard.happinessFilters).some(k => activeBoard.happinessFilters[k])) || 
                         (activeBoard.serviceFilters && Object.keys(activeBoard.serviceFilters).some(k => activeBoard.serviceFilters[k]));
                         
    if (hasAnyFilter) {
        const btnText = 'Clear Filter';
        const clearBtn = document.createElement('button');
        clearBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> ${btnText}`;
        clearBtn.style.position = 'fixed';
        clearBtn.style.top = '80px';
        clearBtn.style.left = '50%';
        clearBtn.style.transform = 'translateX(-50%)';
        clearBtn.style.zIndex = '9999';
        clearBtn.style.padding = '12px 24px';
        clearBtn.style.background = '#0c66e4';
        clearBtn.style.color = 'white';
        clearBtn.style.border = 'none';
        clearBtn.style.borderRadius = '24px';
        clearBtn.style.boxShadow = '0 8px 16px rgba(12, 102, 228, 0.3)';
        clearBtn.style.fontWeight = '600';
        clearBtn.style.fontSize = '14px';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.display = 'flex';
        clearBtn.style.alignItems = 'center';
        clearBtn.style.gap = '8px';
        clearBtn.style.transition = 'all 0.2s';
        
        clearBtn.onmouseenter = () => clearBtn.style.background = '#0052cc';
        clearBtn.onmouseleave = () => clearBtn.style.background = '#0c66e4';
        
        if(clearBtn) clearBtn.onclick = () => {
            activeBoard.happinessFilters = {};
            activeBoard.serviceFilters = {};
            saveState();
            render();
        };
        appContainer.appendChild(clearBtn);
    }
}

// Add Card Flow
if(closeAddModal) closeAddModal.onclick = () => addCardModal.classList.remove('active');

const modalLinkAccountsBtn = document.getElementById('modalLinkAccountsBtn');
if (modalLinkAccountsBtn) {
    if(modalLinkAccountsBtn) modalLinkAccountsBtn.onclick = () => {
        const popup = document.getElementById('createPostModal');
        if (popup) popup.classList.remove('active');
        window.activeSocialTab = 'accounts';
        const activeBoard = boards.find(b => b.id === activeBoardId);
        if (activeBoard) renderSocialSchedulerApp(activeBoard);
    };
}
if(confirmAddBtn) confirmAddBtn.onclick = async () => {
    const title = newCardTitle.value.trim();
    if (title) {
        const activeBoard = boards.find(b => b.id === activeBoardId);
        
        if (activeBoard.type === 'kanban') {
            const list = activeBoard.lists.find(l => l.id === activeTargetListId);
            
            if (list.trelloTasksListId) {
                const trelloKey = localStorage.getItem('trelloKey');
                const trelloToken = localStorage.getItem('trelloToken');
                if (!trelloKey || !trelloToken) {
                    showToast("Trello credentials missing!");
                    return;
                }
                
                confirmAddBtn.textContent = 'Adding...';
                confirmAddBtn.disabled = true;
                
                try {
                    const res = await fetch(`https://api.trello.com/1/cards?idList=${list.trelloTasksListId}&name=${encodeURIComponent(title)}&key=${trelloKey}&token=${trelloToken}`, {
                        method: 'POST'
                    });
                    if (!res.ok) throw new Error("Failed to create Trello card");
                    
                    const newTrelloCard = await res.json();
                    
                    if (!list.cards) list.cards = [];
                    list.cards.push({
                        id: newTrelloCard.id,
                        title: title,
                        pos: newTrelloCard.pos,
                        color: 'default',
                        isTrelloTask: true
                    });
                    
                    showToast("Task created in Trello!");
                    
                    window.expandedTrelloLists = window.expandedTrelloLists || new Set();
                    window.expandedTrelloLists.add(list.id);
                    
                    saveState();
                    if (document.activeElement) document.activeElement.blur();
                    render();
                    addCardModal.classList.remove('active');
                } catch(e) {
                    console.error("Error creating task:", e);
                    showToast("Failed to create task.");
                } finally {
                    confirmAddBtn.textContent = 'Add Task';
                    confirmAddBtn.disabled = false;
                }
                
                return; // Stop here and prevent default local saving behavior since we handled it
            } else if (list.pipedriveStageId) {
                if (!pipedriveDomain || !pipedriveToken) {
                    showToast("Pipedrive credentials missing!");
                    return;
                }
                
                confirmAddBtn.textContent = 'Adding...';
                confirmAddBtn.disabled = true;
                
                try {
                    const pipedriveExtras = document.getElementById('pipedriveExtras');
                    let dealValue = '';
                    let waLink = '';
                    let noteContent = '';
                    if (pipedriveExtras && pipedriveExtras.style.display !== 'none') {
                        const valInput = document.getElementById('newDealValue');
                        const waInput = document.getElementById('newDealWaLink');
                        const noteInput = document.getElementById('newDealNote');
                        if (valInput) dealValue = valInput.value.trim();
                        if (waInput && waInput.value.trim()) {
                            let rawWa = waInput.value.trim();
                            if (rawWa.indexOf('http') === -1 && rawWa.indexOf('wa.me') === -1) {
                                let cWa = rawWa.replace(/\D/g, '');
                                if (cWa.startsWith('05')) cWa = '966' + cWa.substring(1);
                                else if (!cWa.startsWith('96')) {
                                    if (cWa.startsWith('0')) cWa = cWa.substring(1);
                                    cWa = '966' + cWa;
                                }
                                waLink = `https://wa.me/+${cWa}`;
                            } else {
                                waLink = rawWa;
                            }
                        }
                        if (noteInput) noteContent = noteInput.value.trim();
                    }

                    let personId = null;
                    const contactName = title;
                    if (contactName) {
                        const personRes = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/persons?api_token=${pipedriveToken}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: contactName })
                        });
                        if (personRes.ok) {
                            const personData = await personRes.json();
                            if (personData && personData.data) personId = personData.data.id;
                        }
                    }

                    let waFieldKey = activeBoard.pipedriveWhatsappField || null;
                    let noteFieldKey = null;

                    if (waLink || noteContent) {
                        try {
                            const fieldsRes = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/dealFields?api_token=${pipedriveToken}`);
                            if (fieldsRes.ok) {
                                const fPayload = await fieldsRes.json();
                                const fields = fPayload.data || [];
                                
                                if (!waFieldKey && waLink) {
                                    const waField = fields.find(f => f.name.toLowerCase().includes('wa link') || f.name.toLowerCase().includes('whatsapp'));
                                    if (waField) waFieldKey = waField.key;
                                }
                                
                                if (noteContent) {
                                    const nf = fields.find(f => f.name.toLowerCase() === 'note' || f.name.toLowerCase() === 'notes');
                                    if (nf) noteFieldKey = nf.key;
                                }
                            }
                        } catch(e) { console.warn("Could not fetch deal fields", e); }
                    }

                    const payload = {
                        title: title,
                        stage_id: list.pipedriveStageId,
                        status: 'open'
                    };
                    if (dealValue) payload.value = parseFloat(dealValue);
                    if (personId) payload.person_id = personId;
                    if (waFieldKey && waLink) payload[waFieldKey] = waLink;
                    if (noteFieldKey && noteContent) payload[noteFieldKey] = noteContent;

                    const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals?api_token=${pipedriveToken}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (!res.ok) throw new Error("Failed to create Pipedrive deal");
                    
                    const pData = await res.json();
                    if (!pData || !pData.data) throw new Error("Invalid response from Pipedrive");
                    
                    const newDeal = pData.data;

                    if (noteContent && !noteFieldKey && newDeal && newDeal.id) {
                        try {
                            await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/notes?api_token=${pipedriveToken}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ deal_id: newDeal.id, content: noteContent })
                            });
                        } catch(e) { console.warn("Failed to add native note", e); }
                    }
                    
                    if (!list.cards) list.cards = [];
                    list.cards.push({
                        id: `pd_${newDeal.id}`,
                        title: newDeal.title,
                        rawTitle: newDeal.title,
                        actualValue: newDeal.value || 0,
                        pipedriveData: newDeal,
                        pos: 999999,
                        isPipedrive: true,
                        color: 'default'
                    });
                    
                    showToast("Deal created in Pipedrive!");
                    
                    saveState();
                    if (document.activeElement) document.activeElement.blur();
                    render();
                    addCardModal.classList.remove('active');
                } catch(e) {
                    console.error("Error creating deal:", e);
                    showToast("Failed to create deal.");
                } finally {
                    confirmAddBtn.textContent = 'Add Deal';
                    confirmAddBtn.disabled = false;
                }
                
                return;
            } else {
                const newLocalCard = { id: Date.now().toString(), title, dueDate: null };
                if (list.isNewClients) {
                    newLocalCard.serviceChecklist = [];
                }
                
                if (list.isMoneySmelling) {
                    const pipedriveExtras = document.getElementById('pipedriveExtras');
                    if (pipedriveExtras && pipedriveExtras.style.display !== 'none') {
                        const valInput = document.getElementById('newDealValue');
                        if (valInput && valInput.value.trim()) {
                            newLocalCard.dealValue = Number(valInput.value);
                        }
                    }
                }
                list.cards.push(newLocalCard);
            }
        } else {
            let dueDate = null;
            if (newCardDays && newCardHours && newCardMins) {
                const d = parseInt(newCardDays.value) || 0;
                const h = parseInt(newCardHours.value) || 0;
                const m = parseInt(newCardMins.value) || 0;
                if (d > 0 || h > 0 || m > 0) {
                    const ms = (d * 86400000) + (h * 3600000) + (m * 60000);
                    dueDate = new Date(Date.now() + ms).toISOString();
                }
            }
            activeBoard.cards.push({ id: Date.now().toString(), title, dueDate });
        }

        saveState();
        addCardModal.classList.remove('active');
        if (document.activeElement) {
            document.activeElement.blur();
        }
        render();
        showToast(activeBoard.type === 'kanban' ? "Card added!" : "Account added!");
    }
};
newCardTitle.onkeydown = (e) => { if (e.key === 'Enter') confirmAddBtn.click(); };

// Timers / Details Modal Flow
let deleteConfirmTimeout = null;

function openTimerModal(cardId, listId) {
    const activeBoard = boards.find(b => b.id === activeBoardId);
    let card = null;

    if (activeBoard.type === 'kanban') {
        const list = activeBoard.lists.find(l => l.id === listId);
        if (list) card = list.cards.find(c => c.id === cardId);
    } else {
        card = activeBoard.cards.find(c => c.id === cardId);
    }
    
    if (!card) return;
    
    activeCardId = cardId;
    activeTargetListId = listId;

    const servicesSection = document.getElementById('servicesSection');
    const servicesSectionTitle = document.getElementById('servicesSectionTitle');
    const servicesList = document.getElementById('servicesList');
    const servicesAddRow = document.getElementById('servicesAddRow');
    const servicesItemInput = document.getElementById('servicesItemInput');

    if (activeBoard.type === 'kanban') {
        modalTitle.textContent = 'Card Options';
        if (timerInputsSection) timerInputsSection.style.display = 'none';
        if (removeTimerBtn) removeTimerBtn.style.display = 'none';
        if (saveTimerBtn) saveTimerBtn.style.display = 'none';
        
        const list = activeBoard.lists.find(l => l.id === listId);
        
        if (list && list.isNewClients) {
            modalTitle.textContent = card.title || 'New Client';
            deleteCardBtn.textContent = 'Delete Client';
            deleteCardBtn.style.width = '100%';

            if (servicesSection) servicesSection.style.display = 'flex';
            if (servicesSectionTitle) servicesSectionTitle.textContent = 'Agreed Services Checklist';
            if (servicesAddRow) servicesAddRow.style.display = 'flex';
            if (servicesItemInput) servicesItemInput.value = '';

            renderCardChecklistEditor(card, {
                emptyText: ''
            });
        } else if (list && (list.isClientHappiness || list.isMoneySmelling)) {
            deleteCardBtn.textContent = 'Delete Client';
            deleteCardBtn.style.width = '100%';
            if (servicesSectionTitle) servicesSectionTitle.textContent = 'Provided Services';
            if (servicesAddRow) servicesAddRow.style.display = 'none';
            if (servicesItemInput) servicesItemInput.value = '';
            
            if (servicesSection && servicesList) {
                servicesSection.style.display = 'flex';
                servicesList.innerHTML = '';
                
                const availableServices = [
                    { name: 'Store', icon: '🛍️' },
                    { name: 'Paid Ads', icon: '🚀' },
                    { name: 'Social Media', icon: '📱' },
                    { name: 'SEO', icon: '🔎' },
                    { name: 'WA API', icon: '💬' },
                    { name: 'Website monitoring', icon: '⚡' },
                    { name: 'Marketplaces', icon: '🛒' }
                ];
                
                if (!card.services) card.services = [];
                
                availableServices.forEach(item => {
                    const svc = item.name;
                    
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '10px';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '15px';
                    label.style.fontWeight = '500';
                    label.style.color = 'var(--text-color)';
                    label.style.userSelect = 'none';
                    label.style.webkitUserSelect = 'none';
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = card.services.includes(svc);
                    cb.style.display = 'none'; // hide the native checkbox
                    
                    const fakeCb = document.createElement('div');
                    fakeCb.style.width = '20px';
                    fakeCb.style.height = '20px';
                    fakeCb.style.borderRadius = '5px';
                    fakeCb.style.border = '2px solid #dfe1e6';
                    fakeCb.style.display = 'flex';
                    fakeCb.style.alignItems = 'center';
                    fakeCb.style.justifyContent = 'center';
                    fakeCb.style.transition = 'all 0.15s ease-in-out';
                    
                    const updateFakeCb = (isChecked) => {
                        if (isChecked) {
                            fakeCb.style.backgroundColor = '#0c66e4';
                            fakeCb.style.borderColor = '#0c66e4';
                            fakeCb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                        } else {
                            fakeCb.style.backgroundColor = 'transparent';
                            fakeCb.style.borderColor = '#dfe1e6';
                            fakeCb.innerHTML = '';
                        }
                    };
                    
                    updateFakeCb(cb.checked);
                    
                    cb.onchange = (e) => {
                        updateFakeCb(e.target.checked);
                        if (e.target.checked) {
                            if (!card.services.includes(svc)) card.services.push(svc);
                        } else {
                            card.services = card.services.filter(s => s !== svc);
                        }
                        saveState();
                        render();
                    };
                    
                    label.appendChild(cb);
                    label.appendChild(fakeCb);
                    
                    if (item.icon) {
                        const iconSpan = document.createElement('span');
                        iconSpan.style.display = 'flex';
                        iconSpan.style.alignItems = 'center';
                        iconSpan.style.justifyContent = 'center';
                        iconSpan.style.fontSize = '18px';
                        iconSpan.innerHTML = item.icon;
                        label.appendChild(iconSpan);
                    }
                    
                    label.appendChild(document.createTextNode(svc));
                    servicesList.appendChild(label);
                });
            }
        } else {
            deleteCardBtn.textContent = 'Delete Card';
            deleteCardBtn.style.width = '100%';
            if (servicesSection) servicesSection.style.display = 'none';
            if (servicesAddRow) servicesAddRow.style.display = 'none';
            if (servicesItemInput) servicesItemInput.value = '';
        }
    } else {
        modalTitle.textContent = card.title;
        if (timerInputsSection) timerInputsSection.style.display = 'flex';
        if (removeTimerBtn) removeTimerBtn.style.display = 'inline-block';
        if (saveTimerBtn) saveTimerBtn.style.display = 'inline-block';
        deleteCardBtn.textContent = 'Delete Account';
        deleteCardBtn.style.width = 'auto';
        if (servicesAddRow) servicesAddRow.style.display = 'none';
        if (servicesItemInput) servicesItemInput.value = '';

        if (card.dueDate) {
            const diffMs = new Date(card.dueDate) - new Date();
            if (diffMs > 0) {
                const totalMins = Math.floor(diffMs / 60000);
                inputDays.value = Math.floor(totalMins / 1440);
                inputHours.value = Math.floor((totalMins % 1440) / 60);
                inputMins.value = totalMins % 60;
            } else {
                inputDays.value = 0;
                inputHours.value = 0;
                inputMins.value = 0;
            }
        } else {
            inputDays.value = 0;
            inputHours.value = 0;
            inputMins.value = 0;
        }
    }

    if (activeBoard.type !== 'kanban') {
        if (typeof servicesSection !== 'undefined' && servicesSection) {
            servicesSection.style.display = 'none';
        }
    }

    clearTimeout(deleteConfirmTimeout);
    deleteCardBtn.classList.remove('confirm-state');

    timerModal.classList.add('active');
    if (activeBoard.type !== 'kanban') setTimeout(() => { inputDays.focus(); }, 50);
}

let activeAdsCalcCardId = null;

function openAdsCalculatorModal(cardId) {
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard || activeBoard.type !== 'kanban') return;
    
    let targetCard = null;
    for (const list of activeBoard.lists) {
        const found = list.cards.find(c => c.id === cardId);
        if (found) {
            targetCard = found;
            break;
        }
    }
    if (!targetCard) return;
    
    activeAdsCalcCardId = cardId;
    
    const mTitle = document.getElementById('adsModalTitle');
    if (mTitle) {
        mTitle.innerText = `${targetCard.title || 'Task'} - Margin Calculator`;
        mTitle.title = `${targetCard.title || 'Task'} - Margin Calculator`;
    }
    
    const m = targetCard.adsMetrics || {};
    
    // Bind Inputs
    const iAOV = document.getElementById('calcAOV');
    const iFees = document.getElementById('calcFees');
    const iCOGS = document.getElementById('calcCOGS');
    const iTarget = document.getElementById('calcTarget');
    const iATC = document.getElementById('calcATC');
    const iCO = document.getElementById('calcCO');
    const iPUR = document.getElementById('calcPUR');

    // Initialize base inputs

    iAOV.value = m.calcAOV || 0;
    iFees.value = typeof m.calcFees !== 'undefined' ? m.calcFees : 1.5;
    iCOGS.value = m.calcCOGS || 0;
    iTarget.value = typeof m.calcTarget !== 'undefined' ? m.calcTarget : 20;
    iATC.value = typeof m.calcATC !== 'undefined' ? m.calcATC : 13.02;
    iCO.value = typeof m.calcCO !== 'undefined' ? m.calcCO : 9.26;
    iPUR.value = typeof m.calcPUR !== 'undefined' ? m.calcPUR : 6.37;

    const formatNum = (v) => parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const curSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" style="width: 1em; height: 1em; vertical-align: middle; margin-right: 4px;"><path fill="currentColor" d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"></path><path fill="currentColor" d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"></path></svg>`;

    const hydrateView = () => {
        const aov = parseFloat(iAOV.value) || 0;
        const fees = parseFloat(iFees.value) || 0;
        const cogs = parseFloat(iCOGS.value) || 0;
        const target = parseFloat(iTarget.value) || 0;
        
        let atcPct = parseFloat(iATC.value) || 0;
        let coPct = parseFloat(iCO.value) || 0;
        let purPct = parseFloat(iPUR.value) || 0;
        
        // Prevent div by zero
        if(atcPct <= 0) atcPct = 0.0001; else atcPct /= 100;
        if(coPct <= 0) coPct = 0.0001; else coPct /= 100;
        if(purPct <= 0) purPct = 0.0001; else purPct /= 100;

        // 1) Required Limits Math (Breakeven Requirements)
        const feesAmt = aov * (fees / 100);
        const targetAmt = aov * (target / 100);
        const beCPP = aov - cogs - feesAmt;
        
        const reqCPVC = beCPP * purPct;
        const reqCPATC = beCPP * (purPct / atcPct);
        const reqCPIC = beCPP * (purPct / coPct);
        const reqROAS = beCPP > 0 ? (aov / beCPP) : 0;
        const baselinePUR = aov > 0 ? (1 / aov) : 0;

        document.getElementById('outBeCPP').innerHTML = curSVG + formatNum(beCPP > 0 ? beCPP : 0);
        document.getElementById('outBeCPIC').innerHTML = curSVG + formatNum(reqCPIC > 0 ? reqCPIC : 0);
        document.getElementById('outBeCPATC').innerHTML = curSVG + formatNum(reqCPATC > 0 ? reqCPATC : 0);
        document.getElementById('outBeCPC').innerHTML = curSVG + formatNum(reqCPVC > 0 ? reqCPVC : 0);
        document.getElementById('outBeROAS').innerHTML = formatNum(reqROAS > 0 ? reqROAS : 0);

        const elBaselinePUR = document.getElementById('outBaselinePUR');
        if (elBaselinePUR) elBaselinePUR.innerText = formatNum(baselinePUR * 100) + '%';

        // 2) Profit Target Funnel Math
        const targetCPP = beCPP - targetAmt;
        const targetCPVC = targetCPP * purPct;
        const targetCPATC = targetCPP * (purPct / atcPct);
        const targetCPIC = targetCPP * (purPct / coPct);
        const targetROAS = targetCPP > 0 ? (aov / targetCPP) : 0;

        document.getElementById('outProjCPP').innerHTML = curSVG + formatNum(targetCPP > 0 ? targetCPP : 0);
        document.getElementById('outProjCPIC').innerHTML = curSVG + formatNum(targetCPIC > 0 ? targetCPIC : 0);
        document.getElementById('outProjCPATC').innerHTML = curSVG + formatNum(targetCPATC > 0 ? targetCPATC : 0);
        document.getElementById('outProjCPC').innerHTML = curSVG + formatNum(targetCPVC > 0 ? targetCPVC : 0);
        document.getElementById('outProjROAS').innerText = formatNum(targetROAS > 0 ? targetROAS : 0);
    };

    const attachEvt = (el, key) => {
        el.oninput = (e) => {
            if (!targetCard.adsMetrics) targetCard.adsMetrics = {};
            targetCard.adsMetrics[key] = parseFloat(e.target.value) || 0;
            saveState();
            hydrateView();
        };
    };

    attachEvt(iAOV, 'calcAOV');
    attachEvt(iFees, 'calcFees');
    attachEvt(iCOGS, 'calcCOGS');
    attachEvt(iTarget, 'calcTarget');
    attachEvt(iATC, 'calcATC');
    attachEvt(iCO, 'calcCO');
    attachEvt(iPUR, 'calcPUR');

    hydrateView();

    const modal = document.getElementById('adsCalculatorModal');
    modal.classList.add('active');
    
    document.getElementById('closeAdsCalculatorModalBtn').onclick = () => {
        modal.classList.remove('active');
    };
    if(modal) modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('active');
    };
}

let activePipedriveDealId = null;

function openPipedriveActionModal(cardId, listId) {
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard || activeBoard.type !== 'kanban') return;
    
    const list = activeBoard.lists.find(l => l.id === listId);
    if (!list) return;
    
    const card = list.cards.find(c => c.id === cardId);
    if (!card) return;
    
    // Bypass isPipedrive check entirely since we support MoneySmelling cards
    activePipedriveDealId = String(card.id).startsWith('pd_') ? String(card.id).replace('pd_', '') : String(card.id);
    window.activePipedriveCardId = card.id; // Store full card ID
    window.activePipedriveListId = list.id;
    
    const modal = document.getElementById('pipedriveActionModal');
    const titleEl = document.getElementById('pipedriveActionDealTitleInput');
    const lostReasonContainer = document.getElementById('pipedriveActionLostReasonContainer');
    const lostReasonInput = document.getElementById('pipedriveActionLostReasonInput');
    const primaryBtns = document.getElementById('pipedriveActionPrimaryBtns');
    const deleteBtn = document.getElementById('pipedriveActionDeleteBtn');
    const deleteBtnContainer = deleteBtn ? deleteBtn.parentElement : null;
    const deleteConfirmContainer = document.getElementById('pipedriveActionDeleteConfirmContainer');
    
    if (titleEl) titleEl.value = card.title;
    
    const noteContainer = document.getElementById('pipedriveActionNoteContainer');
    const noteInput = document.getElementById('pipedriveActionNoteInput');
    const noteStatus = document.getElementById('pipedriveActionNoteStatus');
    
    if (noteContainer) {
        if (card.isPipedrive && activeBoard.pipedriveNoteFieldKey) {
            noteContainer.style.display = 'block';
            if (noteInput) {
                noteInput.value = card.pipedriveData && card.pipedriveData[activeBoard.pipedriveNoteFieldKey] !== undefined ? card.pipedriveData[activeBoard.pipedriveNoteFieldKey] : '';
            }
            if (noteStatus) noteStatus.innerText = '';
        } else {
            noteContainer.style.display = 'none';
        }
    }
    
    const editValueInput = document.getElementById('pipedriveEditDealValueInput');
    if (editValueInput) {
        if (card.isPipedrive) {
            editValueInput.value = card.pipedriveData && card.pipedriveData.value !== undefined && card.pipedriveData.value !== null ? card.pipedriveData.value : '';
        } else {
            editValueInput.value = card.dealValue !== undefined && card.dealValue !== null ? card.dealValue : '';
        }
    }
    
    if (lostReasonContainer) lostReasonContainer.style.display = 'none';
    if (primaryBtns) primaryBtns.style.display = card.isPipedrive ? 'flex' : 'none'; // Hide Won/Lost for local cards
    if (lostReasonInput) lostReasonInput.value = '';
    
    if (deleteConfirmContainer) deleteConfirmContainer.style.display = 'none';
    if (deleteBtnContainer) deleteBtnContainer.style.display = 'flex';
    
    // Services Checklist Logic
    const servicesContainer = document.getElementById('localServicesChecklistContainer');
    const servicesItemsDiv = document.getElementById('servicesChecklistItems');
    const newServiceInput = document.getElementById('newServiceInput');
    const addNewServiceBtn = document.getElementById('addNewServiceBtn');
    
    if (servicesContainer && servicesItemsDiv) {
        // We will show it for both Pipedrive and Local cards to allow maximal flexibility, or you can restrict `card.isPipedrive`. Setup requires empty arrays if undefined.
        if (!card.services) {
            card.services = [];
        }
        
        const renderChecklist = () => {
            servicesItemsDiv.innerHTML = '';
            if (card.services.length === 0) {
                servicesItemsDiv.innerHTML = '<span style="font-size: 13px; color: #5e6c84; font-style: italic;">No services added yet. Add one below.</span>';
            } else {
                card.services.forEach((serviceObj, idx) => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.gap = '10px';
                    row.style.background = '#f4f5f7';
                    row.style.padding = '8px 12px';
                    row.style.borderRadius = '6px';
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = serviceObj.checked;
                    cb.style.width = '16px';
                    cb.style.height = '16px';
                    cb.style.cursor = 'pointer';
                    cb.onchange = () => {
                        card.services[idx].checked = cb.checked;
                        saveState();
                        render();
                    };
                    
                    const label = document.createElement('span');
                    label.style.flex = '1';
                    label.style.fontSize = '14px';
                    label.style.color = serviceObj.checked ? '#5e6c84' : '#172b4d';
                    label.style.textDecoration = serviceObj.checked ? 'line-through' : 'none';
                    label.style.transition = 'all 0.2s';
                    label.innerText = serviceObj.name;
                    
                    const delBtn = document.createElement('button');
                    delBtn.innerHTML = '×';
                    delBtn.style.background = 'transparent';
                    delBtn.style.border = 'none';
                    delBtn.style.color = '#ae2e24';
                    delBtn.style.fontSize = '18px';
                    delBtn.style.fontWeight = 'bold';
                    delBtn.style.cursor = 'pointer';
                    delBtn.style.padding = '0 4px';
                    if(delBtn) delBtn.onclick = () => {
                        card.services.splice(idx, 1);
                        saveState();
                        render();
                        renderChecklist();
                    };
                    
                    row.appendChild(cb);
                    row.appendChild(label);
                    row.appendChild(delBtn);
                    servicesItemsDiv.appendChild(row);
                });
            }
        };
        
        renderChecklist();
        
        if (addNewServiceBtn && newServiceInput) {
            if(addNewServiceBtn) addNewServiceBtn.onclick = () => {
                const val = newServiceInput.value.trim();
                if (val) {
                    card.services.push({ name: val, checked: false });
                    newServiceInput.value = '';
                    saveState();
                    render();
                    renderChecklist();
                }
            };
            
            // Allow pressing Enter
            newServiceInput.onkeypress = (e) => {
                if (e.key === 'Enter') {
                    addNewServiceBtn.click();
                }
            };
        }
    }
    
    modal.classList.add('active');
}

function setPipedriveColor(color) {
    if (!activePipedriveDealId || !activeBoardId) return;
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (!activeBoard || !activeBoard.telemetry) return;
    
    const virtualId = "pd_" + activePipedriveDealId;
    if (!activeBoard.telemetry[virtualId]) {
        activeBoard.telemetry[virtualId] = {};
    }
    
    activeBoard.telemetry[virtualId].color = color;
    saveState();
    
    activeBoard.lists.forEach(l => {
        l.cards.forEach(c => {
            if(String(c.id) === String(virtualId)) c.color = color;
        });
    });
    
    render();
    document.getElementById('pipedriveActionModal').classList.remove('active');
}

const pipedriveActionColorRedBtn = document.getElementById('pipedriveActionColorRedBtn');
if (pipedriveActionColorRedBtn) if(pipedriveActionColorRedBtn) pipedriveActionColorRedBtn.onclick = () => setPipedriveColor('red');

const pipedriveActionColorGreenBtn = document.getElementById('pipedriveActionColorGreenBtn');
if (pipedriveActionColorGreenBtn) if(pipedriveActionColorGreenBtn) pipedriveActionColorGreenBtn.onclick = () => setPipedriveColor('green');

const pipedriveActionColorClearBtn = document.getElementById('pipedriveActionColorClearBtn');
if (pipedriveActionColorClearBtn) if(pipedriveActionColorClearBtn) pipedriveActionColorClearBtn.onclick = () => setPipedriveColor(null);

const closePipedriveActionModalBtn = document.getElementById('closePipedriveActionModalBtn');
if (closePipedriveActionModalBtn) {
    if(closePipedriveActionModalBtn) closePipedriveActionModalBtn.onclick = () => {
        document.getElementById('pipedriveActionModal').classList.remove('active');
    };
}

const pipedriveActionDealTitleInput = document.getElementById('pipedriveActionDealTitleInput');
if (pipedriveActionDealTitleInput) {
    let originalTitle = '';
    
    pipedriveActionDealTitleInput.onfocus = () => {
        originalTitle = pipedriveActionDealTitleInput.value;
    };
    
    pipedriveActionDealTitleInput.onblur = async () => {
        const newVal = pipedriveActionDealTitleInput.value.trim();
        if (newVal === '' || newVal === originalTitle || !activePipedriveDealId || !activeBoardId) {
            pipedriveActionDealTitleInput.value = originalTitle;
            return; 
        }
        
        pipedriveActionDealTitleInput.disabled = true;
        const previousColor = pipedriveActionDealTitleInput.style.color;
        pipedriveActionDealTitleInput.style.color = '#7a869a';
        
        try {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            let foundCard = null;
            if (activeBoard) {
                for (let l of activeBoard.lists) {
                    foundCard = l.cards.find(c => c.id === window.activePipedriveCardId);
                    if (foundCard) break;
                }
            }
            
            if (foundCard && !foundCard.isPipedrive) {
                foundCard.title = newVal;
                originalTitle = newVal;
                showToast("Card title updated!");
                saveState();
                render();
            } else {
                const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newVal })
                });
                
                if (res.ok) {
                    originalTitle = newVal;
                    showToast("Deal title updated!");
                    
                    if (foundCard) {
                        foundCard.title = newVal;
                        if (foundCard.pipedriveData) foundCard.pipedriveData.title = newVal;
                        saveState();
                        render();
                    }
                    syncPipedrive();
                } else {
                    throw new Error("Failed to update deal title in Pipedrive");
                }
            }
        } catch(e) {
            showToast("Failed to update deal title.");
            pipedriveActionDealTitleInput.value = originalTitle;
        } finally {
            pipedriveActionDealTitleInput.disabled = false;
            pipedriveActionDealTitleInput.style.color = previousColor;
        }
    };
    
    pipedriveActionDealTitleInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            pipedriveActionDealTitleInput.blur();
        } else if (e.key === 'Escape') {
            pipedriveActionDealTitleInput.value = originalTitle;
            pipedriveActionDealTitleInput.blur();
        }
    };
}

const pipedriveActionNoteInput = document.getElementById('pipedriveActionNoteInput');
if (pipedriveActionNoteInput) {
    let originalNote = '';
    const noteStatus = document.getElementById('pipedriveActionNoteStatus');
    
    pipedriveActionNoteInput.onfocus = () => {
        originalNote = pipedriveActionNoteInput.value;
        if (noteStatus) noteStatus.innerText = '';
    };
    
    pipedriveActionNoteInput.onblur = async () => {
        const newVal = pipedriveActionNoteInput.value;
        if (newVal === originalNote || !activePipedriveDealId || !activeBoardId) {
            return; 
        }
        
        const activeBoard = boards.find(b => b.id === activeBoardId);
        if (!activeBoard || !activeBoard.pipedriveNoteFieldKey) return;
        
        pipedriveActionNoteInput.disabled = true;
        
        if (noteStatus) {
            noteStatus.innerText = 'Syncing note to Pipedrive...';
            noteStatus.style.color = '#5e6c84';
        }
        
        try {
            let foundCard = null;
            for (let l of activeBoard.lists) {
                foundCard = l.cards.find(c => c.id === window.activePipedriveCardId);
                if (foundCard) break;
            }
            
            const payload = {};
            payload[activeBoard.pipedriveNoteFieldKey] = newVal;
            
            const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (!res.ok) throw new Error("Failed to update note in Pipedrive");
            
            if (foundCard) {
                if (!foundCard.pipedriveData) foundCard.pipedriveData = {};
                foundCard.pipedriveData[activeBoard.pipedriveNoteFieldKey] = newVal;
            }
            
            originalNote = newVal;
            
            if (noteStatus) {
                noteStatus.innerText = 'Note saved successfully!';
                noteStatus.style.color = '#1f822b';
                setTimeout(() => { if (noteStatus.innerText === 'Note saved successfully!') noteStatus.innerText = ''; }, 3000);
            }
            
            saveState();
            syncPipedrive();
        } catch(e) {
            showToast("Failed to update note.");
            pipedriveActionNoteInput.value = originalNote;
            if (noteStatus) {
                noteStatus.innerText = 'Failed to save note.';
                noteStatus.style.color = '#ae2e24';
            }
        } finally {
            pipedriveActionNoteInput.disabled = false;
        }
    };
}

const pipedriveEditDealValueSaveBtn = document.getElementById('pipedriveEditDealValueSaveBtn');
if (pipedriveEditDealValueSaveBtn) {
    if(pipedriveEditDealValueSaveBtn) pipedriveEditDealValueSaveBtn.onclick = async () => {
        if (!activePipedriveDealId || !activeBoardId) return;
        const valInput = document.getElementById('pipedriveEditDealValueInput');
        if (!valInput) return;
        const newVal = valInput.value;
        if (newVal === '') return;

        try {
            pipedriveEditDealValueSaveBtn.innerHTML = 'Saving...';
            pipedriveEditDealValueSaveBtn.disabled = true;

            const activeBoard = boards.find(b => b.id === activeBoardId);
            let foundCard = null;
            if (activeBoard) {
                for (let l of activeBoard.lists) {
                    foundCard = l.cards.find(c => c.id === window.activePipedriveCardId);
                    if (foundCard) break;
                }
            }

            if (foundCard && !foundCard.isPipedrive) {
                foundCard.dealValue = Number(newVal);
                showToast("Card Value updated!");
                document.getElementById('pipedriveActionModal').classList.remove('active');
                saveState();
                render();
            } else {
                const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: Number(newVal) })
                });

                if (res.ok) {
                    showToast("Deal Value updated!");
                    document.getElementById('pipedriveActionModal').classList.remove('active');
                    
                    if (foundCard) {
                        foundCard.pipedriveData.value = Number(newVal);
                        saveState();
                        render();
                    }

                    syncPipedrive();
                } else {
                    throw new Error("Failed to update deal value in Pipedrive");
                }
            }
        } catch(e) {
            showToast("Error updating deal value");
        } finally {
            pipedriveEditDealValueSaveBtn.innerHTML = 'Save';
            pipedriveEditDealValueSaveBtn.disabled = false;
        }
    };
}

const pipedriveActionWonBtn = document.getElementById('pipedriveActionWonBtn');
if (pipedriveActionWonBtn) {
    if(pipedriveActionWonBtn) pipedriveActionWonBtn.onclick = async () => {
        if (!activePipedriveDealId || !activeBoardId) return;
        
        try {
            pipedriveActionWonBtn.innerHTML = 'Syncing...';
            pipedriveActionWonBtn.disabled = true;
            
            const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'won' })
            });
            
            if (res.ok) {
                showToast("Deal Marked as Won!");
                document.getElementById('pipedriveActionModal').classList.remove('active');
                
                // Duplicate into New Clients
                const b = boards.find(bd => bd.id === activeBoardId);
                if (b) {
                    let sourceList = null;
                    let theDeal = null;
                    for (let l of b.lists) {
                        theDeal = l.cards.find(c => c.id === window.activePipedriveCardId);
                        if (theDeal) {
                            sourceList = l;
                            break;
                        }
                    }
                    if (theDeal) {
                        let targetLists = [];
                        if (b.connections) {
                            targetLists = b.connections.filter(conn => conn.source === sourceList.id).map(conn => b.lists.find(l => l.id === conn.target)).filter(l => l && l.isNewClients);
                        }
                        if (targetLists.length === 0) targetLists = b.lists.filter(l => l.isNewClients);
                        
                        if (targetLists.length > 0) {
                            const newClientsList = targetLists[0];
                            if (!newClientsList.cards) newClientsList.cards = [];
                            
                            const extractedTitle = theDeal.pipedriveData ? (theDeal.pipedriveData.person_id_name || theDeal.pipedriveData.title || theDeal.title) : theDeal.title;
                            
                            newClientsList.cards.push({
                                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                                title: extractedTitle,
                                dueDate: null,
                                serviceChecklist: cloneCardChecklist(theDeal)
                            });
                            saveState();
                            render();
                        }
                    }
                }
                
                syncPipedrive();
            } else {
                throw new Error("Failed");
            }
        } catch(e) {
            showToast("Error updating deal status.");
        } finally {
            pipedriveActionWonBtn.innerHTML = '🏆 Mark Won';
            pipedriveActionWonBtn.disabled = false;
        }
    };
}

const pipedriveActionDuplicateBtn = document.getElementById('pipedriveActionDuplicateBtn');
if (pipedriveActionDuplicateBtn) {
    if(pipedriveActionDuplicateBtn) pipedriveActionDuplicateBtn.onclick = async () => {
        if (!activePipedriveDealId || !activeBoardId) return;
        
        try {
            pipedriveActionDuplicateBtn.innerHTML = '📋 Duplicating...';
            pipedriveActionDuplicateBtn.disabled = true;
            
            const activeBoard = boards.find(b => b.id === activeBoardId);
            let foundCard = null;
            let targetList = null;
            if (activeBoard) {
                for (let l of activeBoard.lists) {
                    foundCard = l.cards.find(c => c.id === window.activePipedriveCardId);
                    if (foundCard) {
                        targetList = l;
                        break;
                    }
                }
            }
            
            if (foundCard && !foundCard.isPipedrive) {
                // Local duplicate (e.g. money smelling or local deal)
                if (activeBoard && targetList) {
                    const newCard = { ...foundCard, id: Date.now().toString() + Math.random().toString(36).substr(2, 5) };
                    newCard.title = foundCard.title + " (Copy)";
                    targetList.cards.push(newCard);
                    saveState();
                    render();
                }
                showToast("Card Duplicated!");
                document.getElementById('pipedriveActionModal').classList.remove('active');
            } else {
                // Pipedrive duplicate
                // we'll try recreating it via POST /v1/deals/{id}/duplicate
                let res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}/duplicate?api_token=${pipedriveToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (res.ok) {
                    showToast("Deal Duplicated!");
                    document.getElementById('pipedriveActionModal').classList.remove('active');
                    syncPipedrive();
                } else {
                    throw new Error("Failed");
                }
            }
        } catch(e) {
            console.error("Duplicate err", e);
            showToast("Error duplicating deal.");
        } finally {
            pipedriveActionDuplicateBtn.innerHTML = '📋 Duplicate Deal';
            pipedriveActionDuplicateBtn.disabled = false;
        }
    };
}

const pipedriveActionDeleteBtn = document.getElementById('pipedriveActionDeleteBtn');
if (pipedriveActionDeleteBtn) {
    if(pipedriveActionDeleteBtn) pipedriveActionDeleteBtn.onclick = () => {
        document.getElementById('pipedriveActionDeleteConfirmContainer').style.display = 'block';
        document.getElementById('pipedriveActionDeleteBtn').parentElement.style.display = 'none';
    };
}

const pipedriveActionDeleteCancelBtn = document.getElementById('pipedriveActionDeleteCancelBtn');
if (pipedriveActionDeleteCancelBtn) {
    if(pipedriveActionDeleteCancelBtn) pipedriveActionDeleteCancelBtn.onclick = () => {
        document.getElementById('pipedriveActionDeleteConfirmContainer').style.display = 'none';
        document.getElementById('pipedriveActionDeleteBtn').parentElement.style.display = 'flex';
    };
}

const pipedriveActionDeleteConfirmBtn = document.getElementById('pipedriveActionDeleteConfirmBtn');
if (pipedriveActionDeleteConfirmBtn) {
    if(pipedriveActionDeleteConfirmBtn) pipedriveActionDeleteConfirmBtn.onclick = async () => {
        if (!activePipedriveDealId || !activeBoardId) return;
        
        try {
            pipedriveActionDeleteConfirmBtn.innerHTML = 'Deleting...';
            pipedriveActionDeleteConfirmBtn.disabled = true;
            document.getElementById('pipedriveActionDeleteCancelBtn').disabled = true;
            
            const activeBoard = boards.find(b => b.id === activeBoardId);
            let foundCard = null;
            if (activeBoard) {
                for (let l of activeBoard.lists) {
                    foundCard = l.cards.find(c => c.id === window.activePipedriveCardId);
                    if (foundCard) break;
                }
            }
            
            if (foundCard && !foundCard.isPipedrive) {
                if (activeBoard) {
                    activeBoard.lists.forEach(l => {
                        if (l.cards) l.cards = l.cards.filter(c => c.id !== window.activePipedriveCardId);
                    });
                    saveState();
                    render();
                }
                showToast("Card Deleted!");
                document.getElementById('pipedriveActionModal').classList.remove('active');
            } else {
                const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (res.ok) {
                    showToast("Deal Deleted!");
                    document.getElementById('pipedriveActionModal').classList.remove('active');
                    
                    // Remove locally to feel instant
                    if (activeBoard) {
                        activeBoard.lists.forEach(l => {
                            if (l.cards) {
                                l.cards = l.cards.filter(c => c.id !== `pd_${activePipedriveDealId}` && c.pipedriveData?.id != activePipedriveDealId);
                            }
                        });
                        saveState();
                        render();
                    }
                    
                    syncPipedrive();
                } else {
                    throw new Error("Failed to delete deal from Pipedrive");
                }
            }
        } catch(e) {
            showToast("Error deleting deal.");
        } finally {
            pipedriveActionDeleteConfirmBtn.innerHTML = 'Yes, Delete It';
            pipedriveActionDeleteConfirmBtn.disabled = false;
            document.getElementById('pipedriveActionDeleteCancelBtn').disabled = false;
        }
    };
}

const pipedriveActionLostBtn = document.getElementById('pipedriveActionLostBtn');
if (pipedriveActionLostBtn) {
    if(pipedriveActionLostBtn) pipedriveActionLostBtn.onclick = () => {
        document.getElementById('pipedriveActionPrimaryBtns').style.display = 'none';
        document.getElementById('pipedriveActionLostReasonContainer').style.display = 'block';
        document.getElementById('pipedriveActionLostReasonInput').focus();
    };
}

const pipedriveActionCancelLostBtn = document.getElementById('pipedriveActionCancelLostBtn');
if (pipedriveActionCancelLostBtn) {
    if(pipedriveActionCancelLostBtn) pipedriveActionCancelLostBtn.onclick = () => {
        document.getElementById('pipedriveActionLostReasonContainer').style.display = 'none';
        document.getElementById('pipedriveActionPrimaryBtns').style.display = 'flex';
    };
}

const pipedriveActionTemplateDropshippingBtn = document.getElementById('pipedriveActionTemplateDropshippingBtn');
if (pipedriveActionTemplateDropshippingBtn) {
    if(pipedriveActionTemplateDropshippingBtn) pipedriveActionTemplateDropshippingBtn.onclick = () => {
        const input = document.getElementById('pipedriveActionLostReasonInput');
        if (input) {
            input.value = "Dropshipping";
            input.focus();
        }
    };
}

const pipedriveActionTemplateNoResponseBtn = document.getElementById('pipedriveActionTemplateNoResponseBtn');
if (pipedriveActionTemplateNoResponseBtn) {
    if(pipedriveActionTemplateNoResponseBtn) pipedriveActionTemplateNoResponseBtn.onclick = () => {
        const input = document.getElementById('pipedriveActionLostReasonInput');
        if (input) {
            input.value = "No Response";
            input.focus();
        }
    };
}

const pipedriveActionSubmitLostBtn = document.getElementById('pipedriveActionSubmitLostBtn');
if (pipedriveActionSubmitLostBtn) {
    if(pipedriveActionSubmitLostBtn) pipedriveActionSubmitLostBtn.onclick = async () => {
        if (!activePipedriveDealId || !activeBoardId) return;
        const reason = document.getElementById('pipedriveActionLostReasonInput').value.trim();
        
        try {
            pipedriveActionSubmitLostBtn.innerHTML = 'Syncing...';
            pipedriveActionSubmitLostBtn.disabled = true;
            
            const res = await fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals/${activePipedriveDealId}?api_token=${pipedriveToken}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'lost', lost_reason: reason })
            });
            
            if (res.ok) {
                showToast("Deal Marked as Lost!");
                document.getElementById('pipedriveActionModal').classList.remove('active');
                syncPipedrive();
            } else {
                throw new Error("Failed");
            }
        } catch(e) {
            showToast("Error updating deal status.");
        } finally {
            pipedriveActionSubmitLostBtn.innerHTML = 'Confirm Loss to Pipedrive';
            pipedriveActionSubmitLostBtn.disabled = false;
        }
    };
}

if(closeTimerModal) closeTimerModal.onclick = () => { timerModal.classList.remove('active'); activeCardId = null; activeTargetListId = null; };

if(saveTimerBtn) saveTimerBtn.onclick = () => {
    if (!activeCardId) return;
    const d = parseInt(inputDays.value) || 0;
    const h = parseInt(inputHours.value) || 0;
    const m = parseInt(inputMins.value) || 0;

    if (d === 0 && h === 0 && m === 0) {
        alert("Please set a length greater than 0");
        return;
    }

    const ms = (d * 86400000) + (h * 3600000) + (m * 60000);
    const dueDate = new Date(Date.now() + ms).toISOString();

    const activeBoard = boards.find(b => b.id === activeBoardId);
    if(activeBoard.type === 'timer') {
        const card = activeBoard.cards.find(c => c.id === activeCardId);
        card.dueDate = dueDate;
        saveState();
        render();
        timerModal.classList.remove('active');
        showToast("Timer saved!");
    }
};

if(removeTimerBtn) removeTimerBtn.onclick = () => {
    if (!activeCardId) return;
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if(activeBoard.type === 'timer') {
        const card = activeBoard.cards.find(c => c.id === activeCardId);
        if(card.dueDate) {
            card.dueDate = null;
            saveState();
            render();
            showToast("Timer removed");
        }
    }
    timerModal.classList.remove('active');
};

if(deleteCardBtn) deleteCardBtn.onclick = () => {
    if (!activeCardId) return;
    
    if (!deleteCardBtn.classList.contains('confirm-state')) {
        deleteCardBtn.classList.add('confirm-state');
        deleteCardBtn.textContent = 'Click to confirm';
        deleteConfirmTimeout = setTimeout(() => {
            deleteCardBtn.classList.remove('confirm-state');
            deleteCardBtn.textContent = 'Delete Account';
        }, 3000);
        return;
    }

    clearTimeout(deleteConfirmTimeout);
    const activeBoard = boards.find(b => b.id === activeBoardId);
    if (activeBoard.type === 'kanban') {
        const list = activeBoard.lists.find(l => l.id === activeTargetListId);
        if (list) {
            list.cards = list.cards.filter(c => c.id !== activeCardId);
        }
    } else {
        activeBoard.cards = activeBoard.cards.filter(c => c.id !== activeCardId);
    }
    
    saveState();
    render();
    timerModal.classList.remove('active');
    showToast(activeBoard.type === 'kanban' ? "Card deleted" : "Account deleted");
    
    deleteCardBtn.classList.remove('confirm-state');
    deleteCardBtn.textContent = 'Delete Account';
};

let syncInterval = null;
let trelloRateLimitUntil = 0;

async function syncTrello() {
    const isHoveringCard = !!document.querySelector('.card:hover, .trello-task-card:hover, .kanban-card:hover');
    if (isGlobalDragging || isHoveringCard) return;
    if (!trelloKey || !trelloToken) return;
    if (Date.now() < trelloRateLimitUntil) {
        return;
    }
    const curBoard = boards.find(b => b.id === activeBoardId);
    if (!curBoard) return;
    
    const mappedLists = curBoard.lists.filter(l => l.trelloListId || l.trelloTasksListId);
    if (mappedLists.length === 0) return;
    
    const mappedListIds = mappedLists.map(l => l.trelloListId).filter(Boolean);
    const mappedTasksIds = mappedLists.map(l => l.trelloTasksListId).filter(Boolean);
    const uniqueBoardIds = new Set();
    
    mappedLists.forEach(l => {
        if (l.trelloBoardId) uniqueBoardIds.add(l.trelloBoardId);
        else if (l.trelloTasksBoardId) uniqueBoardIds.add(l.trelloTasksBoardId);
        else if (curBoard.trelloBoardId) uniqueBoardIds.add(curBoard.trelloBoardId);
    });
    
    if (uniqueBoardIds.size === 0) return;
    
    try {
        const promises = [];
        Array.from(uniqueBoardIds).forEach(boardId => {
            promises.push(fetch(`https://api.trello.com/1/boards/${boardId}/cards?fields=name,desc,idList,pos&key=${trelloKey}&token=${trelloToken}`));
            promises.push(fetch(`https://api.trello.com/1/boards/${boardId}/lists?fields=name&key=${trelloKey}&token=${trelloToken}`));
        });
        
        const responses = await Promise.all(promises);
        let hitRateLimit = false;

        for (const res of responses) {
            if (res.status === 429) {
                hitRateLimit = true;
            } else if (!res.ok) {
                return; // Ignore failed requests and skip sync loop
            }
        }

        if (hitRateLimit) {
            trelloRateLimitUntil = Date.now() + 5 * 60 * 1000;
            showToast("Trello API limit reached. Pausing sync for 5 minutes.");
            return;
        }
        
        const dataPayloads = await Promise.all(responses.map(res => res.json()));
        
        let allTrelloCards = [];
        let allTrelloLists = [];
        for (let i = 0; i < dataPayloads.length; i += 2) {
            allTrelloCards = allTrelloCards.concat(dataPayloads[i]);
            allTrelloLists = allTrelloLists.concat(dataPayloads[i + 1]);
        }
        
        if (!curBoard.telemetry) curBoard.telemetry = {};
        let needsRender = false;
        
        const oldStateStr = JSON.stringify(curBoard.lists.map(l => l.cards.filter(c => c.isTrello || c.isTrelloTask)));
        const colorMemory = {};
        const adsMetricsMemory = {};
        const pinnedMemory = {};
        const existingTrelloTasks = [];
        curBoard.lists.forEach(l => {
            l.cards.forEach(c => {
                if (c.color && (c.isTrello || c.isTrelloTask)) {
                    colorMemory[c.id] = c.color;
                }
                if (c.adsMetrics && (c.isTrello || c.isTrelloTask)) {
                    adsMetricsMemory[c.id] = c.adsMetrics;
                }
                if (c.isPinned && (c.isTrello || c.isTrelloTask)) {
                    pinnedMemory[c.id] = c.isPinned;
                }
                if (c.isTrelloTask) {
                    existingTrelloTasks.push({ card: JSON.parse(JSON.stringify(c)), listId: l.id });
                }
            });
            l.cards = l.cards.filter(c => !c.isTrello && !c.isTrelloTask);
        });
        
        allTrelloCards.forEach(tCard => {
            const isTrackerMatched = mappedListIds.includes(tCard.idList);
            const isTasksMatched = mappedTasksIds.includes(tCard.idList);
            
            if (!isTrackerMatched && !isTasksMatched) return;
            
            let record = null;
            if (isTrackerMatched) {
                record = curBoard.telemetry[tCard.id];
                if (!record) {
                    record = { 
                        listId: tCard.idList, 
                        startTime: Date.now(),
                        history: []
                    };
                    curBoard.telemetry[tCard.id] = record;
                    needsRender = true;
                } else if (record.listId !== tCard.idList) {
                    if (!record.history) record.history = [];
                    const elapsedMs = Date.now() - record.startTime;
                    
                    const oldList = curBoard.lists.find(l => l.trelloListId === record.listId);
                    const oldListName = oldList ? oldList.title : "Unknown List";
                    
                    record.history.push({
                        listId: record.listId,
                        listName: oldListName,
                        startTime: record.startTime,
                        endTime: Date.now(),
                        durationMs: elapsedMs
                    });
                    
                    record.listId = tCard.idList;
                    record.startTime = Date.now();
                    needsRender = true;
                }
            }
            
            const targetTrackerLists = curBoard.lists.filter(l => l.trelloListId === tCard.idList);
            targetTrackerLists.forEach(targetList => {
                if (targetList.title && targetList.title.toLowerCase() === 'me') return;
                
                targetList.cards.push({
                    id: tCard.id,
                    title: tCard.name,
                    pos: tCard.pos,
                    isTrello: true,
                    color: colorMemory[tCard.id],
                    adsMetrics: adsMetricsMemory[tCard.id],
                    isPinned: pinnedMemory[tCard.id],
                    startTime: record ? record.startTime : Date.now()
                });
            });
            
            const targetTasksLists = curBoard.lists.filter(l => l.trelloTasksListId === tCard.idList);
            targetTasksLists.forEach(targetList => {
                if (targetList.title && targetList.title.toLowerCase() === 'me') return;
                
                targetList.cards.push({
                    id: tCard.id,
                    title: tCard.name,
                    pos: tCard.pos,
                    isTrelloTask: true,
                    color: colorMemory[tCard.id],
                    adsMetrics: adsMetricsMemory[tCard.id],
                    isPinned: pinnedMemory[tCard.id],
                    startTime: Date.now()
                });
            });
        });
        
        const activeTrelloCardIds = new Set(allTrelloCards.map(t => t.id));
        existingTrelloTasks.forEach(taskObj => {
            if (!activeTrelloCardIds.has(taskObj.card.id)) {
                taskObj.card.isTrelloDeleted = true;
                const parentList = curBoard.lists.find(l => l.id === taskObj.listId);
                if (parentList) {
                    parentList.cards.push(taskObj.card);
                }
            }
        });
        
        const newStateStr = JSON.stringify(curBoard.lists.map(l => l.cards.filter(c => c.isTrello || c.isTrelloTask)));
        if (oldStateStr !== newStateStr) {
            needsRender = true;
        }

        if (window.applySmartPacking && window.applySmartPacking(curBoard)) {
            needsRender = true;
        }
        
        if (needsRender) {
            saveState();
            render();
        }
    } catch (e) {
        console.warn("Trello Sync iteration failed");
    }
}

window.applySmartPacking = function(curBoard) {
    let layoutModified = false;
    if (curBoard.connections) {
        const motherListIds = [...new Set(curBoard.connections.map(c => c.source))];
        motherListIds.forEach(sourceId => {
            const sourceList = curBoard.lists.find(l => l.id === sourceId);
            if (!sourceList) return;
            
            const allTargets = [];
            curBoard.connections.forEach(c => {
                if (c.source === sourceId) {
                    const targetList = curBoard.lists.find(l => l.id === c.target && (l.trelloListId || l.trackerType === 'ads'));
                    if (targetList && targetList.cards) {
                        if (targetList.trelloListId && targetList.trackerType !== 'ads' && targetList.trackerType !== 'trelloSpeech') {
                            delete targetList.isManualLayout; // REVERTED: Restore background squashing mathematical algorithm
                        }
                        const eff = curBoard.sentimentFilters;
                        let listHiddenByFilter = false;
                        
                        // Check if filtering obliterates this list from the canvas 
                        if (eff) {
                            Object.keys(eff).forEach(k => {
                                const lu = k.lastIndexOf('_');
                                const pId = k.substring(0, lu);
                                if (pId !== targetList.id) {
                                    let allD2 = new Set();
                                    const gD2 = (sId) => {
                                        if (!curBoard.connections) return;
                                        curBoard.connections.forEach(cx => {
                                            if (cx.source === sId && !allD2.has(cx.target)) { allD2.add(cx.target); gD2(cx.target); }
                                            // Upstream geometry traversal removed to prevent coordinate reflow ghosting across unrelated branches
                                        });
                                    };
                                    gD2(pId);
                                    if (allD2.has(targetList.id)) {
                                        const pType = k.substring(k.lastIndexOf('_') + 1);
                                        
                                        // Evaluate same rigid type exclusions as the main canvas algorithm
                                        let typeMatches = false;
                                        if (pType === 'trello' && (targetList.trelloTasksListId || targetList.trelloBoardId || targetList.trelloListId) && targetList.trackerType !== 'ads' && targetList.trackerType !== 'trelloSpeech') {
                                            typeMatches = true;
                                        } else if (pType === 'trelloSpeech' && targetList.trackerType === 'trelloSpeech') {
                                            typeMatches = true;
                                        } else if (pType === 'ads' && targetList.trackerType === 'ads') {
                                            typeMatches = true;
                                        } else if (pType === 'clientHappiness' && (targetList.isClientHappiness || targetList.isMoneySmelling)) {
                                            typeMatches = true;
                                        }

                                        if (typeMatches) {
                                            const rqColor = eff[k];
                                            const hM = targetList.cards.some(mc => {
                                                const isCHContext = pType === 'clientHappiness';
                                                let cl = 'default';
                                                if (isCHContext) {
                                                    cl = (curBoard.clientHappinessData && curBoard.clientHappinessData[mc.id]) ? curBoard.clientHappinessData[mc.id] : 'default';
                                                } else {
                                                    cl = (curBoard.cardColors && curBoard.cardColors[mc.id]) ? curBoard.cardColors[mc.id] : 'default';
                                                }
                                                return cl === rqColor;
                                            });
                                            if (!hM) listHiddenByFilter = true;
                                        }
                                    }
                                }
                            });
                        }
                        // Baseline check: if a Trello tracker list is completely empty, it will be hidden from the canvas by the render() function.
                        if (!listHiddenByFilter && targetList.cards && targetList.cards.length === 0 && (targetList.trelloTasksListId || targetList.trelloBoardId || targetList.trelloListId) && targetList.trackerType !== 'ads' && (!targetList.title || targetList.title.toLowerCase() !== 'me')) {
                            listHiddenByFilter = true;
                        }

                        targetList.isTempHiddenForPacking = listHiddenByFilter;
                        if (!listHiddenByFilter && !allTargets.some(t => t.list.id === targetList.id)) {
                            allTargets.push({ list: targetList, direction: 'top' });
                        }
                    }
                }
            });
            
            const packTargets = (targets) => {
                const byDirection = {};
                targets.forEach(vt => {
                    if (!byDirection[vt.direction]) byDirection[vt.direction] = [];
                    byDirection[vt.direction].push(vt.list);
                });
                
                Object.keys(byDirection).forEach(dir => {
                    const sortedLists = byDirection[dir];
                    
                    const spacingX = 380;
                    const totalOffsets = sortedLists.length * spacingX;
                    let startOffsetX = sourceList.x - (totalOffsets / 2) + (spacingX / 2);
                    
                    let maxEstimatedHeight = 400;
                    if (dir === 'top') {
                        maxEstimatedHeight = sortedLists.reduce((m, sl) => Math.max(m, 120 + ((sl.cards||[]).length * 80)), 400);
                    }
                    
                    const alignType = (sourceList.trelloAlignType || 'top');

                    sortedLists.forEach((list, index) => {
                        const isAds = list.trackerType === 'ads';
                        const isTs = list.trackerType === 'trelloSpeech';
                        const offsetX = isAds ? (sourceList.adsOffsetX !== undefined ? sourceList.adsOffsetX : 0) : (isTs ? (sourceList.trelloSpeechOffsetX !== undefined ? sourceList.trelloSpeechOffsetX : 800) : (sourceList.trelloOffsetX !== undefined ? sourceList.trelloOffsetX : 0));
                        const spacingY = isAds ? (sourceList.adsSpacingY !== undefined ? sourceList.adsSpacingY : 60) : (isTs ? (sourceList.trelloSpeechSpacingY !== undefined ? sourceList.trelloSpeechSpacingY : 60) : (sourceList.trelloSpacingY !== undefined ? sourceList.trelloSpacingY : 60));
                        const baseTypeOffset = isAds ? (sourceList.adsOffsetY !== undefined ? sourceList.adsOffsetY : 0) : (isTs ? (sourceList.trelloSpeechOffsetY !== undefined ? sourceList.trelloSpeechOffsetY : 0) : (sourceList.trelloOffsetY !== undefined ? sourceList.trelloOffsetY : 0));
                        
                        let nx = sourceList.x;
                        let ny = sourceList.y;
                        
                        // Fallback math triggered previously because lists don't have id="list-XYZ" HTML properties
                        const domNode = document.querySelector(`.kanban-list[data-id="${list.id}"]`);
                        
                        if (dir === 'top') {
                            nx = startOffsetX + (index * spacingX) + offsetX;
                            if (alignType === 'bottom') {
                                const listHeight = domNode ? domNode.offsetHeight : (120 + ((list.cards||[]).length * 80));
                                ny -= (listHeight + spacingY - baseTypeOffset);
                            } else {
                                ny -= (maxEstimatedHeight + spacingY - baseTypeOffset);
                            }
                        } else if (dir === 'bottom') {
                            ny += (400 + spacingY + baseTypeOffset);
                            nx = startOffsetX + (index * spacingX) + offsetX;
                        } else if (dir === 'left') {
                            ny = sourceList.y + baseTypeOffset;
                            nx = sourceList.x - 400 - spacingY - ((sortedLists.length - 1 - index) * spacingX) + offsetX;
                        } else if (dir === 'right') {
                            ny = sourceList.y + baseTypeOffset;
                            nx = sourceList.x + 400 + spacingY + (index * spacingX) + offsetX;
                        }
                        
                        let collision = true;
                        let loopLimit = 0;
                        while(collision && loopLimit < 5) {
                            const over = curBoard.lists.find(l => {
                                if (l.id === list.id || typeof l.x !== 'number' || typeof l.y !== 'number') return false;
                                if (allTargets.some(t => t.list.id === l.id)) return false;
                                if (Math.abs(l.x - nx) >= 30 || Math.abs(l.y - ny) >= 30) return false;
                                const dNode = document.querySelector(`.kanban-list[data-id="${l.id}"]`);
                                if (l.isTempHiddenForPacking || (dNode && dNode.classList.contains('hidden-list'))) return false;
                                return true;
                            });
                            if (over) {
                                // Disable diagonal stair-stepping to strictly enforce auto-alignment
                                collision = false;
                            } else {
                                collision = false;
                            }
                        }
                        if (list.isManualLayout) return;
                        
                        if (list.x !== nx || list.y !== ny) {
                            list.x = nx;
                            list.y = ny;
                            layoutModified = true;
                            
                            // Synchronous DOM injection guarantees layout math doesn't trigger feedback loop re-renders
                            if (domNode) {
                                domNode.style.left = nx + 'px';
                                domNode.style.top = ny + 'px';
                            }
                        }
                    });
                });
            };
            
            if (allTargets.length > 0) {
                const trelloTargets = allTargets.filter(t => t.list.trackerType !== 'trelloSpeech' && t.list.trackerType !== 'ads');
                const speechTargets = allTargets.filter(t => t.list.trackerType === 'trelloSpeech');
                const adsTargets = allTargets.filter(t => t.list.trackerType === 'ads');

                if (trelloTargets.length > 0) packTargets(trelloTargets);
                if (speechTargets.length > 0) packTargets(speechTargets);
                if (adsTargets.length > 0) packTargets(adsTargets);
            }
        });
    }
    return layoutModified;
};

if (syncInterval) clearInterval(syncInterval);
syncInterval = setInterval(syncTrello, 10000); // 10s intervals
setTimeout(syncTrello, 500);

let syncPipedriveInterval = null;
let cachedPipedriveStages = {};
let lastPipedriveStagesFetch = {};
let pipedriveRateLimitUntil = 0;

async function syncPipedrive() {
    const isHoveringCard = !!document.querySelector('.card:hover, .trello-task-card:hover, .kanban-card:hover');
    if (isGlobalDragging || isHoveringCard) return;
    if (!pipedriveDomain || !pipedriveToken) return;
    if (Date.now() < pipedriveRateLimitUntil) {
        return;
    }
    const curBoard = boards.find(b => b.id === activeBoardId);
    if (!curBoard) return;
    
    const mappedLists = curBoard.lists.filter(l => l.pipedriveStageId);
    if (mappedLists.length === 0) return;
    
    const mappedStageIds = mappedLists.map(l => String(l.pipedriveStageId));
    const uniquePipelineIds = new Set();
    
    mappedLists.forEach(l => {
        const pId = l.pipedrivePipelineId || curBoard.pipedrivePipelineId;
        if (pId && String(pId) !== "null" && String(pId) !== "undefined") {
            uniquePipelineIds.add(String(pId));
        }
    });
    
    if (uniquePipelineIds.size === 0) return;
    
    try {
        const promises = [];
        const stagePromises = [];
        const pipelineStagesToFetch = [];
        
        Array.from(uniquePipelineIds).forEach(pipelineId => {
            promises.push(fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/deals?pipeline_id=${pipelineId}&status=open&limit=500&api_token=${pipedriveToken}`));
            
            const now = Date.now();
            if (!cachedPipedriveStages[pipelineId] || (now - (lastPipedriveStagesFetch[pipelineId] || 0)) > 3600000) {
                pipelineStagesToFetch.push(pipelineId);
                stagePromises.push(fetch(`https://${pipedriveDomain}.pipedrive.com/api/v1/stages?pipeline_id=${pipelineId}&api_token=${pipedriveToken}`));
            }
        });
        
        const responses = await Promise.all([...promises, ...stagePromises]);
        let hitRateLimit = false;
        
        for (const res of responses) {
            if (res.status === 429) {
                hitRateLimit = true;
            } else if (!res.ok) {
                return; // Ignore failures and skip sync loop
            }
        }
        
        if (hitRateLimit) {
            pipedriveRateLimitUntil = Date.now() + 5 * 60 * 1000;
            showToast("Pipedrive API limit reached. Pausing sync for 5 minutes.");
            return;
        }
        
        const dealResponses = responses.slice(0, promises.length);
        const stageResponses = responses.slice(promises.length);
        
        const dealPayloads = await Promise.all(dealResponses.map(res => res.json()));
        const stagePayloads = await Promise.all(stageResponses.map(res => res.json()));
        
        let allPipedriveDealsMap = new Map();
        let allPipedriveStages = [];
        
        for (let i = 0; i < dealPayloads.length; i++) {
            const arr = dealPayloads[i].data || [];
            arr.forEach(d => allPipedriveDealsMap.set(d.id, d));
        }
        let allPipedriveDeals = Array.from(allPipedriveDealsMap.values());
        
        stagePayloads.forEach((payload, index) => {
            const pid = pipelineStagesToFetch[index];
            cachedPipedriveStages[pid] = payload.data || [];
            lastPipedriveStagesFetch[pid] = Date.now();
        });
        
        Array.from(uniquePipelineIds).forEach(pipelineId => {
            if (cachedPipedriveStages[pipelineId]) {
                allPipedriveStages = allPipedriveStages.concat(cachedPipedriveStages[pipelineId]);
            }
        });
        
        if (!curBoard.telemetry) curBoard.telemetry = {};
        let needsRender = false;
        
        const localOrderingMap = {};
        const adsMetricsMemory = {};
        const pinnedMemory = {};
        
        const oldStateStr = JSON.stringify(curBoard.lists.map(l => l.cards.filter(c => c.isPipedrive)));
        
        curBoard.lists.forEach(l => {
            if (l.pipedriveStageId) {
                localOrderingMap[String(l.pipedriveStageId)] = l.cards.filter(c => c.isPipedrive).map(c => String(c.id));
                const pStage = allPipedriveStages.find(ps => String(ps.id) === String(l.pipedriveStageId));
                if (pStage && l.title !== pStage.name) {
                    l.title = pStage.name;
                    needsRender = true;
                }
            }
            l.cards.forEach(c => {
                 if (c.adsMetrics && c.isPipedrive) {
                     adsMetricsMemory[c.id] = c.adsMetrics;
                 }
                 if (c.isPinned && c.isPipedrive) {
                     pinnedMemory[c.id] = c.isPinned;
                 }
            });
            l.cards = l.cards.filter(c => !c.isPipedrive);
        });
        
        allPipedriveDeals.forEach(pDeal => {
            const pStageIdStr = String(pDeal.stage_id);
            if (!mappedStageIds.includes(pStageIdStr)) return;
            
            const pdVirtualId = "pd_" + pDeal.id; // Prefix to avoid numeric tracking issues!
            
            let record = curBoard.telemetry[pdVirtualId];
            if (!record) {
                record = { 
                    listId: pStageIdStr, 
                    startTime: Date.now(),
                    history: []
                };
                curBoard.telemetry[pdVirtualId] = record;
                needsRender = true;
            } else if (String(record.listId) !== pStageIdStr) {
                if (!record.history) record.history = [];
                const elapsedMs = Date.now() - record.startTime;
                
                const oldList = curBoard.lists.find(l => String(l.pipedriveStageId) === String(record.listId));
                const oldListName = oldList ? oldList.title : "Unknown Stage";
                
                record.history.push({
                    listId: record.listId,
                    listName: oldListName,
                    startTime: record.startTime,
                    endTime: Date.now(),
                    durationMs: elapsedMs
                });
                
                record.listId = pStageIdStr;
                record.startTime = Date.now();
                needsRender = true;
            }
            
            const targetLists = curBoard.lists.filter(l => String(l.pipedriveStageId) === pStageIdStr);
            targetLists.forEach(targetList => {
                targetList.cards.push({
                    id: pdVirtualId,
                    title: pDeal.title,
                    isPipedrive: true,
                    pipedriveData: pDeal,
                    startTime: record.startTime,
                    adsMetrics: adsMetricsMemory[pdVirtualId],
                    isPinned: pinnedMemory[pdVirtualId],
                    color: record.color || null
                });
            });
        });
        
        curBoard.lists.forEach(l => {
            if (l.pipedriveStageId) {
                const stageIdStr = String(l.pipedriveStageId);
                const customOrder = localOrderingMap[stageIdStr];
                
                if (customOrder && customOrder.length > 0) {
                    l.cards.sort((a, b) => {
                        if (!a.isPipedrive && !b.isPipedrive) return 0;
                        if (!a.isPipedrive) return -1;
                        if (!b.isPipedrive) return 1;
                        
                        let indexA = customOrder.indexOf(String(a.id));
                        let indexB = customOrder.indexOf(String(b.id));
                        
                        if (indexA === -1) indexA = 999999;
                        if (indexB === -1) indexB = 999999;
                        
                        return indexA - indexB;
                    });
                }
            }
        });
        
        const newStateStr = JSON.stringify(curBoard.lists.map(l => l.cards.filter(c => c.isPipedrive)));
        if (oldStateStr !== newStateStr) {
            needsRender = true;
        }
        
        
        if (needsRender) {
            saveState();
            render();
        }
    } catch (e) {
        console.warn("Pipedrive Sync iteration failed", e);
    }
}

let isAppVisible = true;
let currentTrelloSyncInterval = 5000; // 5 seconds for Trello
let currentPipedriveSyncInterval = 60000; // 60 seconds for Pipedrive to respect 30k daily token limit

function restartSyncTimers() {
    if (syncInterval) clearInterval(syncInterval);
    if (syncPipedriveInterval) clearInterval(syncPipedriveInterval);
    
    syncInterval = setInterval(syncTrello, currentTrelloSyncInterval);
    syncPipedriveInterval = setInterval(syncPipedrive, currentPipedriveSyncInterval);
}

if(document) document.addEventListener("visibilitychange", () => {
    isAppVisible = document.visibilityState === "visible";
    currentTrelloSyncInterval = isAppVisible ? 5000 : 30000; // 5s visible, 30s background
    currentPipedriveSyncInterval = isAppVisible ? 60000 : 180000; // 60s visible, 3m background
    restartSyncTimers();
});

// Initial boot
setTimeout(syncTrello, 500);
setTimeout(syncPipedrive, 800);
restartSyncTimers();

function formatTrelloTime(startTime, hideMinutes = false, hideHours = false) {
    if (!startTime) return hideMinutes ? (hideHours ? '0d' : '0h') : '0m';
    const diffMs = Math.max(0, Date.now() - parseInt(startTime));
    const totalSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    
    let text = '';
    
    if (days >= 365) {
        const y = Math.floor(days / 365);
        const remDaysAfterY = days % 365;
        const mo = Math.floor(remDaysAfterY / 30);
        const d = remDaysAfterY % 30;
        
        text += `${y}y `;
        if (mo > 0) text += `${mo}m `;
        if (d > 0) text += `${d}d`;
    } else if (days >= 30) {
        const mo = Math.floor(days / 30);
        const d = days % 30;
        
        text += `${mo}m `;
        if (d > 0) text += `${d}d`;
    } else {
        if (hideMinutes) {
            if (days > 0) text += `${days}d `;
            if (!hideHours) text += `${hours % 24}h`;
            if (days === 0 && (hours === 0 || hideHours)) text = hideHours ? '< 1d' : '< 1h';
        } else {
            if (days > 0) text += `${days}d `;
            if (!hideHours && (hours > 0 || days > 0)) text += `${hours % 24}h `;
            text += `${mins % 60}m`;
            if (days === 0 && hours === 0 && mins === 0) text = '0m';
        }
    }
    
    return text.trim();
}

setInterval(() => {
    document.querySelectorAll('.trello-clock, .trello-age-clock').forEach(clock => {
        const hideMins = clock.classList.contains('trello-age-clock');
        const hideHours = clock.classList.contains('hide-hours');
        const text = formatTrelloTime(clock.dataset.startTime, hideMins, hideHours);
        const span = clock.querySelector('.clock-text');
        if (span && span.textContent !== text) span.textContent = text;
    });
}, 1000);

// Initial state load
render();
setInterval(() => { 
    const isHoveringCard = !!document.querySelector('.card:hover, .trello-task-card:hover, .kanban-card:hover');
    if (!isGlobalDragging && !isHoveringCard) render(); 
}, 60000);

window.openAddClientModal = function() {
    const smCount = boards.filter(b => b.type === 'social_scheduler').length;
    document.getElementById('newBoardTitle').value = 'Client ' + (smCount + 1);
    pendingNewBoardType = 'social_scheduler';
    document.querySelector('#addBoardModal h3').textContent = 'إضافة عميل جديد';
    document.getElementById('addBoardModal').classList.add('active');
    setTimeout(() => document.getElementById('newBoardTitle').focus(), 50);
};

window.reindexMediaBadges = function() {
    const gallery = document.getElementById('smMediaGallery');
    if (!gallery) return;
    const badges = gallery.querySelectorAll('.sm-gallery-badge');
    badges.forEach((badge, index) => {
        badge.textContent = index + 1;
    });
};

window.removeMediaItem = function(elem) {
    if (elem) {
        window.showConfirmModal(() => {
            const wrap = elem.closest('.frame-io-media') || (elem.closest('#smMediaGallery') ? elem.closest('#smMediaGallery > div') : null);
            const targetToRemove = wrap || elem.parentElement;
            if (targetToRemove) targetToRemove.remove();
            
            const gallery = document.getElementById('smMediaGallery');
            if (gallery && gallery.children.length === 0) {
                document.getElementById('smMediaPreviewContainer').style.display = 'none';
            } else {
                window.reindexMediaBadges();
            }

            // Immediately save the changes so reopening the modal doesn't bring the deleted media back
            if (typeof window.saveSocialDraft === 'function' && window.currentEditingSocialPostId) {
                window.saveSocialDraft(true);
            }
        });
    }
};

window.showConfirmModal = function(callback, titleText, descText) {
    const modal = document.getElementById('globalConfirmModal');
    if (!modal) {
        if(callback) callback();
        return;
    }
    
    const titleEl = modal.querySelector('h3');
    const descEl = modal.querySelector('p');
    
    if (titleEl && descEl) {
        if (!titleEl.hasAttribute('data-orig')) titleEl.setAttribute('data-orig', titleEl.innerText);
        if (!descEl.hasAttribute('data-orig')) descEl.setAttribute('data-orig', descEl.innerText);
        
        titleEl.innerText = titleText || titleEl.getAttribute('data-orig');
        descEl.innerText = descText || descEl.getAttribute('data-orig');
    }
    
    const btnYes = document.getElementById('globalConfirmYesBtn');
    const btnCancel = document.getElementById('globalConfirmCancelBtn');
    
    // Clear old listeners by cloning
    const newBtnYes = btnYes.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtnYes, btnYes);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    
    modal.classList.add('active');
    
    if(newBtnYes) newBtnYes.onclick = function() {
        modal.classList.remove('active');
        if(callback) callback();
    };
    
    if(newBtnCancel) newBtnCancel.onclick = function() {
        modal.classList.remove('active');
    };
};

window.handleMediaUpload = function(input) {
    if (input.files && input.files.length > 0) {
        const previewContainer = document.getElementById('smMediaPreviewContainer');
        const gallery = document.getElementById('smMediaGallery');
        
        previewContainer.style.display = 'block';
        
        Array.from(input.files).forEach((file) => {
            const fileUrl = URL.createObjectURL(file);
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position: relative; width: 100%; max-width: 160px; border-radius: 8px; overflow: hidden; border: 1px solid #edf2f7; background: #fff; display: flex; flex-direction: column; flex-shrink: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';
            
            const delBtn = `<button style="position: absolute; top: 6px; right: 6px; z-index: 10; background: rgba(255,255,255,0.95); color: #e53e3e; border-radius: 50%; width: 22px; height: 22px; border: none; font-size: 14px; font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" onclick="event.stopPropagation(); window.removeMediaItem(this)">×</button>`;
            const badge = `<div class="sm-gallery-badge" style="position: absolute; top: 6px; left: 6px; z-index: 10; background: #f97316; color: white; border-radius: 50%; width: 22px; height: 22px; font-size: 11px; font-weight: bold; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></div>`;
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const sizeBadge = `<div style="position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); z-index: 10; background: rgba(0,0,0,0.65); color: white; border-radius: 4px; padding: 3px 6px; font-size: 10px; font-weight: 500; white-space: nowrap;">MB ${sizeMB}</div>`;
            
            const isVideo = file.type.startsWith('video/');
            const mediaTypeLabel = isVideo ? 'فيديو' : 'صورة';
            const mediaElem = isVideo 
                ? `<video class="sm-gallery-vid" src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top:0; left:0; z-index: 1;" muted></video>`
                : `<img class="sm-gallery-img" src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top:0; left:0; z-index: 1;">`;
            const clickHandler = isVideo ? `window.viewMediaFull('${fileUrl}', 'video')` : `window.viewMediaFull('${fileUrl}', 'image')`;
            
            wrap.innerHTML = `
                <div style="width: 100%; aspect-ratio: 9/16; background: #1e293b; position: relative; overflow: hidden; cursor:pointer;" onclick="${clickHandler}">
                    ${mediaElem}
                    ${delBtn}
                    ${badge}
                    ${sizeBadge}
                </div>
                <div style="padding: 10px; background: #ffffff; display: flex; justify-content: center; border-top: 1px solid #edf2f7;">
                    <button onclick="${clickHandler}" style="width: 100%; background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 8px 0; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                        عرض ال${mediaTypeLabel}
                    </button>
                </div>
            `;
            gallery.appendChild(wrap);
        });
        
        window.reindexMediaBadges();
        
        // Reset file input so picking the identical file again still triggers change event
        input.value = '';
    }
};

window.clearMediaUpload = function(event) {
    if (event) event.stopPropagation();
    const input = document.getElementById('smMediaInput');
    if (input) input.value = '';
    
    const previewContainer = document.getElementById('smMediaPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
    const uploadPrompt = document.getElementById('smUploadPrompt');
    if (uploadPrompt) uploadPrompt.style.display = 'flex';
    
    const gallery = document.getElementById('smMediaGallery');
    if (gallery) {
        // Pause all videos before clearing to kill audio
        const vids = gallery.querySelectorAll('video');
        vids.forEach(v => { v.pause(); v.src = ''; });
        gallery.innerHTML = '';
    }
};

// Intelligently compresses media into a tiny base64 thumbnail to save localStorage space!
window.saveSocialDraft = async function(isAutoSave = false) {
    try {
        const activeBoard = boards.find(b => b.id === activeBoardId);
        
        if (!activeBoard || activeBoard.type !== 'social_scheduler') {
            if (!isAutoSave) console.error('No active board or wrong type', activeBoard);
            return;
        }
        
        const textArea = document.querySelector('.sm-textarea');
        const textContent = textArea ? textArea.value.trim() : '';
        const input = document.getElementById('smMediaInput');
        
        let mediaItems = [];
        
        // Safety check - we extract a thumbnail immediately so it doesn't break localStorage limits
        const gallery = document.getElementById('smMediaGallery');
        const hasInputFiles = input && input.files && input.files.length > 0;
        const nodes = gallery ? gallery.querySelectorAll('.sm-gallery-img, .sm-gallery-vid') : [];
        const frameIoNodes = gallery ? gallery.querySelectorAll('.frame-io-media') : [];
        
        if (hasInputFiles || nodes.length > 0 || frameIoNodes.length > 0) {
            if (gallery) {
                if (nodes.length > 0) {
                    const MAX_THUMB_SIZE = 1200;
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    for (let i = 0; i < nodes.length; i++) {
                        const node = nodes[i];
                        const isVid = node.classList.contains('sm-gallery-vid');
                        let compressedDataUrl = null;
                        
                        try {
                            if (!isVid && node.src && node.src !== window.location.href) {
                                if (!node.complete) {
                                    await new Promise(res => { node.onload = res; node.onerror = res; });
                                }
                                if (node.naturalWidth > 0) {
                                    const scale = Math.min(MAX_THUMB_SIZE / node.naturalWidth, MAX_THUMB_SIZE / node.naturalHeight, 1);
                                    canvas.width = node.naturalWidth * scale;
                                    canvas.height = node.naturalHeight * scale;
                                    ctx.drawImage(node, 0, 0, canvas.width, canvas.height);
                                    compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                                }
                            } else if (isVid && node.src && node.src !== window.location.href) {
                                if (node.readyState >= 2 && node.videoWidth > 0) {
                                    const scale = Math.min(MAX_THUMB_SIZE / node.videoWidth, MAX_THUMB_SIZE / node.videoHeight, 1);
                                    canvas.width = node.videoWidth * scale;
                                    canvas.height = node.videoHeight * scale;
                                    ctx.drawImage(node, 0, 0, canvas.width, canvas.height);
                                    compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                                }
                            }
                        } catch (err) {
                            console.error('Failed to compress thumbnail index ' + i, err);
                        }
                        
                        if (compressedDataUrl) {
                            mediaItems.push({ type: isVid ? 'video' : 'image', dataUrl: compressedDataUrl });
                        }
                    }
                }
                
                if (frameIoNodes.length > 0) {
                    for (let i = 0; i < frameIoNodes.length; i++) {
                        const urlAttr = frameIoNodes[i].getAttribute('data-url');
                        const urlThumb = frameIoNodes[i].getAttribute('data-thumbnail');
                        const mediaType = frameIoNodes[i].getAttribute('data-media-type');
                        const duration = frameIoNodes[i].getAttribute('data-duration');
                        if (urlAttr) {
                            mediaItems.push({ 
                                type: 'frame-io', 
                                url: urlAttr,
                                thumbnail: urlThumb || null,
                                mediaType: mediaType || null,
                                duration: duration || null
                            });
                        }
                    }
                }
            }
        }
        
        if (!textContent && mediaItems.length === 0) {
            if (!isAutoSave) {
                alert('يرجى إضافة نص أو وسائط');
                return;
            } else {
                // If the post is auto-saving but has become completely empty, we brutally delete it
                if (window.currentEditingSocialPostId) {
                    const idx = activeBoard.cards.findIndex(c => c.id === window.currentEditingSocialPostId);
                    if (idx > -1) {
                        activeBoard.cards.splice(idx, 1);
                        saveState();
                        render();
                        
                        const listEl = document.getElementById('smModalPostsList');
                        if (listEl) {
                            const activeSidebarItem = listEl.querySelector(`div[data-id="${window.currentEditingSocialPostId}"]`);
                            if (activeSidebarItem) activeSidebarItem.remove();
                        }
                        
                        // Since it's totally empty and deleted, clear the current editing id
                        // so any further typing spawns a fresh new post
                        window.currentEditingSocialPostId = null;
                        
                        // highlight the "+ new post" area intuitively
                        setTimeout(() => window.openCreatePostModal(null), 50);
                    }
                }
                return;
            }
        }
        
        const opts = window.activeSocialDateOptions || { year: new Date().getFullYear(), month: new Date().getMonth(), date: new Date().getDate() };
        const dateStr = `${opts.year}-${opts.month}-${opts.date}`;
        let status = 'مسودة';
        
        const statusBtn = document.querySelector('.sm-toggle-btn.active');
        if (statusBtn) status = statusBtn.textContent.trim();
        
        const newDraft = {
            id: window.currentEditingSocialPostId || ('post-' + Date.now()),
            title: textContent.substring(0, 50) + (textContent.length > 50 ? '...' : ''),
            fullText: textContent,
            dateStr: dateStr,
            status: status,
            mediaItems: mediaItems.length > 0 ? mediaItems : null
        };
        
        activeBoard.cards = activeBoard.cards || [];
        
        if (window.currentEditingSocialPostId) {
            const idx = activeBoard.cards.findIndex(c => c.id === window.currentEditingSocialPostId);
            if (idx > -1) {
                activeBoard.cards[idx] = newDraft;
            } else {
                activeBoard.cards.push(newDraft);
            }
        } else {
            activeBoard.cards.push(newDraft);
        }
        
        saveState();
        
        if (!isAutoSave) {
            // Close modal and reset fields
            const modal = document.getElementById('createPostModal');
            if (modal) modal.classList.remove('active');
            if (textArea) textArea.value = '';
            if (window.clearMediaUpload) window.clearMediaUpload();
        }
        
        render();
        if (typeof showToast === 'function' && !isAutoSave) showToast('تم الحفظ بنجاح');
        
        if (isAutoSave) {
            const listEl = document.getElementById('smModalPostsList');
            if (listEl) {
                const activeSidebarItem = listEl.querySelector(`div[data-id="${newDraft.id}"]`);
                if (activeSidebarItem && activeSidebarItem.children.length >= 3) {
                    let mediaThumbHtml = `<div style="font-size:12px; margin-left:6px; flex-shrink:0;">📝</div>`;
                    if (newDraft.mediaItems && newDraft.mediaItems.length > 0) {
                        const m = newDraft.mediaItems[0];
                        if (m.dataUrl && (!m.type || m.type === 'image')) {
                            mediaThumbHtml = `<img src="${m.dataUrl}" style="width:24px; height:24px; border-radius:4px; object-fit:cover; margin-left:6px; flex-shrink:0;">`;
                        } else if (m.thumbnail) {
                            mediaThumbHtml = `<img src="${m.thumbnail}" style="width:24px; height:24px; border-radius:4px; object-fit:cover; margin-left:6px; flex-shrink:0;">`;
                        } else if (m.type === 'frame-io' || m.type === 'video' || (m.dataUrl && m.dataUrl.startsWith('data:video/'))) {
                            mediaThumbHtml = `<div style="width:24px; height:24px; border-radius:4px; background:#1e293b; color:white; display:flex; align-items:center; justify-content:center; margin-left:6px; flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>`;
                        }
                    }
                    activeSidebarItem.children[1].outerHTML = mediaThumbHtml;
                }
            }
        }
        
        // Auto select sidebar
        setTimeout(() => {
            const cells = document.querySelectorAll('.sm-cal-cell.selected');
            if (cells.length > 0) cells[0].click();
        }, 50);

    } catch (e) {
        console.error("Critical error in saveSocialDraft:", e);
        alert("حدث خطأ أثناء حفظ المنشور: " + e.message);
    }
};

window.viewMediaFull = function(src, type) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); z-index:999999; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0; transition:opacity 0.2s;';
    
    let content = '';
    if (type === 'video') {
        content = `<video src="${src}" controls autoplay style="height:90vh; width:auto; max-width:90vw; border-radius:8px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5); cursor:default; object-fit:contain;" onclick="event.stopPropagation()"></video>`;
    } else {
        content = `<img src="${src}" style="height:90vh; width:auto; max-width:90vw; border-radius:8px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5); cursor:default; object-fit:contain;" onclick="event.stopPropagation()">`;
    }
    
    overlay.innerHTML = `
        <button style="position:absolute; top:20px; right:20px; background:rgba(255,255,255,0.1); border:none; color:white; width:40px; height:40px; border-radius:50%; font-size:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">×</button>
        ${content}
    `;
    
    document.body.appendChild(overlay);
    
    // trigger reflow for opacity transition
    void overlay.offsetWidth;
    overlay.style.opacity = '1';
    
    const closeOverlay = () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
    };
    
    // allow clicking on backdrop or X to close
    if(overlay) overlay.onclick = closeOverlay;
    const closeBtn = overlay.querySelector('button');
    if (closeBtn) if(closeBtn) closeBtn.onclick = closeOverlay;
};

window.deleteSocialPost = function(postId) {
    window.showConfirmModal(() => {
        const board = boards.find(b => b.id === activeBoardId);
        if (!board) return;
        
        const idx = board.cards.findIndex(c => c.id === postId);
        if (idx > -1) {
            board.cards.splice(idx, 1);
            saveState();
            render();
            
            if (window.currentEditingSocialPostId === postId) {
                // If we deleted the post we were currently viewing, empty the modal
                window.openCreatePostModal(null);
            } else {
                // If we deleted another post from the sidebar, refresh the sidebar
                window.openCreatePostModal(window.currentEditingSocialPostId);
            }
        }
    }, "حذف المنشور", "هل أنت متأكد من رغبتك في حذف هذا المنشور؟ لا يمكن التراجع عن هذا الإجراء.");
};

if(document) document.addEventListener('DOMContentLoaded', () => {
    const gallery = document.getElementById('smMediaGallery');
    if (gallery && typeof Sortable !== 'undefined') {
        new Sortable(gallery, {
            animation: 150,
            onEnd: function() {
                if (typeof window.reindexMediaBadges === 'function') {
                    window.reindexMediaBadges();
                }
                
                // Immediately auto-save if editing so order is preserved
                if (typeof window.saveSocialDraft === 'function' && window.currentEditingSocialPostId) {
                    window.saveSocialDraft(true);
                }
            }
        });
    }
});
