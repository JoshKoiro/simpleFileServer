class FileServer {
    constructor() {
        this.uploadZone = document.getElementById('uploadZone');
        this.fileInput = document.getElementById('fileInput');
        this.filesList = document.getElementById('filesList');
        this.directoryPath = document.getElementById('directoryPath');
        this.uploadProgress = document.getElementById('uploadProgress');
        this.progressFill = document.getElementById('progressFill');
        this.uploadStatus = document.getElementById('uploadStatus');
        this.uploadContent = document.querySelector('.upload-content');
        
        // Modal elements
        this.modal = document.getElementById('fileViewerModal');
        this.modalClose = document.getElementById('modalClose');
        this.modalTitle = document.getElementById('modalTitle');
        this.viewerContainer = document.getElementById('viewerContainer');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorText = document.getElementById('errorText');
        this.downloadInsteadBtn = document.getElementById('downloadInsteadBtn');
        
        // Navigation state
        this.currentPath = '';
        
        // Current viewed file info (for download fallback)
        this.currentViewedFile = null;
        
        this.init();
    }
    
    init() {
        this.loadDirectoryInfo();
        this.loadFiles();
        this.setupEventListeners();
        this.setupModalEventListeners();
    }
    
    setupEventListeners() {
        // Click to select files
        this.uploadZone.addEventListener('click', () => {
            this.fileInput.click();
        });
        
        // File input change
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.uploadFiles(e.target.files);
            }
        });
        
        // Drag and drop events
        this.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadZone.classList.add('drag-over');
        });
        
        this.uploadZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.uploadZone.classList.remove('drag-over');
        });
        
        this.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadZone.classList.remove('drag-over');
            
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                this.uploadFiles(files);
            }
        });
        
        // Prevent default drag behavior on document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }
    
    setupModalEventListeners() {
        // Close modal when clicking close button
        this.modalClose.addEventListener('click', () => {
            this.closeModal();
        });
        
        // Close modal when clicking outside content
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });
        
        // Close modal with escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('show')) {
                this.closeModal();
            }
        });
        
        // Download instead button
        this.downloadInsteadBtn.addEventListener('click', () => {
            if (this.currentViewedFile) {
                const link = document.createElement('a');
                link.href = `/api/download/${encodeURIComponent(this.currentViewedFile.name)}?path=${encodeURIComponent(this.currentPath)}`;
                link.download = this.currentViewedFile.name;
                link.click();
                this.closeModal();
            }
        });
    }
    
    async loadDirectoryInfo() {
        try {
            const response = await fetch(`/api/info?path=${encodeURIComponent(this.currentPath)}`);
            const info = await response.json();
            
            // Show breadcrumb path
            const breadcrumb = info.currentPath ? 
                `${info.baseDirectory}/${info.currentPath}` : 
                info.baseDirectory;
            this.directoryPath.textContent = breadcrumb;
        } catch (error) {
            console.error('Failed to load directory info:', error);
            this.directoryPath.textContent = 'Unknown directory';
        }
    }
    
    async loadFiles() {
        try {
            const response = await fetch(`/api/files?path=${encodeURIComponent(this.currentPath)}`);
            const files = await response.json();
            this.renderFiles(files);
        } catch (error) {
            console.error('Failed to load files:', error);
            this.filesList.innerHTML = '<div class="loading">Failed to load files</div>';
        }
    }
    
    renderFiles(files) {
        if (files.length === 0) {
            this.filesList.innerHTML = '<div class="loading">No files in directory</div>';
            return;
        }
        
        // Sort files: parent directory first, then directories, then files
        files.sort((a, b) => {
            if (a.isParent) return -1;
            if (b.isParent) return 1;
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        this.filesList.innerHTML = files.map(file => this.createFileItem(file)).join('');
    }
    
    createFileItem(file) {
        const isParent = file.isParent;
        const icon = isParent ? '📁' : (file.isDirectory ? '📁' : this.getFileIcon(file.name));
        const size = file.isDirectory ? (isParent ? 'Parent Directory' : 'Directory') : this.formatFileSize(file.size);
        const date = isParent ? '' : new Date(file.modified).toLocaleDateString();
        
        let actions = '';
        let doubleClickHandler = '';
        
        if (isParent) {
            doubleClickHandler = `ondblclick="window.fileServer.navigateUp()"`;
        } else if (file.isDirectory) {
            actions = `
                <div class="file-actions">
                    <button class="action-btn download-btn" onclick="window.fileServer.downloadFolder('${this.escapeHtml(file.name)}')">📦 Download ZIP</button>
                </div>
            `;
            doubleClickHandler = `ondblclick="window.fileServer.navigateInto('${this.escapeHtml(file.name)}')"`;
        } else {
            // For files, show view button if viewable, always show download
            const viewButton = file.isViewable ? 
                `<button class="action-btn view-btn" onclick="window.fileServer.viewFile('${this.escapeHtml(file.name)}', '${file.viewerType}')">👁️ View</button>` : '';
            
            actions = `
                <div class="file-actions">
                    ${viewButton}
                    <a href="/api/download/${encodeURIComponent(file.name)}?path=${encodeURIComponent(this.currentPath)}" class="action-btn download-btn" download>⬇️ Download</a>
                </div>
            `;
        }
        
        return `
            <div class="file-item ${file.isDirectory ? 'folder' : 'file'}" ${doubleClickHandler}>
                <div class="file-info">
                    <div class="file-icon">${icon}</div>
                    <div class="file-details">
                        <div class="file-name">${this.escapeHtml(file.name)}</div>
                        <div class="file-meta">${size}${date ? ' • ' + date : ''}</div>
                    </div>
                </div>
                ${actions}
            </div>
        `;
    }
    
    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            'pdf': '📄',
            'doc': '📝', 'docx': '📝',
            'xls': '📊', 'xlsx': '📊',
            'ppt': '📈', 'pptx': '📈',
            'txt': '📃',
            'md': '📃', 'markdown': '📃',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️', 'webp': '🖼️',
            'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'webm': '🎬',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'aac': '🎵',
            'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️',
            'js': '💻', 'html': '💻', 'css': '💻', 'py': '💻', 'java': '💻', 'cpp': '💻', 'c': '💻',
            'json': '📋', 'xml': '📋', 'yaml': '📋', 'yml': '📋'
        };
        return iconMap[ext] || '📋';
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // File viewing methods
    async viewFile(filename, viewerType) {
        this.currentViewedFile = { name: filename, viewerType };
        this.openModal();
        this.showLoadingSpinner();
        this.modalTitle.textContent = filename;
        
        try {
            const viewUrl = `/api/view/${encodeURIComponent(filename)}?path=${encodeURIComponent(this.currentPath)}`;
            
            // Handle different viewer types
            switch (viewerType) {
                case 'image':
                    await this.viewImage(viewUrl, filename);
                    break;
                case 'video':
                    await this.viewVideo(viewUrl, filename);
                    break;
                case 'audio':
                    await this.viewAudio(viewUrl, filename);
                    break;
                case 'pdf':
                    await this.viewPDF(viewUrl, filename);
                    break;
                case 'text':
                    await this.viewText(viewUrl, filename);
                    break;
                default:
                    this.showError('Unsupported file type', 'This file type cannot be viewed in the browser.');
            }
        } catch (error) {
            console.error('Error viewing file:', error);
            this.showError('Failed to load file', error.message || 'An error occurred while loading the file.');
        }
    }
    
    async viewImage(url, filename) {
        const img = document.createElement('img');
        img.className = 'viewer-image';
        img.alt = filename;
        
        img.onload = () => {
            this.hideLoadingSpinner();
            this.viewerContainer.innerHTML = '';
            this.viewerContainer.appendChild(img);
        };
        
        img.onerror = () => {
            this.showError('Failed to load image', 'The image file could not be loaded.');
        };
        
        img.src = url;
    }
    
    async viewVideo(url, filename) {
        const video = document.createElement('video');
        video.className = 'viewer-video';
        video.controls = true;
        video.preload = 'metadata';
        
        video.onloadedmetadata = () => {
            this.hideLoadingSpinner();
            this.viewerContainer.innerHTML = '';
            this.viewerContainer.appendChild(video);
        };
        
        video.onerror = () => {
            this.showError('Failed to load video', 'The video file could not be loaded or played.');
        };
        
        video.src = url;
    }
    
    async viewAudio(url, filename) {
        const audio = document.createElement('audio');
        audio.className = 'viewer-audio';
        audio.controls = true;
        audio.preload = 'metadata';
        
        audio.onloadedmetadata = () => {
            this.hideLoadingSpinner();
            this.viewerContainer.innerHTML = '';
            
            // Create a container for audio with filename
            const container = document.createElement('div');
            container.style.textAlign = 'center';
            container.style.padding = '20px';
            
            const title = document.createElement('h4');
            title.textContent = filename;
            title.style.marginBottom = '20px';
            title.style.color = '#333';
            
            container.appendChild(title);
            container.appendChild(audio);
            this.viewerContainer.appendChild(container);
        };
        
        audio.onerror = () => {
            this.showError('Failed to load audio', 'The audio file could not be loaded or played.');
        };
        
        audio.src = url;
    }
    
    async viewPDF(url, filename) {
        const iframe = document.createElement('iframe');
        iframe.className = 'viewer-pdf';
        iframe.src = url;
        
        iframe.onload = () => {
            this.hideLoadingSpinner();
            this.viewerContainer.innerHTML = '';
            this.viewerContainer.appendChild(iframe);
        };
        
        iframe.onerror = () => {
            this.showError('Failed to load PDF', 'The PDF file could not be loaded. Your browser may not support PDF viewing.');
        };
        
        // Fallback for browsers that don't support PDF viewing
        setTimeout(() => {
            if (iframe.contentDocument === null) {
                this.showError('PDF viewing not supported', 'Your browser does not support viewing PDF files directly.');
            }
        }, 3000);
    }
    
    async viewText(url, filename) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const text = await response.text();
            const pre = document.createElement('pre');
            pre.className = 'viewer-text';
            
            // Add syntax highlighting class for code files
            const ext = filename.split('.').pop().toLowerCase();
            const codeExtensions = ['js', 'html', 'css', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs', 'sh', 'sql'];
            if (codeExtensions.includes(ext)) {
                pre.classList.add('code');
            }
            
            pre.textContent = text;
            
            this.hideLoadingSpinner();
            this.viewerContainer.innerHTML = '';
            this.viewerContainer.appendChild(pre);
            
        } catch (error) {
            this.showError('Failed to load text file', error.message || 'The text file could not be loaded.');
        }
    }
    
    openModal() {
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
    
    closeModal() {
        this.modal.classList.remove('show');
        document.body.style.overflow = ''; // Restore scrolling
        
        // Clean up viewer content
        this.viewerContainer.innerHTML = '';
        this.hideLoadingSpinner();
        this.hideError();
        this.currentViewedFile = null;
    }
    
    showLoadingSpinner() {
        this.loadingSpinner.style.display = 'flex';
        this.errorMessage.style.display = 'none';
        this.viewerContainer.innerHTML = '';
    }
    
    hideLoadingSpinner() {
        this.loadingSpinner.style.display = 'none';
    }
    
    showError(title, message) {
        this.hideLoadingSpinner();
        this.viewerContainer.innerHTML = '';
        this.errorText.textContent = message;
        this.errorMessage.querySelector('h4').textContent = title;
        this.errorMessage.style.display = 'flex';
    }
    
    hideError() {
        this.errorMessage.style.display = 'none';
    }
    
    async uploadFiles(files) {
        const formData = new FormData();
        
        // Add current path to form data
        formData.append('currentPath', this.currentPath);
        
        Array.from(files).forEach(file => {
            formData.append('files', file);
        });
        
        // Show progress
        this.showUploadProgress();
        
        try {
            const xhr = new XMLHttpRequest();
            
            // Progress tracking
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    this.updateProgress(percentComplete);
                }
            });
            
            // Handle completion
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    this.showMessage(`Successfully uploaded ${response.files.length} file(s)`, 'success');
                    this.loadFiles(); // Refresh file list
                } else {
                    const error = JSON.parse(xhr.responseText);
                    this.showMessage(`Upload failed: ${error.error}`, 'error');
                }
                this.hideUploadProgress();
            });
            
            // Handle errors
            xhr.addEventListener('error', () => {
                this.showMessage('Upload failed: Network error', 'error');
                this.hideUploadProgress();
            });
            
            xhr.open('POST', '/api/upload');
            xhr.send(formData);
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showMessage('Upload failed: ' + error.message, 'error');
            this.hideUploadProgress();
        }
        
        // Reset file input
        this.fileInput.value = '';
    }
    
    showUploadProgress() {
        this.uploadContent.style.display = 'none';
        this.uploadProgress.style.display = 'block';
        this.updateProgress(0);
        this.uploadStatus.textContent = 'Uploading...';
    }
    
    hideUploadProgress() {
        setTimeout(() => {
            this.uploadContent.style.display = 'block';
            this.uploadProgress.style.display = 'none';
        }, 1000);
    }
    
    updateProgress(percent) {
        this.progressFill.style.width = percent + '%';
        
        if (percent >= 100) {
            this.uploadStatus.textContent = 'Processing...';
        } else {
            this.uploadStatus.textContent = `Uploading... ${Math.round(percent)}%`;
        }
    }
    
    showMessage(text, type = 'success') {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());
        
        const message = document.createElement('div');
        message.className = `message ${type}`;
        message.textContent = text;
        document.body.appendChild(message);
        
        // Show message
        setTimeout(() => message.classList.add('show'), 100);
        
        // Hide message
        setTimeout(() => {
            message.classList.remove('show');
            setTimeout(() => message.remove(), 300);
        }, 3000);
    }
    
    async downloadFolder(foldername) {
        try {
            this.showMessage(`Preparing ZIP download for "${foldername}"...`, 'success');
            
            // Create a temporary link element for download
            const link = document.createElement('a');
            link.href = `/api/download-folder/${encodeURIComponent(foldername)}?path=${encodeURIComponent(this.currentPath)}`;
            link.download = `${foldername}.zip`;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Show success message after a short delay
            setTimeout(() => {
                this.showMessage(`Download started for "${foldername}.zip"`, 'success');
            }, 1000);
            
        } catch (error) {
            console.error('Folder download error:', error);
            this.showMessage(`Failed to download folder: ${error.message}`, 'error');
        }
    }
    
    // Navigation methods
    async navigateInto(foldername) {
        try {
            const newPath = this.currentPath ? `${this.currentPath}/${foldername}` : foldername;
            this.currentPath = newPath;
            await this.loadDirectoryInfo();
            await this.loadFiles();
            this.showMessage(`Navigated to: ${foldername}`, 'success');
        } catch (error) {
            console.error('Navigation error:', error);
            this.showMessage(`Failed to navigate to: ${foldername}`, 'error');
        }
    }
    
    async navigateUp() {
        try {
            if (!this.currentPath) {
                this.showMessage('Already at root directory', 'error');
                return;
            }
            
            // Go up one level
            const pathParts = this.currentPath.split('/');
            pathParts.pop();
            this.currentPath = pathParts.join('/');
            
            await this.loadDirectoryInfo();
            await this.loadFiles();
            this.showMessage('Navigated up one level', 'success');
        } catch (error) {
            console.error('Navigation error:', error);
            this.showMessage('Failed to navigate up', 'error');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.fileServer = new FileServer();
});