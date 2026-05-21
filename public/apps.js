const appTitle = document.getElementById('appTitle');
const editor = document.getElementById('editor');
const countAll = document.getElementById('countAll');
const targetInput = document.getElementById('targetInput');
const ringProgress = document.getElementById('ringProgress');
const statusText = document.getElementById('statusText');

const pasteButton = document.getElementById('pasteButton');
const copyButton = document.getElementById('copyButton');
const clearButton = document.getElementById('clearButton');

const popupLayer = document.getElementById('popupLayer');
const popupHeader = document.getElementById('popupHeader');
const popupTitle = document.getElementById('popupTitle');
const popupContent = document.getElementById('popupContent');
const popupStatusText = document.getElementById('popupStatusText');
const backPopupButton = document.getElementById('backPopupButton');
const closePopupButton = document.getElementById('closePopupButton');
const popupActions = document.getElementById('popupActions');
const openPopupButtons = document.querySelectorAll('[data-open-popup]');

const historyLoadButton = document.getElementById('historyLoadButton');
const historyCopyButton = document.getElementById('historyCopyButton');
const historyDeleteButton = document.getElementById('historyDeleteButton');

const authScreen = document.getElementById('authScreen');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const authForm = document.getElementById('authForm');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authError = document.getElementById('authError');
const logoutButton = document.getElementById('logoutButton');

const radius = 44;
const circumference = 2 * Math.PI * radius;
const popupCache = new Map();
const promptCache = new Map();
let lastSelectionStart = 0;
let lastSelectionEnd = 0;
let currentPopupName = '';
let tempMessageTimeout = null;
let currentPreviewIndex = -1;
let clearConfirmTimeout = null;
let historyDeleteConfirmTimeout = null;

let isLoginMode = true;
let currentTexts = [];

const popupConfig = {
  information: {
    title: 'Information',
    file: './popups/information.html',
    message: 'Moji Pickについて',
  },
  'action-panel': {
    title: '', 
    file: './popups/action-panel.html',
    message: '20件まで保存できます',
  },
  'ai-prompt': {
    title: 'AIと文章を編集するための準備',
    file: './popups/ai-prompt.html',
    message: 'AIサービス内のチャットでペーストしてください',
  },
  'ai-select': {
    title: 'AIサービスを選択して移動できます',
    file: './popups/ai-select.html',
    message: 'また戻ってきてください！',
  },
  'history-preview': {
    title: '保存した文章をプレビュー',
    file: './popups/history-preview.html',
    message: '読み込むと入力している文章は上書きされます',
  },
};

ringProgress.style.strokeDasharray = `${circumference} ${circumference}`;
ringProgress.style.strokeDashoffset = `${circumference}`;

async function preloadPrompts() {
  const types = ['reduce', 'increase', 'typo'];
  for (const type of types) {
    try {
      const response = await fetch(`./prompts/${type}.txt`);
      if (response.ok) {
        promptCache.set(type, await response.text());
      }
    } catch (error) {
      console.error(error);
    }
  }
}

function rememberSelection() {
  lastSelectionStart = editor.selectionStart ?? editor.value.length;
  lastSelectionEnd = editor.selectionEnd ?? editor.value.length;
}

function adjustTargetFontSize() {
  const length = targetInput.value.length;
  if (length >= 6) {
    targetInput.style.fontSize = '14px';
  } else if (length >= 5) {
    targetInput.style.fontSize = '16px';
  } else {
    targetInput.style.fontSize = '20px';
  }
}

function setStatusMessage(element, type, text) {
  if (element.getAttribute('data-message-type') !== type) {
    element.setAttribute('data-message-type', type);
    element.textContent = text;
    element.classList.remove('animate-text');
    void element.offsetWidth; 
    element.classList.add('animate-text');
  } else {
    element.textContent = text; 
  }
}

function showTempStatus(element, type, text, duration = 3000) {
  setStatusMessage(element, type, text);
  clearTimeout(tempMessageTimeout);
  tempMessageTimeout = setTimeout(() => {
    tempMessageTimeout = null;
    updateStats(); 
  }, duration);
}

