/**
 * Privacy-First PDF Compressor
 * 100% Client-Side PDF Compression using pdf.js and jsPDF
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global state
const state = {
    file: null,
    compressedBlob: null,
    originalSize: 0,
    compressedSize: 0,
    isProcessing: false
};

// DOM Elements
const elements = {
    themeToggle: document.getElementById('themeToggle'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.getElementById('fileInfo'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    removeFile: document.getElementById('removeFile'),
    settingsPanel: document.getElementById('settingsPanel'),
    qualitySlider: document.getElementById('qualitySlider'),
    qualityValue: document.getElementById('qualityValue'),
    dpiSelect: document.getElementById('dpiSelect'),
    compressBtn: document.getElementById('compressBtn'),
    progressSection: document.getElementById('progressSection'),
    progressText: document.getElementById('progressText'),
    progressFill: document.getElementById('progressFill'),
    resultsSection: document.getElementById('resultsSection'),
    originalSize: document.getElementById('originalSize'),
    compressedSize: document.getElementById('compressedSize'),
    savingsBadge: document.getElementById('savingsBadge'),
    downloadBtn: document.getElementById('downloadBtn'),
    newFileBtn: document.getElementById('newFileBtn'),
    renderCanvas: document.getElementById('renderCanvas')
};

// ========================================
// Theme Management
// ========================================
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

// ========================================
// Utility Functions
// ========================================
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getQualityLabel(value) {
    if (value <= 30) return 'Maximum Compression';
    if (value <= 50) return 'Medium';
    if (value <= 65) return 'High';
    return 'Best Quality';
}

function updateQualityLabel() {
    const value = parseInt(elements.qualitySlider.value);
    elements.qualityValue.textContent = `${getQualityLabel(value)} (${value}%)`;
}

// ========================================
// File Handling
// ========================================
function handleFileSelect(file) {
    if (!file || file.type !== 'application/pdf') {
        alert('Please select a valid PDF file.');
        return;
    }

    if (file.size > 100 * 1024 * 1024) { // 100MB limit
        alert('File size exceeds 100MB limit.');
        return;
    }

    state.file = file;
    state.originalSize = file.size;

    // Update UI
    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatFileSize(file.size);

    elements.dropZone.classList.add('hidden');
    elements.fileInfo.classList.remove('hidden');
    elements.settingsPanel.classList.remove('hidden');
    elements.resultsSection.classList.add('hidden');
}

function removeFile() {
    state.file = null;
    state.compressedBlob = null;
    state.originalSize = 0;
    state.compressedSize = 0;

    elements.fileInput.value = '';
    elements.dropZone.classList.remove('hidden');
    elements.fileInfo.classList.add('hidden');
    elements.settingsPanel.classList.add('hidden');
    elements.progressSection.classList.add('hidden');
    elements.resultsSection.classList.add('hidden');
}

// ========================================
// Drag & Drop
// ========================================
function initDragDrop() {
    const dropZone = elements.dropZone;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
    dropZone.addEventListener('click', () => elements.fileInput.click());
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
}

// ========================================
// PDF Compression
// ========================================
async function compressPDF() {
    if (!state.file || state.isProcessing) return;

    state.isProcessing = true;
    const quality = parseInt(elements.qualitySlider.value) / 100;
    const dpi = parseInt(elements.dpiSelect.value);

    // Use a much more aggressive scale for actual compression
    // Lower scale = smaller canvas = smaller image = smaller PDF
    const baseScale = dpi / 150; // Use 150 as reference instead of 72
    const compressionFactor = 0.7; // Additional reduction factor
    const scale = baseScale * compressionFactor;

    // Show progress, hide settings
    elements.settingsPanel.classList.add('hidden');
    elements.progressSection.classList.remove('hidden');
    elements.compressBtn.disabled = true;

    try {
        // Read file as ArrayBuffer
        const arrayBuffer = await state.file.arrayBuffer();

        // Load PDF with pdf.js
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;

        // Initialize jsPDF
        const { jsPDF } = window.jspdf;
        let jspdfDoc = null;

        const canvas = elements.renderCanvas;
        const ctx = canvas.getContext('2d');

        // Process each page
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            // Update progress
            elements.progressText.textContent = `Processing page ${pageNum} of ${numPages}...`;
            elements.progressFill.style.width = `${(pageNum / numPages) * 100}%`;

            // Give UI time to update
            await new Promise(resolve => setTimeout(resolve, 10));

            // Get page
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });

            // Set canvas dimensions
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Render page to canvas
            await page.render({
                canvasContext: ctx,
                viewport: viewport
            }).promise;

            // Convert canvas to JPEG data URL
            const imageData = canvas.toDataURL('image/jpeg', quality);

            // Calculate dimensions in mm for jsPDF (assuming 25.4mm per inch)
            const widthMM = (viewport.width / dpi) * 25.4;
            const heightMM = (viewport.height / dpi) * 25.4;

            // Add page to jsPDF
            if (pageNum === 1) {
                jspdfDoc = new jsPDF({
                    orientation: widthMM > heightMM ? 'landscape' : 'portrait',
                    unit: 'mm',
                    format: [widthMM, heightMM]
                });
            } else {
                jspdfDoc.addPage([widthMM, heightMM], widthMM > heightMM ? 'landscape' : 'portrait');
            }

            jspdfDoc.addImage(imageData, 'JPEG', 0, 0, widthMM, heightMM);

            // Clear canvas for memory management
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Generate compressed PDF blob
        state.compressedBlob = jspdfDoc.output('blob');
        state.compressedSize = state.compressedBlob.size;

        // Show results
        showResults();
    } catch (error) {
        console.error('Compression error:', error);
        alert('An error occurred while compressing the PDF. Please try again.');
        removeFile();
    } finally {
        state.isProcessing = false;
        elements.compressBtn.disabled = false;
    }
}

function showResults() {
    elements.progressSection.classList.add('hidden');
    elements.resultsSection.classList.remove('hidden');

    elements.originalSize.textContent = formatFileSize(state.originalSize);
    elements.compressedSize.textContent = formatFileSize(state.compressedSize);

    const savings = ((1 - state.compressedSize / state.originalSize) * 100).toFixed(0);

    if (savings > 0) {
        elements.savingsBadge.innerHTML = `<span>${savings}% smaller</span>`;
        elements.savingsBadge.style.background = 'var(--accent-gradient)';
    } else {
        const increase = Math.abs(savings);
        elements.savingsBadge.innerHTML = `<span>${increase}% larger</span>`;
        elements.savingsBadge.style.background = 'var(--warning-color)';
    }
}

function downloadCompressed() {
    if (!state.compressedBlob) return;

    const originalName = state.file.name.replace('.pdf', '');
    const fileName = `${originalName}_compressed.pdf`;

    const url = URL.createObjectURL(state.compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function startNew() {
    removeFile();
}

// ========================================
// Event Listeners
// ========================================
function initEventListeners() {
    // Theme toggle
    elements.themeToggle.addEventListener('click', toggleTheme);

    // File input
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Remove file
    elements.removeFile.addEventListener('click', removeFile);

    // Quality slider
    elements.qualitySlider.addEventListener('input', updateQualityLabel);

    // Compress button
    elements.compressBtn.addEventListener('click', compressPDF);

    // Download button
    elements.downloadBtn.addEventListener('click', downloadCompressed);

    // New file button
    elements.newFileBtn.addEventListener('click', startNew);
}

// ========================================
// Initialize App
// ========================================
function init() {
    initTheme();
    initDragDrop();
    initEventListeners();
    updateQualityLabel();
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
