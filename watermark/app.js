/**
 * Privacy-First Image Watermark
 * 100% Client-Side Image Watermarking using Canvas API
 */

// Global state
const state = {
    originalImage: null,
    fileName: '',
    settings: {
        text: '© 2024',
        fontSize: 48,
        opacity: 50,
        rotation: -30,
        color: '#ffffff',
        position: 'center',
        tile: false,
        tileSpacing: 100
    },
    crop: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 1,
        aspectRatio: null, // null = free, or number like 1, 4/3, 16/9
        isDragging: false,
        dragType: null, // 'move', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
        startMouseX: 0,
        startMouseY: 0,
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0,
        canvasWidth: 0,
        canvasHeight: 0
    }
};

// DOM Elements
const elements = {
    themeToggle: document.getElementById('themeToggle'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    editorPanel: document.getElementById('editorPanel'),
    removeImage: document.getElementById('removeImage'),
    previewCanvas: document.getElementById('previewCanvas'),
    watermarkText: document.getElementById('watermarkText'),
    fontSize: document.getElementById('fontSize'),
    fontSizeValue: document.getElementById('fontSizeValue'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacityValue'),
    rotation: document.getElementById('rotation'),
    rotationValue: document.getElementById('rotationValue'),
    textColor: document.getElementById('textColor'),
    colorValue: document.getElementById('colorValue'),
    positionBtns: document.querySelectorAll('.position-btn'),
    tileWatermark: document.getElementById('tileWatermark'),
    tileSpacingGroup: document.getElementById('tileSpacingGroup'),
    tileSpacing: document.getElementById('tileSpacing'),
    tileSpacingValue: document.getElementById('tileSpacingValue'),
    downloadBtn: document.getElementById('downloadBtn'),
    // Crop elements
    cropBtn: document.getElementById('cropBtn'),
    cropModal: document.getElementById('cropModal'),
    cropCanvas: document.getElementById('cropCanvas'),
    cropContainer: document.getElementById('cropContainer'),
    cropBox: document.getElementById('cropBox'),
    cropDimensions: document.getElementById('cropDimensions'),
    closeCropModal: document.getElementById('closeCropModal'),
    cancelCrop: document.getElementById('cancelCrop'),
    applyCrop: document.getElementById('applyCrop'),
    ratioBtns: document.querySelectorAll('.ratio-btn')
};

// ========================================
// Theme Management
// ========================================
function initTheme() {
    const savedTheme = localStorage.getItem('watermark-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('watermark-theme', isDark ? 'light' : 'dark');
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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
}

// ========================================
// File Handling
// ========================================
function isHeicFile(file) {
    const heicTypes = ['image/heic', 'image/heif'];
    const heicExtensions = ['.heic', '.heif'];

    if (heicTypes.includes(file.type.toLowerCase())) return true;

    const fileName = file.name.toLowerCase();
    return heicExtensions.some(ext => fileName.endsWith(ext));
}

async function convertHeicToJpeg(file) {
    try {
        const blob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.95
        });
        return blob;
    } catch (error) {
        console.error('HEIC conversion error:', error);
        throw new Error('Failed to convert HEIC file. Please try a different image.');
    }
}

async function handleFileSelect(file) {
    if (!file) {
        alert('Please select a valid image file.');
        return;
    }

    // Check if it's an image or HEIC
    const isImage = file.type.startsWith('image/');
    const isHeic = isHeicFile(file);

    if (!isImage && !isHeic) {
        alert('Please select a valid image file (JPG, PNG, WebP, GIF, HEIC).');
        return;
    }

    state.fileName = file.name;

    let imageFile = file;

    // Convert HEIC to JPEG if needed
    if (isHeic) {
        try {
            // Show converting message
            const dropZone = elements.dropZone;
            dropZone.querySelector('h2').textContent = 'Converting HEIC...';
            dropZone.querySelector('p').textContent = 'Please wait';

            imageFile = await convertHeicToJpeg(file);

            // Restore original text
            dropZone.querySelector('h2').textContent = 'Drop your image here';
            dropZone.querySelector('p').textContent = 'or click to browse';
        } catch (error) {
            alert(error.message);
            // Restore original text
            elements.dropZone.querySelector('h2').textContent = 'Drop your image here';
            elements.dropZone.querySelector('p').textContent = 'or click to browse';
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            state.originalImage = img;
            showEditor();
            renderPreview();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(imageFile);
}

function showEditor() {
    elements.dropZone.classList.add('hidden');
    elements.editorPanel.classList.remove('hidden');
}

function removeImage() {
    state.originalImage = null;
    state.fileName = '';
    elements.fileInput.value = '';
    elements.editorPanel.classList.add('hidden');
    elements.dropZone.classList.remove('hidden');
}

// ========================================
// Watermark Rendering
// ========================================
function renderPreview() {
    if (!state.originalImage) return;

    const canvas = elements.previewCanvas;
    const ctx = canvas.getContext('2d');
    const img = state.originalImage;

    // Set canvas size to match image
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Apply watermark
    applyWatermark(ctx, canvas.width, canvas.height);
}

function applyWatermark(ctx, width, height) {
    const { text, fontSize, opacity, rotation, color, position, tile } = state.settings;

    if (!text.trim()) return;

    ctx.save();

    // Set text properties
    ctx.font = `bold ${fontSize}px 'Inter', sans-serif`;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity / 100;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (tile) {
        // Tile watermark across entire image
        renderTiledWatermark(ctx, width, height, text, fontSize, rotation);
    } else {
        // Single watermark at specified position
        const pos = getPosition(position, width, height, fontSize);

        ctx.translate(pos.x, pos.y);
        ctx.rotate((rotation * Math.PI) / 180);

        // Draw text shadow for visibility
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        ctx.fillText(text, 0, 0);
    }

    ctx.restore();
}

function renderTiledWatermark(ctx, width, height, text, fontSize, rotation) {
    const textWidth = ctx.measureText(text).width;
    const spacingFactor = state.settings.tileSpacing / 100;
    const baseSpacing = Math.max(textWidth * 1.5, fontSize * 3);
    const spacing = baseSpacing * spacingFactor;
    const diagonal = Math.sqrt(width * width + height * height);

    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw text shadow for visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    for (let y = -diagonal; y < diagonal; y += spacing * 0.7) {
        for (let x = -diagonal; x < diagonal; x += spacing) {
            ctx.fillText(text, x, y);
        }
    }
}

function getPosition(position, width, height, fontSize) {
    const padding = fontSize * 0.8;
    const positions = {
        'top-left': { x: padding + fontSize, y: padding + fontSize / 2 },
        'top-center': { x: width / 2, y: padding + fontSize / 2 },
        'top-right': { x: width - padding - fontSize, y: padding + fontSize / 2 },
        'middle-left': { x: padding + fontSize, y: height / 2 },
        'center': { x: width / 2, y: height / 2 },
        'middle-right': { x: width - padding - fontSize, y: height / 2 },
        'bottom-left': { x: padding + fontSize, y: height - padding - fontSize / 2 },
        'bottom-center': { x: width / 2, y: height - padding - fontSize / 2 },
        'bottom-right': { x: width - padding - fontSize, y: height - padding - fontSize / 2 }
    };
    return positions[position] || positions.center;
}

// ========================================
// Download
// ========================================
function downloadImage() {
    if (!state.originalImage) return;

    const canvas = elements.previewCanvas;
    const originalName = state.fileName.replace(/\.[^.]+$/, '');
    const fileName = `${originalName}_watermarked.png`;

    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 'image/png');
}

// ========================================
// Settings Updates
// ========================================
function updateSettings() {
    state.settings.text = elements.watermarkText.value;
    state.settings.fontSize = parseInt(elements.fontSize.value);
    state.settings.opacity = parseInt(elements.opacity.value);
    state.settings.rotation = parseInt(elements.rotation.value);
    state.settings.color = elements.textColor.value;
    state.settings.tile = elements.tileWatermark.checked;
    state.settings.tileSpacing = parseInt(elements.tileSpacing.value);

    // Update value displays
    elements.fontSizeValue.textContent = `${state.settings.fontSize}px`;
    elements.opacityValue.textContent = `${state.settings.opacity}%`;
    elements.rotationValue.textContent = `${state.settings.rotation}°`;
    elements.colorValue.textContent = state.settings.color;
    elements.tileSpacingValue.textContent = `${state.settings.tileSpacing}%`;

    // Toggle tile spacing visibility
    if (state.settings.tile) {
        elements.tileSpacingGroup.classList.remove('hidden');
    } else {
        elements.tileSpacingGroup.classList.add('hidden');
    }

    renderPreview();
}

function setPosition(position) {
    state.settings.position = position;

    // Update active button
    elements.positionBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === position);
    });

    renderPreview();
}

