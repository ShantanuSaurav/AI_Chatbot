// State Management
const sessionId = (() => {
    let sid = sessionStorage.getItem('sessionId');
    if (!sid) {
        sid = 'session_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
        sessionStorage.setItem('sessionId', sid);
    }
    return sid;
})();

let selectedFiles = [];
let activeDocId = null;
let documentsList = [];
let uploading = false;
let chatting = false;
let deletingDocId = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const filePreviewList = document.getElementById('filePreviewList');
const uploadBtn = document.getElementById('uploadBtn');
const docCountBadge = document.getElementById('docCountBadge');
const docList = document.getElementById('docList');
const activeDocTitle = document.getElementById('activeDocTitle');
const pdfWelcome = document.getElementById('pdfWelcome');
const pdfIframe = document.getElementById('pdfIframe');
const chatScopeBadge = document.getElementById('chatScopeBadge');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const openNewTabBtn = document.getElementById('openNewTabBtn');

// Initialize Lucide Icons & App
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchDocuments();
    setupEventListeners();
    updateUploadButtonState();
    resetWorkspace(); // Load global chat history on startup

    // Bind pagehide window close cleanup beacon
    window.addEventListener('pagehide', () => {
        navigator.sendBeacon(`/api/session/clear?q_session_id=${sessionId}`);
    });
});

// Setup Event Handlers
function setupEventListeners() {
    // Sidebar collapse toggle
    if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Drag and Drop Triggers
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragenter', handleDrag);
    dropZone.addEventListener('dragover', handleDrag);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);
    
    fileInput.addEventListener('change', handleFileSelect);

    // Document Upload Submission
    document.getElementById('uploadForm').addEventListener('submit', handleUploadSubmit);

    // Chat Form Submission
    chatForm.addEventListener('submit', handleChatSubmit);

    // Chat input state checker
    chatInput.addEventListener('input', () => {
        sendBtn.disabled = !chatInput.value.trim() || chatting;
    });
}

// Drag & Drop Handlers
function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-active');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-active');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-active');
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
    }
}

function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
    }
}

function addFiles(filesList) {
    const pdfs = Array.from(filesList).filter(file => file.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
        alert("Only PDF files are supported.");
        return;
    }
    
    // Add unique files only
    pdfs.forEach(newFile => {
        if (!selectedFiles.some(f => f.name === newFile.name && f.size === newFile.size)) {
            selectedFiles.push(newFile);
        }
    });

    renderSelectedFiles();
    updateUploadButtonState();
}

function removeSelectedFile(index) {
    selectedFiles = selectedFiles.filter((_, idx) => idx !== index);
    renderSelectedFiles();
    updateUploadButtonState();
}

function updateUploadButtonState() {
    uploadBtn.disabled = selectedFiles.length === 0 || uploading;
}

// Render Preview Selected Files
function renderSelectedFiles() {
    filePreviewList.innerHTML = '';
    selectedFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        item.innerHTML = `
            <div class="file-info">
                <i data-lucide="file-text" style="width:12px; height:12px; color:var(--indigo);"></i>
                <span class="file-name" title="${file.name}">${file.name}</span>
                <span style="color:var(--text-muted);">(${formatBytes(file.size, 1)})</span>
            </div>
            <div class="file-remove" onclick="removeSelectedFile(${idx})">
                <i data-lucide="x" style="width:12px; height:12px;"></i>
            </div>
        `;
        filePreviewList.appendChild(item);
    });
    lucide.createIcons();
}

