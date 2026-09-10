/* StandardMatch AI - Deep Blue Header (#0A2540) & Clean White Canvas Theme JS Logic */

document.addEventListener('DOMContentLoaded', () => {
    fetchDatasetCount();
    loadGemTenders();
    setupDragAndDrop(); // Initialize Interactive Drag & Drop
});

function toggleSection(target) {
    const heroSec = document.getElementById('hero-section');
    const dashSec = document.getElementById('dashboard-section');

    if (target === 'dashboard') {
        heroSec.classList.add('hidden');
        dashSec.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        dashSec.classList.remove('active');
        heroSec.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function scrollToFeatures() {
    const featuresGrid = document.getElementById('features-grid');
    if (featuresGrid) {
        featuresGrid.scrollIntoView({ behavior: 'smooth' });
    }
}

function updateThresholdLabel(val) {
    const label = document.getElementById('threshold-val');
    if (label) {
        label.textContent = `${parseFloat(val).toFixed(1)}%`;
    }
}

function clearSearch() {
    document.getElementById('query-input').value = '';
    const container = document.getElementById('results-container');
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon"><i class="fa-solid fa-compass-drafting"></i></div>
            <div class="empty-title">Ready for Specification & GeM Analysis</div>
            <div class="empty-desc">
                StandardMatch AI uses TF-IDF Vectorization to recommend official Bureau of Indian Standards matching your tender query or GeM Bid specifications.
            </div>
        </div>
    `;
    document.getElementById('results-title').textContent = 'Matched Standards';
    document.getElementById('results-subtitle').textContent = 'Enter procurement specifications on the left to compute cosine similarity scores.';
    document.getElementById('results-meta').innerHTML = '';
}

function quickSearch(presetText) {
    toggleSection('dashboard');
    const input = document.getElementById('query-input');
    input.value = presetText;

    setTimeout(() => {
        document.getElementById('recommend-form').dispatchEvent(new Event('submit'));
    }, 200);
}

function loadPresetQuery(val) {
    if (val) {
        document.getElementById('query-input').value = val;
    }
}

async function fetchDatasetCount() {
    try {
        const response = await fetch('/standards');
        const data = await response.json();
        if (data.success) {
            const counterEl = document.getElementById('dataset-counter');
            if (counterEl) {
                counterEl.innerHTML = `<i class="fa-solid fa-database"></i> Indexed Standards: ${data.count}`;
            }
        }
    } catch (err) {
        console.error("Failed to fetch dataset count:", err);
    }
}

async function loadGemTenders() {
    const listEl = document.getElementById('gem-tenders-list');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center; padding:1rem; color:var(--text-dark-muted);"><div class="spinner" style="border-top-color: var(--gem-orange-hover); display:inline-block;"></div> Loading GeM Bids...</div>';

    try {
        const response = await fetch('/api/gem/tenders');
        const data = await response.json();

        if (!data.success || !data.tenders) {
            throw new Error(data.error || "Failed to load GeM tenders.");
        }

        let html = '';
        data.tenders.forEach(t => {
            html += `
                <div class="gem-mini-card">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="gem-bid-id"><i class="fa-solid fa-hashtag"></i> ${escapeHtml(t.gem_bid_id)}</span>
                        <span style="font-size:0.75rem; color:#C2410C; font-weight:800;">${escapeHtml(t.quantity)}</span>
                    </div>
                    <div class="gem-item-title">${escapeHtml(t.item_name)}</div>
                    <div class="gem-ministry-text"><i class="fa-solid fa-building"></i> ${escapeHtml(t.ministry)}</div>
                    <button class="btn-gem-match" onclick="matchGemTender('${escapeHtml(t.gem_bid_id)}')">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Match BIS Standard
                    </button>
                </div>
            `;
        });
        listEl.innerHTML = html;
    } catch (err) {
        listEl.innerHTML = `<div style="color:#ef4444; font-size:0.85rem; padding:0.5rem;">Error loading GeM Bids: ${escapeHtml(err.message)}</div>`;
    }
}

async function matchGemTender(gemBidId) {
    showToast(`Analyzing GeM Bid "${gemBidId}" against BIS Database...`);

    try {
        const response = await fetch('/api/gem/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gem_bid_id: gemBidId })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || "GeM tender matching failed.");
        }

        const tender = data.gem_bid;
        document.getElementById('query-input').value = `${tender.item_name} ${tender.specifications}`;

        renderResults({
            success: true,
            query: `GeM Tender ${tender.gem_bid_id}: ${tender.item_name}`,
            total_standards: 12,
            execution_time_ms: 1.2,
            matches: data.matches
        });

        showToast(`Found matching BIS standards for GeM Tender ${gemBidId}!`);

    } catch (err) {
        showToast(`GeM Match Error: ${err.message}`);
    }
}

async function handleSearch(e) {
    e.preventDefault();

    const queryInput = document.getElementById('query-input').value.trim();
    const thresholdVal = parseFloat(document.getElementById('threshold-slider').value) / 100;
    const topNVal = parseInt(document.getElementById('top-n-select').value, 10);

    if (!queryInput) {
        showToast("Please enter a procurement specification or tender query.");
        return;
    }

    const btnSubmit = document.getElementById('btn-search-submit');
    const btnText = document.getElementById('btn-search-text');
    const originalText = btnText.textContent;

    btnSubmit.disabled = true;
    btnText.innerHTML = '<div class="spinner"></div> Calculating Similarity...';

    try {
        const response = await fetch('/recommend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: queryInput,
                threshold: thresholdVal,
                top_n: topNVal
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to fetch recommendations');
        }

        renderResults(data);

    } catch (error) {
        console.error("Search Error:", error);
        showToast(`Error: ${error.message}`);
        renderErrorState(error.message);
    } finally {
        btnSubmit.disabled = false;
        btnText.textContent = originalText;
    }
}

function renderResults(data) {
    const container = document.getElementById('results-container');
    const matches = data.matches || [];

    document.getElementById('results-title').textContent = `Top ${matches.length} Recommended BIS Standards`;
    document.getElementById('results-subtitle').textContent = `Query: "${data.query.substring(0, 60)}${data.query.length > 60 ? '...' : ''}"`;

    const metaContainer = document.getElementById('results-meta');
    metaContainer.innerHTML = `
        <span><i class="fa-solid fa-bolt" style="color: var(--gem-orange-hover);"></i> ${data.execution_time_ms} ms</span>
        <span><i class="fa-solid fa-list"></i> ${data.total_standards} Total Standards</span>
    `;

    if (matches.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-magnifying-glass-minus"></i></div>
                <div class="empty-title">No Matching BIS Standards Found</div>
                <div class="empty-desc">
                    No standards matched your specification above the threshold score of ${(parseFloat(document.getElementById('threshold-slider').value)).toFixed(1)}%. Try lowering the threshold slider or adding more keywords.
                </div>
            </div>
        `;
        return;
    }

    const queryWords = data.query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    let html = '';
    matches.forEach((item, index) => {
        const percentageScore = (item.score * 100).toFixed(1) + '%';

        let highlightedDesc = escapeHtml(item.description);
        queryWords.forEach(word => {
            const regex = new RegExp(`\\b(${escapeRegExp(word)})\\b`, 'gi');
            highlightedDesc = highlightedDesc.replace(regex, '<span class="kw-highlight">$1</span>');
        });

        const gemSearchUrl = item.gem_search_url || `https://mkp.gem.gov.in/search?q=${encodeURIComponent(item.standard_number)}`;
        const gemClauseText = item.gem_clause || `GeM MANDATORY COMPLIANCE CLAUSE: Item offered under this tender must strictly conform to BIS ${item.standard_number} - '${item.title}'.`;

        html += `
            <div class="result-card" style="animation-delay: ${index * 0.1}s; opacity: 0;">
                <div class="card-top-row">
                    <div class="card-std-no">
                        <i class="fa-solid fa-bookmark" style="color: var(--gov-blue-header);"></i>
                        ${escapeHtml(item.standard_number)}
                    </div>
                    <div class="badge-score">
                        <i class="fa-solid fa-bullseye"></i> ${percentageScore} Match
                    </div>
                </div>

                <div class="card-badges">
                    <span class="badge-status">${escapeHtml(item.status)}</span>
                    <span class="badge-category">${escapeHtml(item.category)}</span>
                    <span class="badge-year">Year: ${escapeHtml(item.version_year)}</span>
                </div>

                <h3 class="card-title">${escapeHtml(item.title)}</h3>
                
                <div class="card-description">
                    ${highlightedDesc}
                </div>

                <div class="card-footer">
                    <div>
                        <span style="font-size: 0.78rem; color: var(--text-dark-muted);">Standard ID: </span>
                        <span class="std-id-code">${escapeHtml(item.standard_id)}</span>
                    </div>

                    <div class="card-actions-group">
                        <button class="btn-card-action" onclick="copyToClipboard('${escapeHtml(item.standard_number)}', '${escapeHtml(item.title)}')">
                            <i class="fa-regular fa-copy"></i> Copy BIS
                        </button>
                        
                        <a href="${gemSearchUrl}" target="_blank" class="btn-card-gem" title="Search for compatible products on Government e-Marketplace (GeM)">
                            <i class="fa-solid fa-store"></i> GeM Portal
                        </a>

                        <button class="btn-card-gem" onclick="copyGemClause(\`${escapeJsString(gemClauseText)}\`)">
                            <i class="fa-solid fa-file-contract"></i> Copy GeM Clause
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function copyGemClause(clauseText) {
    navigator.clipboard.writeText(clauseText).then(() => {
        showToast("GeM Mandatory Compliance Clause copied to clipboard!");
    }).catch(() => {
        showToast("Failed to copy GeM Clause.");
    });
}

function renderErrorState(msg) {
    const container = document.getElementById('results-container');
    container.innerHTML = `
        <div class="empty-state" style="border-color: #fca5a5; background: #fff5f5;">
            <div class="empty-icon" style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div class="empty-title" style="color: #991b1b;">Error Processing Recommendation</div>
            <div class="empty-desc" style="color: #b91c1c;">
                ${escapeHtml(msg)}
            </div>
        </div>
    `;
}

// SETUP DRAG AND DROP FUNCTIONALITY FOR INTERACTIVE UI
function setupDragAndDrop() {
    const dropZone = document.querySelector('.pdf-upload-box');
    const fileInput = document.getElementById('pdf-file-input');
    
    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        let dt = e.dataTransfer;
        let files = dt.files;

        if (files && files.length > 0) {
            if (files[0].type === "application/pdf" || files[0].name.toLowerCase().endsWith('.pdf')) {
                fileInput.files = files;
                updatePdfFileName(fileInput);
            } else {
                showToast("Invalid format. Please drop a valid PDF file.");
            }
        }
    }, false);
}

async function handlePdfUpload(e) {
    e.preventDefault();

    const fileInput = document.getElementById('pdf-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
        showToast("Please select a regulatory PDF file first.");
        return;
    }

    const btnUpload = document.getElementById('btn-pdf-upload');
    const originalText = btnUpload.innerHTML;
    btnUpload.disabled = true;
    btnUpload.innerHTML = '<div class="spinner"></div> Parsing PDF Extracting Text...';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('standard_number', document.getElementById('pdf-std-no').value);
    formData.append('title', document.getElementById('pdf-title').value);

    try {
        const response = await fetch('/upload_pdf', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to upload PDF');
        }

        showToast("PDF ingested & indexed successfully!");
        document.getElementById('pdf-upload-form').reset();
        document.getElementById('pdf-file-label').textContent = "Click or Drag PDF standard here";

        await fetchDatasetCount();
        if (data.entry && data.entry.standard_number) {
            quickSearch(data.entry.standard_number + " " + data.entry.title);
        }

    } catch (err) {
        showToast(`PDF Upload Error: ${err.message}`);
    } finally {
        btnUpload.disabled = false;
        btnUpload.innerHTML = originalText;
    }
}

function updatePdfFileName(input) {
    if (input.files && input.files[0]) {
        document.getElementById('pdf-file-label').textContent = `Selected: ${input.files[0].name}`;
    }
}

function copyToClipboard(stdNo, title) {
    const text = `${stdNo} - ${title}`;
    navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied "${stdNo}" to clipboard!`);
    }).catch(() => {
        showToast(`Failed to copy`);
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    msgEl.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${');
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}