// ========================================
// Crop Functionality
// ========================================
function openCropModal() {
    if (!state.originalImage) return;

    const canvas = elements.cropCanvas;
    const ctx = canvas.getContext('2d');
    const img = state.originalImage;

    // Calculate scale to fit modal
    const maxWidth = window.innerWidth * 0.7;
    const maxHeight = window.innerHeight * 0.5;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);

    state.crop.scale = scale;
    state.crop.canvasWidth = img.width * scale;
    state.crop.canvasHeight = img.height * scale;
    canvas.width = state.crop.canvasWidth;
    canvas.height = state.crop.canvasHeight;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Initialize crop box to cover most of the image
    const padding = 20;
    state.crop.x = padding;
    state.crop.y = padding;
    state.crop.width = canvas.width - padding * 2;
    state.crop.height = canvas.height - padding * 2;
    state.crop.aspectRatio = null;

    // Reset aspect ratio buttons
    elements.ratioBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === 'free');
    });

    updateCropBox();
    elements.cropModal.classList.remove('hidden');
}

function closeCropModal() {
    elements.cropModal.classList.add('hidden');
    state.crop.isDragging = false;
}

function setAspectRatio(ratio) {
    if (ratio === 'free') {
        state.crop.aspectRatio = null;
    } else {
        const parts = ratio.split(':');
        state.crop.aspectRatio = parseInt(parts[0]) / parseInt(parts[1]);
    }

    // Update button states
    elements.ratioBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === ratio);
    });

    // Adjust current box to match aspect ratio
    if (state.crop.aspectRatio) {
        const currentRatio = state.crop.width / state.crop.height;
        if (currentRatio > state.crop.aspectRatio) {
            // Too wide, reduce width
            state.crop.width = state.crop.height * state.crop.aspectRatio;
        } else {
            // Too tall, reduce height
            state.crop.height = state.crop.width / state.crop.aspectRatio;
        }
        constrainCropBox();
    }

    updateCropBox();
}