// Handle HTTP Upload Submission
async function handleUploadSubmit(e) {
    e.preventDefault();
    if (selectedFiles.length === 0 || uploading) return;

    uploading = true;
    updateUploadButtonState();
    
    const originalBtnHTML = uploadBtn.innerHTML;
    uploadBtn.innerHTML = `<i data-lucide="loader-2" class="animate-pulse" style="animation: spin 1.5s linear infinite;"></i><span>Uploading PDFs...</span>`;
    lucide.createIcons();

    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });

    try {
        const res = await fetch(`/api/upload?q_session_id=${sessionId}`, {
            method: 'POST',
            headers: { 'Session-ID': sessionId },
            body: formData
        });

        if (!res.ok) {
            const data = await res.json();
            let errMsg = 'Upload failed';
            if (data && data.detail) {
                if (Array.isArray(data.detail)) {
                    errMsg = data.detail.map(d => `${d.loc.join('.')}: ${d.msg}`).join(', ');
                } else {
                    errMsg = data.detail;
                }
            }
            throw new Error(errMsg);
        }

        selectedFiles = [];
        renderSelectedFiles();
        await fetchDocuments();
    } catch (err) {
        console.error(err);
        alert('Upload failed: ' + err.message);
    } finally {
        uploading = false;
        uploadBtn.innerHTML = originalBtnHTML;
        updateUploadButtonState();
        lucide.createIcons();
    }
}

// Fetch Document List from API
async function fetchDocuments() {
    try {
        const res = await fetch(`/api/documents?q_session_id=${sessionId}`, {
            headers: { 'Session-ID': sessionId }
        });
        if (!res.ok) throw new Error('Failed to load documents');
        
        documentsList = await res.json();
        docCountBadge.innerText = documentsList.length;
        renderDocumentList();
    } catch (err) {
        console.error(err);
    }
}

