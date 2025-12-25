/**
 * Privacy-First PDF Tools
 * 100% Client-Side PDF Compression and Image to PDF Conversion
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ========================================
// Global State
// ========================================
const state = {
    // PDF Compression
    file: null,
    compressedBlob: null,
    originalSize: 0,
    compressedSize: 0,
    isProcessing: false,

    // Image to PDF
    images: [],
    imagePdfBlob: null,

    // Preview
    previewPdf: null,
    currentPage: 1,
    totalPages: 1
};

// ========================================
// DOM Elements
// ========================================
const elements = {
    // Theme
    themeToggle: document.getElementById('themeToggle'),

    // Tabs
    tabBtns: document.querySelectorAll('.tab-btn'),
    compressTab: document.getElementById('compressTab'),
    imagesTab: document.getElementById('imagesTab'),

    // PDF Compression
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.getElementById('fileInfo'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    removeFile: document.getElementById('removeFile'),
    settingsPanel: document.getElementById('settingsPanel'),
    compressionMode: document.getElementById('compressionMode'),
    modeHint: document.getElementById('modeHint'),
    qualityGroup: document.getElementById('qualityGroup'),
    dpiGroup: document.getElementById('dpiGroup'),
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
    resultTip: document.getElementById('resultTip'),
    previewBtn: document.getElementById('previewBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    newFileBtn: document.getElementById('newFileBtn'),
    renderCanvas: document.getElementById('renderCanvas'),

    // Image to PDF
    imageDropZone: document.getElementById('imageDropZone'),
    imageInput: document.getElementById('imageInput'),
    imageList: document.getElementById('imageList'),
    imageCount: document.getElementById('imageCount'),
    imageGrid: document.getElementById('imageGrid'),
    addMoreBtn: document.getElementById('addMoreBtn'),
    imgQualitySlider: document.getElementById('imgQualitySlider'),
    imgQualityValue: document.getElementById('imgQualityValue'),
    pageSizeSelect: document.getElementById('pageSizeSelect'),
    createPdfBtn: document.getElementById('createPdfBtn'),
    clearImagesBtn: document.getElementById('clearImagesBtn'),
    imageProgressSection: document.getElementById('imageProgressSection'),
    imageProgressText: document.getElementById('imageProgressText'),
    imageProgressFill: document.getElementById('imageProgressFill'),
    imageResultsSection: document.getElementById('imageResultsSection'),
    imagePdfSize: document.getElementById('imagePdfSize'),
    imagePreviewBtn: document.getElementById('imagePreviewBtn'),
    imageDownloadBtn: document.getElementById('imageDownloadBtn'),
    imageNewBtn: document.getElementById('imageNewBtn'),

    // Modal
    previewModal: document.getElementById('previewModal'),
    modalOverlay: document.getElementById('modalOverlay'),
    closeModal: document.getElementById('closeModal'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageIndicator: document.getElementById('pageIndicator'),
    previewCanvas: document.getElementById('previewCanvas')
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
// Tab Navigation
// ========================================
function initTabs() {
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // Update active tab button
            elements.tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show corresponding content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            if (tabName === 'compress') {
                elements.compressTab.classList.add('active');
            } else if (tabName === 'images') {
                elements.imagesTab.classList.add('active');
            }
        });
    });
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
    if (value <= 50) return 'Maximum Compression';
    if (value <= 65) return 'Balanced';
    if (value <= 80) return 'Good Quality';
    return 'High Quality';
}

function updateQualityLabel() {
    const value = parseInt(elements.qualitySlider.value);
    elements.qualityValue.textContent = `${getQualityLabel(value)} (${value}%)`;
}

function updateImgQualityLabel() {
    const value = parseInt(elements.imgQualitySlider.value);
    elements.imgQualityValue.textContent = `${getQualityLabel(value)} (${value}%)`;
}

function updateCompressionMode() {
    const mode = elements.compressionMode.value;
    const isLossy = mode === 'lossy';

    // Show/hide lossy-specific options
    elements.qualityGroup.classList.toggle('hidden', !isLossy);
    elements.dpiGroup.classList.toggle('hidden', !isLossy);

    // Update hint text
    if (isLossy) {
        elements.modeHint.textContent = 'Converts pages to images. Maximum compression but may reduce text clarity.';
    } else {
        elements.modeHint.textContent = 'Optimizes PDF structure without converting to images. Best for text-heavy PDFs.';
    }
}

// ========================================
// PDF Compression - File Handling
// ========================================
function handleFileSelect(file) {
    if (!file || file.type !== 'application/pdf') {
        alert('Please select a valid PDF file.');
        return;
    }

    if (file.size > 100 * 1024 * 1024) {
        alert('File size exceeds 100MB limit.');
        return;
    }

    state.file = file;
    state.originalSize = file.size;

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
// Drag & Drop for PDF
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
    const mode = elements.compressionMode.value;

    elements.settingsPanel.classList.add('hidden');
    elements.progressSection.classList.remove('hidden');
    elements.compressBtn.disabled = true;

    try {
        if (mode === 'lossless') {
            await compressLossless();
        } else {
            await compressLossy();
        }
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

// Lossless compression using pdf-lib
async function compressLossless() {
    elements.progressText.textContent = 'Optimizing PDF structure...';
    elements.progressFill.style.width = '20%';

    const arrayBuffer = await state.file.arrayBuffer();

    elements.progressText.textContent = 'Loading document...';
    elements.progressFill.style.width = '40%';

    // Load with pdf-lib
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
        updateMetadata: false
    });

    elements.progressText.textContent = 'Removing unused objects...';
    elements.progressFill.style.width = '60%';
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get page count for progress
    const pageCount = pdfDoc.getPageCount();

    elements.progressText.textContent = `Compressing ${pageCount} pages...`;
    elements.progressFill.style.width = '80%';

    // Save with optimization options
    const compressedBytes = await pdfDoc.save({
        useObjectStreams: true,      // Compress objects into streams
        addDefaultPage: false,
        objectsPerTick: 50
    });

    elements.progressText.textContent = 'Finalizing...';
    elements.progressFill.style.width = '100%';

    state.compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });
    state.compressedSize = state.compressedBlob.size;
}

// Lossy compression (image-based)
async function compressLossy() {
    const quality = parseInt(elements.qualitySlider.value) / 100;
    const dpi = parseInt(elements.dpiSelect.value);
    const renderScale = dpi / 72;

    const arrayBuffer = await state.file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    const { jsPDF } = window.jspdf;
    let jspdfDoc = null;

    const canvas = elements.renderCanvas;
    const ctx = canvas.getContext('2d');

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        elements.progressText.textContent = `Processing page ${pageNum} of ${numPages}...`;
        elements.progressFill.style.width = `${(pageNum / numPages) * 100}%`;

        await new Promise(resolve => setTimeout(resolve, 10));

        const page = await pdf.getPage(pageNum);

        const originalViewport = page.getViewport({ scale: 1.0 });
        const renderViewport = page.getViewport({ scale: renderScale });

        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        await page.render({
            canvasContext: ctx,
            viewport: renderViewport
        }).promise;

        const imageData = canvas.toDataURL('image/jpeg', quality);

        const widthPt = originalViewport.width;
        const heightPt = originalViewport.height;
        const widthMM = (widthPt / 72) * 25.4;
        const heightMM = (heightPt / 72) * 25.4;

        if (pageNum === 1) {
            jspdfDoc = new jsPDF({
                orientation: widthMM > heightMM ? 'landscape' : 'portrait',
                unit: 'mm',
                format: [widthMM, heightMM],
                compress: true
            });
        } else {
            jspdfDoc.addPage([widthMM, heightMM], widthMM > heightMM ? 'landscape' : 'portrait');
        }

        jspdfDoc.addImage(imageData, 'JPEG', 0, 0, widthMM, heightMM, undefined, 'FAST');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    state.compressedBlob = jspdfDoc.output('blob');
    state.compressedSize = state.compressedBlob.size;
}

function showResults() {
    elements.progressSection.classList.add('hidden');
    elements.resultsSection.classList.remove('hidden');

    elements.originalSize.textContent = formatFileSize(state.originalSize);
    elements.compressedSize.textContent = formatFileSize(state.compressedSize);

    const savings = ((1 - state.compressedSize / state.originalSize) * 100).toFixed(0);
    const mode = elements.compressionMode.value;

    // Reset tip
    elements.resultTip.classList.add('hidden');
    elements.resultTip.textContent = '';

    if (savings > 0) {
        elements.savingsBadge.innerHTML = `<span>${savings}% smaller</span>`;
        elements.savingsBadge.style.background = 'var(--accent-gradient)';
    } else {
        const increase = Math.abs(savings);
        elements.savingsBadge.innerHTML = `<span>${increase}% larger</span>`;
        elements.savingsBadge.style.background = 'var(--warning-color)';

        // Show helpful tip message
        elements.resultTip.classList.remove('hidden');
        if (mode === 'lossy') {
            elements.resultTip.textContent = '💡 Tip: File got larger because the original PDF likely contains vector text/graphics which are more compact than images. Try "Lossless" mode instead, or use 72 DPI for maximum compression.';
        } else {
            elements.resultTip.textContent = '💡 Tip: This PDF is already well-optimized. Try "Lossy" mode with 72 DPI for maximum compression, but note this converts text to images and may reduce clarity.';
        }
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
// Image to PDF - Image Handling
// ========================================
function initImageDragDrop() {
    const dropZone = elements.imageDropZone;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleImageDrop, false);
    dropZone.addEventListener('click', () => elements.imageInput.click());
}

function handleImageDrop(e) {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files).filter(f => f.type.startsWith('image/'));
    addImages(files);
}

function handleImageSelect(e) {
    const files = Array.from(e.target.files);
    addImages(files);
    e.target.value = '';
}

function addImages(files) {
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            state.images.push({
                file: file,
                dataUrl: e.target.result,
                name: file.name
            });
            updateImageGrid();
        };
        reader.readAsDataURL(file);
    });
}

function updateImageGrid() {
    elements.imageGrid.innerHTML = '';
    elements.imageCount.textContent = state.images.length;

    if (state.images.length === 0) {
        elements.imageDropZone.classList.remove('hidden');
        elements.imageList.classList.add('hidden');
        elements.imageResultsSection.classList.add('hidden');
        return;
    }

    elements.imageDropZone.classList.add('hidden');
    elements.imageList.classList.remove('hidden');

    state.images.forEach((img, index) => {
        const item = document.createElement('div');
        item.className = 'image-item';
        item.draggable = true;
        item.dataset.index = index;

        item.innerHTML = `
            <img src="${img.dataUrl}" alt="${img.name}">
            <span class="image-number">${index + 1}</span>
            <button class="remove-image" onclick="removeImage(${index})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        // Drag events for reordering
        item.addEventListener('dragstart', handleImageDragStart);
        item.addEventListener('dragover', handleImageDragOver);
        item.addEventListener('drop', handleImageDropReorder);
        item.addEventListener('dragend', handleImageDragEnd);

        elements.imageGrid.appendChild(item);
    });
}

let draggedImageIndex = null;

function handleImageDragStart(e) {
    draggedImageIndex = parseInt(e.target.dataset.index);
    e.target.classList.add('dragging');
}

function handleImageDragOver(e) {
    e.preventDefault();
}

function handleImageDropReorder(e) {
    e.preventDefault();
    const targetIndex = parseInt(e.currentTarget.dataset.index);

    if (draggedImageIndex !== null && draggedImageIndex !== targetIndex) {
        const [removed] = state.images.splice(draggedImageIndex, 1);
        state.images.splice(targetIndex, 0, removed);
        updateImageGrid();
    }
}

function handleImageDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedImageIndex = null;
}

function removeImage(index) {
    state.images.splice(index, 1);
    updateImageGrid();
}

function clearAllImages() {
    state.images = [];
    state.imagePdfBlob = null;
    updateImageGrid();
}

// ========================================
// Create PDF from Images
// ========================================
async function createPdfFromImages() {
    if (state.images.length === 0 || state.isProcessing) return;

    state.isProcessing = true;
    const quality = parseInt(elements.imgQualitySlider.value) / 100;
    const pageSize = elements.pageSizeSelect.value;

    elements.imageList.classList.add('hidden');
    elements.imageProgressSection.classList.remove('hidden');

    try {
        const { jsPDF } = window.jspdf;
        let jspdfDoc = null;

        // Page dimensions in mm
        const pageSizes = {
            a4: { width: 210, height: 297 },
            letter: { width: 215.9, height: 279.4 },
            legal: { width: 215.9, height: 355.6 }
        };

        for (let i = 0; i < state.images.length; i++) {
            elements.imageProgressText.textContent = `Processing image ${i + 1} of ${state.images.length}...`;
            elements.imageProgressFill.style.width = `${((i + 1) / state.images.length) * 100}%`;

            await new Promise(resolve => setTimeout(resolve, 10));

            const img = state.images[i];

            // Load image to get dimensions
            const imgElement = await loadImage(img.dataUrl);
            const imgWidth = imgElement.width;
            const imgHeight = imgElement.height;

            let pageWidth, pageHeight, imgX, imgY, imgFinalWidth, imgFinalHeight;

            if (pageSize === 'fit') {
                // Fit page to image (convert pixels to mm at 96 DPI)
                pageWidth = (imgWidth / 96) * 25.4;
                pageHeight = (imgHeight / 96) * 25.4;
                imgX = 0;
                imgY = 0;
                imgFinalWidth = pageWidth;
                imgFinalHeight = pageHeight;
            } else {
                // Fit image to page with margins
                const pg = pageSizes[pageSize];
                pageWidth = pg.width;
                pageHeight = pg.height;
                const margin = 10; // 10mm margin

                const availWidth = pageWidth - (margin * 2);
                const availHeight = pageHeight - (margin * 2);

                const imgRatio = imgWidth / imgHeight;
                const availRatio = availWidth / availHeight;

                if (imgRatio > availRatio) {
                    imgFinalWidth = availWidth;
                    imgFinalHeight = availWidth / imgRatio;
                } else {
                    imgFinalHeight = availHeight;
                    imgFinalWidth = availHeight * imgRatio;
                }

                imgX = margin + (availWidth - imgFinalWidth) / 2;
                imgY = margin + (availHeight - imgFinalHeight) / 2;
            }

            // Compress image
            const compressedDataUrl = compressImage(imgElement, quality);

            if (i === 0) {
                jspdfDoc = new jsPDF({
                    orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
                    unit: 'mm',
                    format: [pageWidth, pageHeight],
                    compress: true
                });
            } else {
                jspdfDoc.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'landscape' : 'portrait');
            }

            jspdfDoc.addImage(compressedDataUrl, 'JPEG', imgX, imgY, imgFinalWidth, imgFinalHeight, undefined, 'FAST');
        }

        state.imagePdfBlob = jspdfDoc.output('blob');

        showImageResults();
    } catch (error) {
        console.error('Image to PDF error:', error);
        alert('An error occurred while creating the PDF. Please try again.');
        elements.imageProgressSection.classList.add('hidden');
        elements.imageList.classList.remove('hidden');
    } finally {
        state.isProcessing = false;
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function compressImage(img, quality) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Limit max dimensions for compression
    const maxDim = 2000;
    let width = img.width;
    let height = img.height;

    if (width > maxDim || height > maxDim) {
        if (width > height) {
            height = (height / width) * maxDim;
            width = maxDim;
        } else {
            width = (width / height) * maxDim;
            height = maxDim;
        }
    }

    canvas.width = width;
    canvas.height = height;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
}

function showImageResults() {
    elements.imageProgressSection.classList.add('hidden');
    elements.imageResultsSection.classList.remove('hidden');
    elements.imagePdfSize.textContent = formatFileSize(state.imagePdfBlob.size);
}

function downloadImagePdf() {
    if (!state.imagePdfBlob) return;

    const fileName = `images_to_pdf_${Date.now()}.pdf`;
    const url = URL.createObjectURL(state.imagePdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function startNewImagePdf() {
    clearAllImages();
    elements.imageResultsSection.classList.add('hidden');
}

// ========================================
// PDF Preview Modal
// ========================================
async function openPreview(blob) {
    if (!blob) return;

    elements.previewModal.classList.remove('hidden');

    try {
        const arrayBuffer = await blob.arrayBuffer();
        state.previewPdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.totalPages = state.previewPdf.numPages;
        state.currentPage = 1;

        updatePageNavigation();
        await renderPreviewPage(state.currentPage);
    } catch (error) {
        console.error('Preview error:', error);
        alert('Could not preview the PDF.');
        closePreview();
    }
}

async function renderPreviewPage(pageNum) {
    if (!state.previewPdf) return;

    const page = await state.previewPdf.getPage(pageNum);
    const canvas = elements.previewCanvas;
    const ctx = canvas.getContext('2d');

    // Scale to fit modal
    const containerWidth = 700;
    const viewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    await page.render({
        canvasContext: ctx,
        viewport: scaledViewport
    }).promise;
}

function updatePageNavigation() {
    elements.pageIndicator.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
    elements.prevPageBtn.disabled = state.currentPage <= 1;
    elements.nextPageBtn.disabled = state.currentPage >= state.totalPages;
}

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        updatePageNavigation();
        renderPreviewPage(state.currentPage);
    }
}

function nextPage() {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        updatePageNavigation();
        renderPreviewPage(state.currentPage);
    }
}

function closePreview() {
    elements.previewModal.classList.add('hidden');
    state.previewPdf = null;
}

// ========================================
// Event Listeners
// ========================================
function initEventListeners() {
    // Theme
    elements.themeToggle.addEventListener('click', toggleTheme);

    // PDF Compression
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
    elements.removeFile.addEventListener('click', removeFile);
    elements.compressionMode.addEventListener('change', updateCompressionMode);
    elements.qualitySlider.addEventListener('input', updateQualityLabel);
    elements.compressBtn.addEventListener('click', compressPDF);
    elements.previewBtn.addEventListener('click', () => openPreview(state.compressedBlob));
    elements.downloadBtn.addEventListener('click', downloadCompressed);
    elements.newFileBtn.addEventListener('click', startNew);

    // Image to PDF
    elements.imageInput.addEventListener('change', handleImageSelect);
    elements.addMoreBtn.addEventListener('click', () => elements.imageInput.click());
    elements.imgQualitySlider.addEventListener('input', updateImgQualityLabel);
    elements.createPdfBtn.addEventListener('click', createPdfFromImages);
    elements.clearImagesBtn.addEventListener('click', clearAllImages);
    elements.imagePreviewBtn.addEventListener('click', () => openPreview(state.imagePdfBlob));
    elements.imageDownloadBtn.addEventListener('click', downloadImagePdf);
    elements.imageNewBtn.addEventListener('click', startNewImagePdf);

    // Modal
    elements.modalOverlay.addEventListener('click', closePreview);
    elements.closeModal.addEventListener('click', closePreview);
    elements.prevPageBtn.addEventListener('click', prevPage);
    elements.nextPageBtn.addEventListener('click', nextPage);

    // Keyboard navigation for modal
    document.addEventListener('keydown', (e) => {
        if (elements.previewModal.classList.contains('hidden')) return;

        if (e.key === 'Escape') closePreview();
        if (e.key === 'ArrowLeft') prevPage();
        if (e.key === 'ArrowRight') nextPage();
    });
}

// ========================================
// Initialize App
// ========================================
function init() {
    initTheme();
    initTabs();
    initDragDrop();
    initImageDragDrop();
    initEventListeners();
    updateQualityLabel();
    updateImgQualityLabel();
}

// Make removeImage available globally for onclick handler
window.removeImage = removeImage;

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