function updateCropBox() {
    const box = elements.cropBox;
    const canvas = elements.cropCanvas;
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = elements.cropContainer.getBoundingClientRect();

    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    box.style.left = `${offsetX + state.crop.x}px`;
    box.style.top = `${offsetY + state.crop.y}px`;
    box.style.width = `${state.crop.width}px`;
    box.style.height = `${state.crop.height}px`;

    // Update dimensions display
    const actualWidth = Math.round(state.crop.width / state.crop.scale);
    const actualHeight = Math.round(state.crop.height / state.crop.scale);
    elements.cropDimensions.textContent = `${actualWidth} × ${actualHeight} pixels`;

    elements.applyCrop.disabled = state.crop.width < 20 || state.crop.height < 20;
}

function constrainCropBox() {
    const { canvasWidth, canvasHeight } = state.crop;

    // Keep within bounds
    state.crop.x = Math.max(0, Math.min(state.crop.x, canvasWidth - state.crop.width));
    state.crop.y = Math.max(0, Math.min(state.crop.y, canvasHeight - state.crop.height));
    state.crop.width = Math.max(20, Math.min(state.crop.width, canvasWidth - state.crop.x));
    state.crop.height = Math.max(20, Math.min(state.crop.height, canvasHeight - state.crop.y));
}

function handleCropMouseDown(e) {
    const target = e.target;
    const box = elements.cropBox;

    if (target === box) {
        state.crop.dragType = 'move';
    } else if (target.classList.contains('crop-handle')) {
        state.crop.dragType = target.dataset.handle;
    } else {
        return;
    }

    state.crop.isDragging = true;
    state.crop.startMouseX = e.clientX;
    state.crop.startMouseY = e.clientY;
    state.crop.startX = state.crop.x;
    state.crop.startY = state.crop.y;
    state.crop.startWidth = state.crop.width;
    state.crop.startHeight = state.crop.height;

    e.preventDefault();
}