function updateStats() {
  const text = editor.value || '';
  const total = text.length;
  const noSpace = text.replace(/\s+/g, '').length;
  const lines = text.length === 0 ? 0 : text.split(/\n/).length;
  const sheets = total === 0 ? 0 : Math.ceil(total / 400);
  
  const targetVal = Number(targetInput.value);
  const target = Math.max(Number.isFinite(targetVal) ? Math.floor(targetVal) : 0, 0);
  
  const progress = target > 0 ? Math.min(total / target, 1) : 0;
  const offset = circumference - progress * circumference;

  countAll.textContent = total.toLocaleString();
  ringProgress.style.strokeDashoffset = `${offset}`;

  const popupNoSpace = document.getElementById('popupCountNoSpace');
  if (popupNoSpace) popupNoSpace.textContent = noSpace.toLocaleString();
  
  const popupLines = document.getElementById('popupCountLines');
  if (popupLines) popupLines.textContent = lines.toLocaleString();
  
  const popupSheets = document.getElementById('popupCountSheets');
  if (popupSheets) popupSheets.textContent = sheets.toLocaleString();

  if (target > 0 && total >= target) {
    ringProgress.classList.add('completed');
  } else {
    ringProgress.classList.remove('completed');
  }

  if (total === 0) {
    copyButton.classList.add('is-hidden');
  } else {
    copyButton.classList.remove('is-hidden');
  }

  if (!tempMessageTimeout) {
    if (total === 0) {
      setStatusMessage(statusText, 'empty', '文字をペーストしてカウントをはじめましょう');
    } else if (target > 0 && total < target) {
      setStatusMessage(statusText, 'remaining', `目標まであと${(target - total).toLocaleString()}文字です`);
    } else if (target > 0 && total > target) {
      setStatusMessage(statusText, 'over', `目標より${(total - target).toLocaleString()}文字多い状態です`);
    } else if (target > 0 && total === target) {
      setStatusMessage(statusText, 'reached', '目標文字数に達しました');
    } else {
      setStatusMessage(statusText, 'none', '文字数を確認できます');
    }
  }
}