// Render Document Catalog Cards
function renderDocumentList() {
    docList.innerHTML = '';
    
    if (documentsList.length === 0) {
        docList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="folder-open" style="width:24px; height:24px;"></i>
                <p>No documents found.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Prepend the Global Chat Card
    const globalCard = document.createElement('div');
    const isGlobalSelected = activeDocId === null;
    globalCard.className = `doc-card global-card ${isGlobalSelected ? 'active' : ''}`;
    globalCard.onclick = () => resetWorkspace();
    globalCard.innerHTML = `
        <div class="doc-card-top">
            <div class="doc-card-info">
                <i data-lucide="globe" class="doc-card-icon" style="width:16px; height:16px;"></i>
                <span class="doc-card-title">All Documents (Global Search)</span>
            </div>
        </div>
        <div class="doc-card-meta">
            Query across all ${documentsList.length} files simultaneously
        </div>
    `;
    docList.appendChild(globalCard);

    documentsList.forEach(doc => {
        const isSelected = doc.id === activeDocId;
        const card = document.createElement('div');
        card.className = `doc-card ${isSelected ? 'active' : ''}`;
        
        card.innerHTML = `
            <div class="doc-card-top" onclick="setActiveDocument('${doc.id}')">
                <div class="doc-card-info">
                    <i data-lucide="file-text" class="doc-card-icon" style="width:16px; height:16px;"></i>
                    <span class="doc-card-title" title="${doc.filename}">${doc.filename}</span>
                </div>
                <button class="doc-card-delete-btn" onclick="toggleDeleteConfirm(event, '${doc.id}')">
                    <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                </button>
            </div>
            <div onclick="setActiveDocument('${doc.id}')" class="doc-card-meta">
                ${formatBytes(doc.size, 1)} • ${new Date(doc.upload_date).toLocaleDateString()}
            </div>
            
            ${deletingDocId === doc.id ? `
                <div class="delete-confirm-box">
                    <span>Delete document & chat history?</span>
                    <div class="delete-confirm-actions">
                        <button class="btn-delete-confirm" onclick="confirmDelete(event, '${doc.id}')">Delete</button>
                        <button class="btn-delete-cancel" onclick="toggleDeleteConfirm(event, null)">Cancel</button>
                    </div>
                </div>
            ` : ''}
        `;
        
        docList.appendChild(card);
    });
    
    lucide.createIcons();
}

function toggleDeleteConfirm(e, docId) {
    e.stopPropagation();
    deletingDocId = docId;
    renderDocumentList();
}

async function confirmDelete(e, docId) {
    e.stopPropagation();
    try {
        const res = await fetch(`/api/documents/${docId}?q_session_id=${sessionId}`, { 
            method: 'DELETE',
            headers: { 'Session-ID': sessionId }
        });
        if (!res.ok) throw new Error('Deletion failed');
        
        deletingDocId = null;
        if (activeDocId === docId) {
            activeDocId = null;
            resetWorkspace();
        }
        await fetchDocuments();
        
        // Document deleted
    } catch (err) {
        console.error(err);
        alert('Delete failed: ' + err.message);
    }
}

// Select and Load Document into workspace
function setActiveDocument(docId) {
    if (activeDocId === docId) return;
    
    activeDocId = docId;
    renderDocumentList(); // Refresh selected states
    
    const activeDoc = documentsList.find(d => d.id === docId);
    if (!activeDoc) return;

    // Load active title
    activeDocTitle.innerText = activeDoc.filename;
    chatScopeBadge.innerText = "Specific Document scope";

    const docFileUrl = `/api/documents/${docId}/file?q_session_id=${sessionId}`;

    // Configure open in new tab button
    if (openNewTabBtn) {
        openNewTabBtn.href = docFileUrl;
        openNewTabBtn.style.display = 'flex';
    }

    // Set side-by-side iframe source (pass session id in query param for GET request verification)
    pdfWelcome.style.display = 'none';
    pdfIframe.style.display = 'block';
    pdfIframe.src = docFileUrl;

    // Clear chat logs
    clearChatLog();
    renderChatWelcome();
}

function resetWorkspace() {
    activeDocTitle.innerText = "Select a Document";
    chatScopeBadge.innerText = "Global Scope";
    pdfWelcome.style.display = 'flex';
    pdfIframe.style.display = 'none';
    pdfIframe.src = '';
    
    if (openNewTabBtn) {
        openNewTabBtn.href = '';
        openNewTabBtn.style.display = 'none';
    }
    
    clearChatLog();
    renderChatWelcome();
}

function clearChatLog() {
    chatLog.innerHTML = '';
}

function renderChatWelcome() {
    const scopeName = activeDocId ? "this document" : "your document library";
    chatLog.innerHTML = `
        <div class="chat-welcome">
            <div class="bot-bubble-icon">
                <i data-lucide="bot" style="width:24px; height:24px;"></i>
            </div>
            <h3>How can I help you today?</h3>
            <p>Ask a question about ${scopeName}. I will extract matching blocks and explain them immediately.</p>
        </div>
    `;
    lucide.createIcons();
}

// HTML Message Bubble Prepender
function appendMessageBubble(role, content, sources) {
    // Clear welcome message if present
    const welcome = chatLog.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const row = document.createElement('div');
    row.className = `msg-row ${role === 'user' ? 'user' : 'ai'}`;
    
    // Parse simplified markdown (Bold strong / bullets / linebreaks)
    const formattedContent = parseSimpleMarkdown(content);

    let sourcesAccordion = '';
    if (sources && sources.length > 0) {
        sourcesAccordion = `
            <div class="citations-box">
                <details>
                    <summary><i data-lucide="info" style="width:10px; height:10px; display:inline-block; vertical-align:middle; margin-right:4px;"></i>Retrieved Paragraph Context (${sources.length})</summary>
                    <div class="citations-list">
                        ${sources.map(src => {
                            const text = typeof src === 'object' ? src.content : src;
                            const filename = typeof src === 'object' ? src.filename : 'Document';
                            return `<p class="citation-item"><strong>[${escapeHtml(filename)}]</strong> "...${escapeHtml(text)}..."</p>`;
                        }).join('')}
                    </div>
                </details>
            </div>
        `;
    }

    row.innerHTML = `
        <div class="msg-avatar">
            <i data-lucide="${role === 'user' ? 'user' : 'bot'}" style="width:16px; height:16px;"></i>
        </div>
        <div class="msg-bubble">
            <div class="bubble-markdown">${formattedContent}</div>
            ${sourcesAccordion}
        </div>
    `;

    chatLog.appendChild(row);
    lucide.createIcons();

    // Trigger KaTeX rendering to display beautiful math equations natively
    if (window.renderMathInElement) {
        try {
            window.renderMathInElement(row, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false},
                    {left: "\\[", right: "\\]", display: true}
                ],
                throwOnError: false
            });
        } catch (mathErr) {
            console.error('KaTeX rendering error:', mathErr);
        }
    }
}