function handleCropMouseMove(e) {
    if (!state.crop.isDragging) return;

    const dx = e.clientX - state.crop.startMouseX;
    const dy = e.clientY - state.crop.startMouseY;
    const { dragType, aspectRatio, canvasWidth, canvasHeight } = state.crop;

    if (dragType === 'move') {
        state.crop.x = Math.max(0, Math.min(state.crop.startX + dx, canvasWidth - state.crop.width));
        state.crop.y = Math.max(0, Math.min(state.crop.startY + dy, canvasHeight - state.crop.height));
    } else {
        let newX = state.crop.startX, newY = state.crop.startY;
        let newW = state.crop.startWidth, newH = state.crop.startHeight;

        // Handle resize based on which handle is being dragged
        if (dragType.includes('e')) newW = Math.max(20, state.crop.startWidth + dx);
        if (dragType.includes('w')) { newX = state.crop.startX + dx; newW = state.crop.startWidth - dx; }
        if (dragType.includes('s')) newH = Math.max(20, state.crop.startHeight + dy);
        if (dragType.includes('n')) { newY = state.crop.startY + dy; newH = state.crop.startHeight - dy; }

        // Apply aspect ratio constraint
        if (aspectRatio) {
            if (dragType === 'e' || dragType === 'w') {
                newH = newW / aspectRatio;
            } else if (dragType === 'n' || dragType === 's') {
                newW = newH * aspectRatio;
            } else {
                // Corner handles - adjust based on larger change
                const newRatio = newW / newH;
                if (newRatio > aspectRatio) {
                    newW = newH * aspectRatio;
                } else {
                    newH = newW / aspectRatio;
                }
            }
        }

        // Ensure minimum size and bounds
        if (newW >= 20 && newX >= 0 && newX + newW <= canvasWidth) {
            state.crop.x = newX;
            state.crop.width = newW;
        }
        if (newH >= 20 && newY >= 0 && newY + newH <= canvasHeight) {
            state.crop.y = newY;
            state.crop.height = newH;
        }
    }

    updateCropBox();
}

function handleCropMouseUp() {
    state.crop.isDragging = false;
    state.crop.dragType = null;
}

function applyCrop() {
    const scale = state.crop.scale;
    const left = state.crop.x / scale;
    const top = state.crop.y / scale;
    const width = state.crop.width / scale;
    const height = state.crop.height / scale;

    if (width < 10 || height < 10) return;

    // Create cropped image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');

    ctx.drawImage(state.originalImage, left, top, width, height, 0, 0, width, height);

    // Create new image from cropped canvas
    const croppedImg = new Image();
    croppedImg.onload = () => {
        state.originalImage = croppedImg;
        renderPreview();
        closeCropModal();
    };
    croppedImg.src = tempCanvas.toDataURL('image/png');
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

    // Remove image
    elements.removeImage.addEventListener('click', removeImage);

    // Settings changes - live preview
    elements.watermarkText.addEventListener('input', updateSettings);
    elements.fontSize.addEventListener('input', updateSettings);
    elements.opacity.addEventListener('input', updateSettings);
    elements.rotation.addEventListener('input', updateSettings);
    elements.textColor.addEventListener('input', updateSettings);
    elements.tileWatermark.addEventListener('change', updateSettings);
    elements.tileSpacing.addEventListener('input', updateSettings);

    // Position buttons
    elements.positionBtns.forEach(btn => {
        btn.addEventListener('click', () => setPosition(btn.dataset.position));
    });

    // Download
    elements.downloadBtn.addEventListener('click', downloadImage);

    // Crop functionality
    elements.cropBtn.addEventListener('click', openCropModal);
    elements.closeCropModal.addEventListener('click', closeCropModal);
    elements.cancelCrop.addEventListener('click', closeCropModal);
    elements.applyCrop.addEventListener('click', applyCrop);

    // Aspect ratio buttons
    elements.ratioBtns.forEach(btn => {
        btn.addEventListener('click', () => setAspectRatio(btn.dataset.ratio));
    });

    // Crop box drag/resize
    elements.cropBox.addEventListener('mousedown', handleCropMouseDown);
    document.addEventListener('mousemove', handleCropMouseMove);
    document.addEventListener('mouseup', handleCropMouseUp);

    // Close modal on backdrop click
    elements.cropModal.addEventListener('click', (e) => {
        if (e.target === elements.cropModal) closeCropModal();
    });
}

// ========================================
// Initialize App
// ========================================
function init() {
    initTheme();
    initDragDrop();
    initEventListeners();

    // Sync initial settings with UI
    elements.watermarkText.value = state.settings.text;
    updateSettings();
}

document.addEventListener('DOMContentLoaded', init);