async function fetchTexts() {
  try {
    const res = await fetch('/api/texts');
    if (res.ok) {
      currentTexts = await res.json();
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveToServer() {
  const text = editor.value || '';
  if (!text) {
    showTempStatus(popupStatusText, 'save-error', '保存する文章がありません');
    return false;
  }

  if (currentTexts.length > 0 && currentTexts[0].content === text) {
    showTempStatus(popupStatusText, 'save-duplicate', 'すでに最新の状態で保存されています');
    return false;
  }

  if (currentTexts.length >= 20) {
    showTempStatus(popupStatusText, 'save-error', '保存上限（20件）に達しています');
    return false;
  }

  try {
    const res = await fetch('/api/texts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    });
    
    const data = await res.json();
    if (res.ok) {
      showTempStatus(popupStatusText, 'save-success', '文章を保存しました');
      await fetchTexts();
      renderHistory();
      return true;
    } else {
      showTempStatus(popupStatusText, 'save-error', data.error || '保存に失敗しました');
      return false;
    }
  } catch (e) {
    console.error(e);
    showTempStatus(popupStatusText, 'save-error', '保存に失敗しました');
    return false;
  }
}

function renderHistory() {
  const container = document.getElementById('popupHistoryList');
  if (!container) return;

  if (currentTexts.length === 0) {
    container.innerHTML = '<div style="font-size: 14px; color: var(--muted); text-align: center;">サーバーに保存された文章はありません</div>';
    return;
  }

  container.innerHTML = '';
  currentTexts.forEach((item, index) => {
    const card = document.createElement('button');
    card.className = 'history-item';
    card.type = 'button';
    
    const textPrev = document.createElement('span');
    textPrev.className = 'history-item-text';
    textPrev.textContent = item.content;
    
    const date = document.createElement('span');
    date.className = 'history-item-date';
    const d = new Date(item.created_at);
    date.textContent = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    
    card.appendChild(textPrev);
    card.appendChild(date);
    
    card.addEventListener('click', () => {
      currentPreviewIndex = index;
      openPopup('history-preview');
    });
    
    container.appendChild(card);
  });
}

function renderHistoryPreview() {
  const container = popupContent.querySelector('.popup-page[data-page="history-preview"]');
  if (!container) return;

  const item = currentTexts[currentPreviewIndex];

  if (!item) {
    openPopup('action-panel');
    return;
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'popup-block-text';
  textDiv.style.whiteSpace = 'pre-wrap';
  textDiv.textContent = item.content;

  container.innerHTML = '';
  container.appendChild(textDiv);
}

async function renderPrompts() {
  const container = popupContent.querySelector('.popup-page[data-page="ai-prompt"]');
  if (!container) return;
  container.innerHTML = '';

  const total = editor.value.length;
  const targetVal = Number(targetInput.value);
  const target = Math.max(Number.isFinite(targetVal) ? Math.floor(targetVal) : 0, 0);

  const descBlock = document.createElement('div');
  descBlock.className = 'popup-block';
  const descText = document.createElement('div');
  descText.className = 'popup-block-text';
  descText.textContent = 'AIと一緒に文章を編集しましょう。Moji Pickが文章に合ったプロンプトを生成しました。下のリストから選択してコピーできます。適切なプロンプトを作るには、目標文字数を正しく設定する必要があります。';
  descBlock.appendChild(descText);
  container.appendChild(descBlock);

  const createCard = (title, type) => {
    const card = document.createElement('button');
    card.className = 'prompt-card';
    card.type = 'button';
    card.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      <span>${title}</span>
    `;

    card.addEventListener('click', async () => {
      try {
        let promptText = promptCache.get(type);
        
        if (!promptText) {
          throw new Error('プロンプトデータの準備ができていません');
        }

        const diff = Math.abs(total - target);

        promptText = promptText.replace(/\{\{text\}\}/g, () => editor.value || '');
        promptText = promptText.replace(/\{\{target\}\}/g, () => target);
        promptText = promptText.replace(/\{\{current\}\}/g, () => total);
        promptText = promptText.replace(/\{\{diff\}\}/g, () => diff);

        await navigator.clipboard.writeText(promptText);
        
        openPopup('ai-select');
      } catch (error) {
        console.error(error);
        showTempStatus(popupStatusText, 'prompt-error', 'プロンプトのコピーに失敗しました');
      }
    });
    return card;
  };

  if (total !== target) {
    const isReduce = total > target;
    const promptType = isReduce ? 'reduce' : 'increase';
    const promptTitle = isReduce ? '目標数まで文章を削る' : '目標数まで文章を増やす';

    const recSection = document.createElement('div');
    recSection.className = 'prompt-section';
    const recTitle = document.createElement('div');
    recTitle.className = 'prompt-section-title';
    recTitle.textContent = 'おすすめ';
    const recList = document.createElement('div');
    recList.className = 'prompt-list';
    recList.appendChild(createCard(promptTitle, promptType));
    
    recSection.appendChild(recTitle);
    recSection.appendChild(recList);
    container.appendChild(recSection);
  }

  const otherSection = document.createElement('div');
  otherSection.className = 'prompt-section';
  const otherTitle = document.createElement('div');
  otherTitle.className = 'prompt-section-title';
  otherTitle.textContent = 'その他';
  const otherList = document.createElement('div');
  otherList.className = 'prompt-list';
  otherList.appendChild(createCard('誤字脱字を確認する', 'typo'));
  
  otherSection.appendChild(otherTitle);
  otherSection.appendChild(otherList);
  container.appendChild(otherSection);
}

function changeIconTemporary(buttonElement) {
  const svgElement = buttonElement.querySelector('svg');
  const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-check"><path d="M20 6 9 17l-5-5"/></svg>`;
  
  if (svgElement) {
    const originalSVG = svgElement.outerHTML;
    svgElement.outerHTML = checkSVG;
    buttonElement.style.pointerEvents = 'none';
    setTimeout(() => {
      const currentSVG = buttonElement.querySelector('svg');
      if (currentSVG) currentSVG.outerHTML = originalSVG;
      buttonElement.style.pointerEvents = 'auto';
    }, 2000);
  }
}

async function pasteText() {
  editor.blur();
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const start = Number.isInteger(lastSelectionStart) ? lastSelectionStart : editor.value.length;
    const end = Number.isInteger(lastSelectionEnd) ? lastSelectionEnd : editor.value.length;
    editor.setRangeText(text, start, end, 'end');
    rememberSelection();
    
    clearTimeout(tempMessageTimeout);
    tempMessageTimeout = null;
    updateStats();
    
    return true;
  } catch (error) {
    const targetStatus = popupLayer.hidden ? statusText : popupStatusText;
    showTempStatus(targetStatus, 'paste-error', '貼り付けできない場合は入力欄を長押ししてペーストしてください', 5000);
    console.error(error);
    return false;
  }
}

async function copyText() {
  editor.blur();
  try {
    await navigator.clipboard.writeText(editor.value || '');
    const targetStatus = popupLayer.hidden ? statusText : popupStatusText;
    if (editor.value) {
      showTempStatus(targetStatus, 'copy-success', '文章をコピーしました');
      return true;
    } else {
      showTempStatus(targetStatus, 'copy-empty', 'コピーする文章がありません');
      return false;
    }
  } catch (error) {
    console.error(error);
    return false;
  }
}

function clearText() {
  editor.blur();
  editor.value = '';
  rememberSelection();
  
  clearTimeout(tempMessageTimeout);
  tempMessageTimeout = null;
  updateStats();
}

async function loadPopup(name) {
  if (popupCache.has(name)) {
    return popupCache.get(name);
  }
  const config = popupConfig[name];
  if (!config) throw new Error(`Unknown popup: ${name}`);
  const response = await fetch(config.file);
  if (!response.ok) throw new Error(`Failed to load popup: ${config.file}`);
  const html = await response.text();
  popupCache.set(name, html);
  return html;
}

async function openPopup(name) {
  const config = popupConfig[name];
  if (!config) return;

  if (!popupLayer.hidden && currentPopupName !== name) {
    popupLayer.classList.remove('is-open');
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  try {
    const html = await loadPopup(name);
    currentPopupName = name;
    popupTitle.textContent = config.title;
    
    setStatusMessage(popupStatusText, name, config.message);
    
    popupContent.innerHTML = html;
    
    if (name === 'action-panel') {
      popupHeader.hidden = true;
      popupActions.hidden = true;
      updateStats(); 
      renderHistory();
    } 
    else if (name === 'history-preview') {
      popupHeader.hidden = false;
      backPopupButton.hidden = false;
      closePopupButton.hidden = true;
      popupActions.hidden = false;
      renderHistoryPreview();
    } 
    else {
      popupHeader.hidden = false;
      backPopupButton.hidden = true;
      closePopupButton.hidden = false;
      popupActions.hidden = true;
      if (name === 'ai-prompt') renderPrompts();
    }
    
    popupLayer.hidden = false;
    popupLayer.setAttribute('aria-hidden', 'false');
    
    requestAnimationFrame(() => {
      popupLayer.classList.add('is-open');
    });
  } catch (error) {
    console.error(error);
  }
}

function closePopup() {
  popupLayer.classList.remove('is-open');
  popupLayer.setAttribute('aria-hidden', 'true');
  
  setTimeout(() => {
    if (!popupLayer.classList.contains('is-open')) {
      popupLayer.hidden = true;
      currentPopupName = '';
      currentPreviewIndex = -1;
      popupContent.innerHTML = '';
      popupTitle.textContent = '';
      popupStatusText.textContent = '';
      popupStatusText.removeAttribute('data-message-type');
    }
  }, 300);
}

function handlePopupAction(event) {
  const trigger = event.target.closest('[data-open-popup]');
  if (!trigger) return;
  const name = trigger.getAttribute('data-open-popup');
  if (!name || name === currentPopupName) return;
  openPopup(name);
}

function setGreetingTitle() {
  const hour = new Date().getHours();
  let greeting = 'こんにちは';
  
  if (hour >= 5 && hour < 11) {
    greeting = 'おはようございます';
  } else if (hour >= 11 && hour < 18) {
    greeting = 'こんにちは';
  } else if (hour >= 18 && hour < 24) {
    greeting = 'こんばんは';
  } else {
    greeting = '遅くまでお疲れさまです';
  }

  setTimeout(() => {
    setStatusMessage(appTitle, 'greeting', greeting);
    setTimeout(() => {
      setStatusMessage(appTitle, 'title', 'Moji Pick');
    }, 3000);
  }, 1000);
}

// -----------------------------------------------------
// イベントリスナーの登録
// -----------------------------------------------------
editor.addEventListener('input', () => {
  rememberSelection();
  clearTimeout(tempMessageTimeout);
  tempMessageTimeout = null;
  updateStats();
});
editor.addEventListener('click', rememberSelection);
editor.addEventListener('keyup', rememberSelection);
editor.addEventListener('select', rememberSelection);
editor.addEventListener('focus', rememberSelection);

targetInput.addEventListener('input', () => {
  adjustTargetFontSize();
  clearTimeout(tempMessageTimeout);
  tempMessageTimeout = null;
  updateStats();
});

pasteButton.addEventListener('click', async () => {
  if (await pasteText()) changeIconTemporary(pasteButton);
});

copyButton.addEventListener('click', async () => {
  if (await copyText()) changeIconTemporary(copyButton);
});

clearButton.addEventListener('click', (event) => {
  event.stopPropagation();

  if (editor.value.length === 0) return;

  if (!clearButton.classList.contains('is-confirming')) {
    clearButton.classList.add('is-confirming');
    clearTimeout(clearConfirmTimeout);
    clearConfirmTimeout = setTimeout(() => {
      clearButton.classList.remove('is-confirming');
    }, 3000);
  } else {
    clearTimeout(clearConfirmTimeout);
    clearButton.classList.remove('is-confirming');
    clearText();
    changeIconTemporary(clearButton);
  }
});

historyLoadButton.addEventListener('click', () => {
  const item = currentTexts[currentPreviewIndex];
  if (item) {
    editor.value = item.content;
    rememberSelection();
    clearTimeout(tempMessageTimeout);
    tempMessageTimeout = null;
    updateStats();
    closePopup(); 
    showTempStatus(statusText, 'load-success', '保存した文章を読み込みました');
  }
});

historyCopyButton.addEventListener('click', async () => {
  const item = currentTexts[currentPreviewIndex];
  if (item) {
    try {
      await navigator.clipboard.writeText(item.content);
      showTempStatus(popupStatusText, 'copy-success', '文章をコピーしました');
      changeIconTemporary(historyCopyButton);
    } catch (error) {
      console.error(error);
    }
  }
});

historyDeleteButton.addEventListener('click', async (event) => {
  event.stopPropagation();

  if (!historyDeleteButton.classList.contains('is-confirming')) {
    historyDeleteButton.classList.add('is-confirming');
    clearTimeout(historyDeleteConfirmTimeout);
    historyDeleteConfirmTimeout = setTimeout(() => {
      historyDeleteButton.classList.remove('is-confirming');
    }, 3000);
  } else {
    clearTimeout(historyDeleteConfirmTimeout);
    historyDeleteButton.classList.remove('is-confirming');
    
    const item = currentTexts[currentPreviewIndex];
    if (item) {
      try {
        const res = await fetch(`/api/texts/${item.id}`, { method: 'DELETE' });
        if (res.ok) {
          changeIconTemporary(historyDeleteButton);
          await fetchTexts();
          setTimeout(() => {
            openPopup('action-panel');
            showTempStatus(popupStatusText, 'delete-success', '保存を削除しました');
          }, 500); 
        } else {
          showTempStatus(popupStatusText, 'delete-error', '削除に失敗しました');
        }
      } catch (error) {
        showTempStatus(popupStatusText, 'delete-error', '削除に失敗しました');
      }
    }
  }
});

document.addEventListener('click', async (event) => {
  if (clearButton.classList.contains('is-confirming') && !clearButton.contains(event.target)) {
    clearButton.classList.remove('is-confirming');
    clearTimeout(clearConfirmTimeout);
  }
  
  if (historyDeleteButton && historyDeleteButton.classList.contains('is-confirming') && !historyDeleteButton.contains(event.target)) {
    historyDeleteButton.classList.remove('is-confirming');
    clearTimeout(historyDeleteConfirmTimeout);
  }

  if (event.target.closest('[data-close-popup]')) {
    closePopup();
    return;
  }
  
  const pSave = event.target.closest('#popupSaveButton');
  if (pSave) {
    if (await saveToServer()) changeIconTemporary(pSave);
  }
});

backPopupButton.addEventListener('click', () => openPopup('action-panel'));
popupContent.addEventListener('click', handlePopupAction);
openPopupButtons.forEach((button) => {
  button.addEventListener('click', () => openPopup(button.dataset.openPopup));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !popupLayer.hidden) {
    closePopup();
  }
});

// --- Auth Logic ---
tabLogin.addEventListener('click', () => {
  isLoginMode = true;
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  authSubmitBtn.textContent = 'ログイン';
  authError.textContent = '';
});

tabRegister.addEventListener('click', () => {
  isLoginMode = false;
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  authSubmitBtn.textContent = '新規登録';
  authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  authError.textContent = '';

  const endpoint = isLoginMode ? '/api/login' : '/api/register';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    
    if (res.ok) {
      if (!isLoginMode) {
        const loginRes = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (loginRes.ok) {
          await initApp();
        } else {
          authError.textContent = '登録は成功しましたがログインに失敗しました。';
        }
      } else {
        await initApp();
      }
    } else {
      authError.textContent = data.error || 'エラーが発生しました。';
    }
  } catch (err) {
    authError.textContent = '通信エラーが発生しました。';
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
  } catch (e) {
    console.error(e);
  }
});

async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    return data.loggedIn;
  } catch (e) {
    return false;
  }
}

async function initApp() {
  const loggedIn = await checkSession();
  if (loggedIn) {
    authScreen.classList.add('is-hidden');
    logoutButton.classList.remove('is-hidden');
    await fetchTexts();
    preloadPrompts();
    adjustTargetFontSize();
    rememberSelection();
    updateStats();
    setGreetingTitle();
  } else {
    authScreen.classList.remove('is-hidden');
    logoutButton.classList.add('is-hidden');
  }
}

initApp();