// Send Message Submission Handler
async function handleChatSubmit(e) {
    e.preventDefault();
    if (!chatInput.value.trim() || chatting) return;

    const query = chatInput.value;
    chatInput.value = '';
    chatting = true;
    sendBtn.disabled = true;

    // Append User bubble
    appendMessageBubble('user', query);
    scrollChatToBottom();

    // Setup Typing indicator
    const loaderRow = document.createElement('div');
    loaderRow.className = 'msg-row ai animate-pulse';
    loaderRow.id = 'chatTypingLoader';
    loaderRow.innerHTML = `
        <div class="msg-avatar">
            <i data-lucide="bot" style="width:16px; height:16px;"></i>
        </div>
        <div class="msg-bubble" style="border-top-left-radius:0;">
            <div class="typing-loader">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    chatLog.appendChild(loaderRow);
    lucide.createIcons();
    scrollChatToBottom();

    try {
        const payload = { 
            message: query,
            session_id: sessionId
        };
        if (activeDocId) payload.doc_id = activeDocId;

        const res = await fetch(`/api/chat?q_session_id=${sessionId}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Session-ID': sessionId
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('API communication failure');
        const reply = await res.json();
        
        // Remove typing indicator loader
        const loader = document.getElementById('chatTypingLoader');
        if (loader) loader.remove();

        appendMessageBubble('ai', reply.answer, reply.sources);
        
        scrollChatToBottom();
    } catch (err) {
        console.error(err);
        const loader = document.getElementById('chatTypingLoader');
        if (loader) loader.remove();
        
        appendMessageBubble('ai', "I encountered an error trying to process that question. Please make sure that EITHER your Google Gemini API Key OR your free Hugging Face API Token is configured in `backend/.env`.");
        scrollChatToBottom();
    } finally {
        chatting = false;
        sendBtn.disabled = !chatInput.value.trim();
    }
}

function scrollChatToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Utility Formatting Functions
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function parseSimpleMarkdown(text) {
    const mathBlocks = [];
    let placeholderCounter = 0;

    // Helper to store math and return a placeholder
    const storeMath = (match) => {
        const id = `___MATH_PLACEHOLDER_${placeholderCounter++}___`;
        mathBlocks.push({ id, original: match });
        return id;
    };

    // Extract block math $$...$$
    let processedText = text.replace(/\$\$([\s\S]*?)\$\$/g, storeMath);
    // Extract block math \[...\]
    processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, storeMath);
    // Extract inline math \(...\)
    processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, storeMath);
    // Extract inline math $...$
    processedText = processedText.replace(/\$([^\$\n]+?)\$/g, storeMath);

    // Now escape HTML and parse simple markdown on the remaining text
    let escaped = escapeHtml(processedText);
    
    // Parse Bold: **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Parse lists starting with * or - at newline boundaries
    escaped = escaped.replace(/(?:^|\n)[*\-]\s+(.*?)(?=\n|$)/g, '\n<li>$1</li>');
    
    // Wrap lists in <ul> tags
    escaped = escaped.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
    
    // Parse linebreaks into paragraph blocks
    const paras = escaped.split(/\n\n+/);
    const parsed = paras.map(p => {
        if (p.trim().startsWith('<ul>') || p.trim().startsWith('<li>') || p.trim().startsWith('___MATH_PLACEHOLDER_')) return p.trim();
        return `<p>${p.trim().replace(/\n/g, '<br>')}</p>`;
    });

    let result = parsed.join('');

    // Restore math blocks
    mathBlocks.forEach(item => {
        result = result.replace(item.id, item.original);
    });

    return result;
}

// Local Chat History Helpers Removed
