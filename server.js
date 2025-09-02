const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const { EventEmitter } = require('events');

// Enhanced logging system
class Logger {
    constructor() {
        this.logFile = path.join(__dirname, 'file-server.log');
        this.maxLogSize = 50 * 1024 * 1024; // 50MB
        this.logBuffer = [];
        this.maxBufferSize = 1000; // Keep last 1000 log entries in memory
        this.initLogFile();
    }
    
    async initLogFile() {
        try {
            // Create log file if it doesn't exist
            if (!fsSync.existsSync(this.logFile)) {
                await fs.writeFile(this.logFile, '');
            }
            
            // Check file size and rotate if needed
            const stats = await fs.stat(this.logFile);
            if (stats.size > this.maxLogSize) {
                await this.rotateLog();
            }
            
            this.log('SYSTEM', 'Logger initialized successfully');
        } catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }
    
    async rotateLog() {
        try {
            const backupFile = this.logFile + '.old';
            await fs.copyFile(this.logFile, backupFile);
            await fs.writeFile(this.logFile, '');
            console.log('Log file rotated');
        } catch (error) {
            console.error('Failed to rotate log:', error);
        }
    }
    
    async log(level, message, req = null, error = null) {
        const timestamp = new Date().toISOString();
        const ip = req ? (req.ip || req.connection?.remoteAddress || 'unknown') : 'system';
        const userAgent = req ? (req.get('User-Agent') || 'unknown') : 'system';
        const method = req ? req.method : '';
        const url = req ? req.originalUrl || req.url : '';
        
        const logEntry = {
            timestamp,
            level,
            ip,
            method,
            url,
            userAgent,
            message,
            error: error ? {
                message: error.message,
                stack: error.stack
            } : null
        };
        
        // Add to memory buffer
        this.logBuffer.push(logEntry);
        if (this.logBuffer.length > this.maxBufferSize) {
            this.logBuffer.shift();
        }
        
        // Format for console
        const consoleMessage = `[${timestamp}] [${level}] [${ip}] ${method} ${url} - ${message}${error ? ` - ERROR: ${error.message}` : ''}`;
        
        // Console output with colors
        switch (level) {
            case 'ERROR':
                console.log('\x1b[31m%s\x1b[0m', consoleMessage); // Red
                break;
            case 'WARN':
                console.log('\x1b[33m%s\x1b[0m', consoleMessage); // Yellow
                break;
            case 'SUCCESS':
                console.log('\x1b[32m%s\x1b[0m', consoleMessage); // Green
                break;
            case 'INFO':
                console.log('\x1b[36m%s\x1b[0m', consoleMessage); // Cyan
                break;
            default:
                console.log(consoleMessage);
        }
        
        // Write to file
        try {
            const fileEntry = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(this.logFile, fileEntry);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    
    getRecentLogs(limit = 100) {
        return this.logBuffer.slice(-limit);
    }
}

// ZIP progress tracking
class ZipProgressTracker extends EventEmitter {
    constructor() {
        super();
        this.activeJobs = new Map();
    }
    
    createJob(jobId, folderPath) {
        const job = {
            id: jobId,
            folderPath,
            startTime: Date.now(),
            progress: 0,
            status: 'initializing',
            filesProcessed: 0,
            totalFiles: 0,
            currentFile: '',
            error: null
        };
        
        this.activeJobs.set(jobId, job);
        return job;
    }
    
    updateJob(jobId, updates) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            Object.assign(job, updates);
            this.emit('progress', job);
        }
    }
    
    completeJob(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.status = 'completed';
            job.progress = 100;
            this.emit('progress', job);
            // Keep job for 30 seconds for final status check
            setTimeout(() => this.activeJobs.delete(jobId), 30000);
        }
    }
    
    errorJob(jobId, error) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.status = 'error';
            job.error = error.message;
            this.emit('progress', job);
            setTimeout(() => this.activeJobs.delete(jobId), 30000);
        }
    }
    
    getJob(jobId) {
        return this.activeJobs.get(jobId);
    }
}

// Helper function to count files in directory recursively
async function countFilesRecursive(dirPath) {
    let count = 0;
    
    try {
        const items = await fs.readdir(dirPath);
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);
            
            if (stats.isDirectory()) {
                count += await countFilesRecursive(itemPath);
            } else {
                count++;
            }
        }
    } catch (error) {
        // Ignore errors for individual files/folders
    }
    
    return count;
}

// Helper function to resolve and validate directory paths
function getValidatedPath(relativePath = '') {
    // Remove leading/trailing slashes and resolve
    const cleanPath = relativePath.replace(/^\/+|\/+$/g, '');
    const fullPath = path.resolve(absoluteTargetDir, cleanPath);
    
    // Security check - ensure path is within target directory
    if (!fullPath.startsWith(absoluteTargetDir)) {
        throw new Error('Access denied: Path outside allowed directory');
    }
    
    return fullPath;
}

// Helper function to get relative path from base directory
function getRelativePath(fullPath) {
    return path.relative(absoluteTargetDir, fullPath);
}

// Helper function to determine if file is viewable and get appropriate MIME type
function getFileViewInfo(filename) {
    const ext = path.extname(filename).toLowerCase();
    const basename = path.basename(filename, ext);
    
    // Define viewable file types and their MIME types
    const mimeTypes = {
        // Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', 
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        
        // Videos
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        
        // Audio
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        
        // Documents
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.markdown': 'text/markdown',
        
        // Code files
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.css': 'text/css',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.py': 'text/x-python',
        '.java': 'text/x-java-source',
        '.cpp': 'text/x-c++src',
        '.c': 'text/x-csrc',
        '.h': 'text/x-chdr',
        '.php': 'text/x-php',
        '.rb': 'text/x-ruby',
        '.go': 'text/x-go',
        '.rs': 'text/x-rustsrc',
        '.sh': 'text/x-shellscript',
        '.sql': 'text/x-sql',
        '.yaml': 'text/x-yaml',
        '.yml': 'text/x-yaml',
        '.toml': 'text/plain',
        '.ini': 'text/plain',
        '.cfg': 'text/plain',
        '.conf': 'text/plain',
        '.log': 'text/plain'
    };
    
    const mimeType = mimeTypes[ext];
    const isViewable = !!mimeType;
    
    // Determine the viewer type for frontend
    let viewerType = 'unsupported';
    if (mimeType) {
        if (mimeType.startsWith('image/')) viewerType = 'image';
        else if (mimeType.startsWith('video/')) viewerType = 'video';
        else if (mimeType.startsWith('audio/')) viewerType = 'audio';
        else if (mimeType === 'application/pdf') viewerType = 'pdf';
        else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
            viewerType = 'text';
        }
    }
    
    return {
        isViewable,
        mimeType: mimeType || 'application/octet-stream',
        viewerType,
        extension: ext,
        basename
    };
}

// Get directory from command line arguments
const targetDir = process.argv[2];

if (!targetDir) {
    console.error('Usage: node server.js <directory-path>');
    process.exit(1);
}

// Resolve to absolute path
const absoluteTargetDir = path.resolve(targetDir);

// Verify directory exists
if (!fsSync.existsSync(absoluteTargetDir)) {
    console.error(`Directory does not exist: ${absoluteTargetDir}`);
    process.exit(1);
}

if (!fsSync.statSync(absoluteTargetDir).isDirectory()) {
    console.error(`Path is not a directory: ${absoluteTargetDir}`);
    process.exit(1);
}

// Initialize components
const app = express();
const PORT = 8000;
const logger = new Logger();
const zipTracker = new ZipProgressTracker();

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Enhanced request logging middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.log('INFO', `${req.method} ${req.originalUrl} - Request started`, req);
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusLevel = statusCode >= 400 ? 'ERROR' : statusCode >= 300 ? 'WARN' : 'SUCCESS';
        
        logger.log(statusLevel, `${req.method} ${req.originalUrl} - ${statusCode} (${duration}ms)`, req);
        originalEnd.apply(res, args);
    };
    
    next();
});

// Explicitly handle root route BEFORE static middleware
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    logger.log('INFO', 'Serving root index.html', req);
    
    res.sendFile(indexPath, (err) => {
        if (err) {
            logger.log('ERROR', 'Failed to serve index.html', req, err);
            res.status(500).send('Error serving index.html');
        }
    });
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'ignore',
    etag: false,
    extensions: ['htm', 'html'],
    index: false,
    maxAge: '1d',
    redirect: false
}));

// API endpoint to get directory contents
app.get('/api/files', async (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const fullCurrentPath = getValidatedPath(currentPath);
        
        logger.log('INFO', `Listing directory: ${fullCurrentPath}`, req);
        
        const files = await fs.readdir(fullCurrentPath);
        const fileDetails = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(fullCurrentPath, file);
                const stats = await fs.stat(filePath);
                
                // Get file view info for non-directories
                let viewInfo = { isViewable: false, viewerType: 'unsupported' };
                if (!stats.isDirectory()) {
                    viewInfo = getFileViewInfo(file);
                }
                
                return {
                    name: file,
                    size: stats.size,
                    isDirectory: stats.isDirectory(),
                    modified: stats.mtime.toISOString(),
                    ...viewInfo
                };
            })
        );
        
        // Add parent directory entry if not at root
        if (currentPath && currentPath !== '') {
            fileDetails.unshift({
                name: '..',
                size: 0,
                isDirectory: true,
                isParent: true,
                modified: new Date().toISOString(),
                isViewable: false,
                viewerType: 'unsupported'
            });
        }
        
        logger.log('SUCCESS', `Listed ${fileDetails.length} items in directory`, req);
        res.json(fileDetails);
    } catch (error) {
        logger.log('ERROR', 'Failed to list directory contents', req, error);
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// API endpoint for viewing files
app.get('/api/view/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const currentPath = req.query.path || '';
        const currentDir = getValidatedPath(currentPath);
        const filePath = path.join(currentDir, filename);
        
        if (!fsSync.existsSync(filePath)) {
            logger.log('WARN', `File not found for viewing: ${filePath}`, req);
            return res.status(404).json({ error: 'File not found' });
        }
        
        const stats = fsSync.statSync(filePath);
        if (stats.isDirectory()) {
            logger.log('WARN', `Attempted to view directory: ${filePath}`, req);
            return res.status(400).json({ error: 'Cannot view directory' });
        }
        
        // Get file view information
        const viewInfo = getFileViewInfo(filename);
        
        if (!viewInfo.isViewable) {
            logger.log('WARN', `Unsupported file type for viewing: ${filename} (${viewInfo.extension})`, req);
            return res.status(415).json({ 
                error: 'File type not supported for viewing',
                viewerType: 'unsupported',
                extension: viewInfo.extension
            });
        }
        
        // Set appropriate content type
        res.setHeader('Content-Type', viewInfo.mimeType);
        res.setHeader('Content-Length', stats.size);
        
        // For text files, ensure UTF-8 encoding
        if (viewInfo.viewerType === 'text') {
            res.setHeader('Content-Type', `${viewInfo.mimeType}; charset=utf-8`);
        }
        
        // Stream the file
        const fileStream = fsSync.createReadStream(filePath);
        fileStream.pipe(res);
        
        logger.log('SUCCESS', `File viewed: ${filename} (${viewInfo.mimeType}, ${stats.size} bytes)`, req);
        
    } catch (error) {
        logger.log('ERROR', 'Error serving file for viewing', req, error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for file upload
app.post('/api/upload', (req, res) => {
    // Create a dynamic multer instance for this request
    const tempUpload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 100 * 1024 * 1024, // 100MB limit per file
            files: 50
        }
    }).fields([
        { name: 'files', maxCount: 50 },
        { name: 'currentPath', maxCount: 1 }
    ]);
    
    tempUpload(req, res, async (err) => {
        if (err) {
            logger.log('ERROR', 'File upload processing failed', req, err);
            return res.status(500).json({ error: 'Upload processing failed: ' + err.message });
        }
        
        try {
            if (!req.files || !req.files.files || req.files.files.length === 0) {
                logger.log('WARN', 'No files provided in upload request', req);
                return res.status(400).json({ error: 'No files uploaded' });
            }
            
            // Get the current path from form fields
            const currentPath = req.body.currentPath || '';
            const uploadDir = getValidatedPath(currentPath);
            
            logger.log('INFO', `Starting upload of ${req.files.files.length} files to: ${uploadDir}`, req);
            
            // Ensure upload directory exists
            if (!fsSync.existsSync(uploadDir)) {
                logger.log('ERROR', `Upload directory does not exist: ${uploadDir}`, req);
                return res.status(500).json({ error: `Upload directory does not exist: ${uploadDir}` });
            }
            
            // Save files to the target directory
            const savedFiles = [];
            const totalSize = req.files.files.reduce((sum, file) => sum + file.size, 0);
            
            for (const file of req.files.files) {
                const filePath = path.join(uploadDir, file.originalname);
                await fs.writeFile(filePath, file.buffer);
                savedFiles.push({
                    name: file.originalname,
                    size: file.size
                });
                logger.log('SUCCESS', `Uploaded file: ${file.originalname} (${file.size} bytes)`, req);
            }
            
            logger.log('SUCCESS', `Upload completed: ${savedFiles.length} files, ${totalSize} bytes total`, req);
            
            res.json({ 
                message: 'Files uploaded successfully',
                files: savedFiles
            });
            
        } catch (error) {
            logger.log('ERROR', 'Failed to save uploaded files', req, error);
            res.status(500).json({ error: 'Failed to save files: ' + error.message });
        }
    });
});

// API endpoint for file download
app.get('/api/download/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const currentPath = req.query.path || '';
        const currentDir = getValidatedPath(currentPath);
        const filePath = path.join(currentDir, filename);
        
        if (!fsSync.existsSync(filePath)) {
            logger.log('WARN', `File not found for download: ${filePath}`, req);
            return res.status(404).json({ error: 'File not found' });
        }
        
        const stats = fsSync.statSync(filePath);
        if (stats.isDirectory()) {
            logger.log('WARN', `Attempted to download directory as file: ${filePath}`, req);
            return res.status(400).json({ error: 'Use /api/download-folder/ for directories' });
        }
        
        logger.log('SUCCESS', `File download started: ${filename} (${stats.size} bytes)`, req);
        res.download(filePath, filename);
    } catch (error) {
        logger.log('ERROR', 'File download failed', req, error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to start folder download (returns job ID)
app.post('/api/start-zip/:foldername', async (req, res) => {
    try {
        const foldername = req.params.foldername;
        const currentPath = req.query.path || '';
        const currentDir = getValidatedPath(currentPath);
        const folderPath = path.join(currentDir, foldername);
        
        if (!fsSync.existsSync(folderPath)) {
            logger.log('WARN', `Folder not found for ZIP: ${folderPath}`, req);
            return res.status(404).json({ error: 'Folder not found' });
        }
        
        const stats = fsSync.statSync(folderPath);
        if (!stats.isDirectory()) {
            logger.log('WARN', `Attempted to ZIP non-directory: ${folderPath}`, req);
            return res.status(400).json({ error: 'Path is not a directory' });
        }
        
        // Generate unique job ID
        const jobId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create progress tracking job
        const job = zipTracker.createJob(jobId, folderPath);
        
        logger.log('INFO', `ZIP job started: ${jobId} for folder ${foldername}`, req);
        
        // Start ZIP creation in background (don't await)
        createZipWithProgress(jobId, folderPath, foldername, req);
        
        res.json({ jobId, status: 'started' });
        
    } catch (error) {
        logger.log('ERROR', 'Failed to start ZIP job', req, error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get ZIP job progress
app.get('/api/zip-progress/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = zipTracker.getJob(jobId);
    
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
});

// API endpoint to download completed ZIP
app.get('/api/download-zip/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = zipTracker.getJob(jobId);
    
    if (!job) {
        logger.log('WARN', `ZIP job not found: ${jobId}`, req);
        return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.status !== 'completed') {
        logger.log('WARN', `ZIP job not completed: ${jobId} (status: ${job.status})`, req);
        return res.status(400).json({ error: 'Job not completed' });
    }
    
    const zipPath = job.zipPath;
    if (!fsSync.existsSync(zipPath)) {
        logger.log('ERROR', `ZIP file not found: ${zipPath}`, req);
        return res.status(404).json({ error: 'ZIP file not found' });
    }
    
    const filename = path.basename(zipPath);
    logger.log('SUCCESS', `ZIP download started: ${filename}`, req);
    
    res.download(zipPath, filename, (err) => {
        if (err) {
            logger.log('ERROR', 'ZIP download failed', req, err);
        } else {
            // Clean up ZIP file after download
            setTimeout(() => {
                fsSync.unlink(zipPath, (unlinkErr) => {
                    if (unlinkErr) {
                        logger.log('WARN', `Failed to cleanup ZIP file: ${zipPath}`, null, unlinkErr);
                    } else {
                        logger.log('INFO', `ZIP file cleaned up: ${zipPath}`, null);
                    }
                });
            }, 5000); // Wait 5 seconds before cleanup
        }
    });
});

// Function to create ZIP with progress tracking
async function createZipWithProgress(jobId, folderPath, foldername, req) {
    const tempDir = path.join(__dirname, 'temp');
    const zipPath = path.join(tempDir, `${foldername}_${Date.now()}.zip`);
    
    try {
        // Ensure temp directory exists
        if (!fsSync.existsSync(tempDir)) {
            await fs.mkdir(tempDir, { recursive: true });
        }
        
        // Count total files for progress calculation
        zipTracker.updateJob(jobId, { status: 'counting', currentFile: 'Counting files...' });
        const totalFiles = await countFilesRecursive(folderPath);
        zipTracker.updateJob(jobId, { totalFiles, status: 'zipping' });
        
        logger.log('INFO', `ZIP job ${jobId}: Found ${totalFiles} files to compress`, req);
        
        // Create ZIP archive
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 6 } }); // Balanced compression
        
        let filesProcessed = 0;
        
        // Track archive progress
        archive.on('entry', (entry) => {
            filesProcessed++;
            const progress = Math.round((filesProcessed / totalFiles) * 100);
            const currentFile = entry.name;
            
            zipTracker.updateJob(jobId, {
                progress,
                filesProcessed,
                currentFile,
                status: 'zipping'
            });
        });
        
        // Handle completion
        output.on('close', () => {
            zipTracker.updateJob(jobId, { 
                zipPath, 
                status: 'completed',
                progress: 100,
                currentFile: 'Completed'
            });
            logger.log('SUCCESS', `ZIP job ${jobId} completed: ${archive.pointer()} bytes`, req);
        });
        
        // Handle errors
        archive.on('error', (err) => {
            zipTracker.errorJob(jobId, err);
            logger.log('ERROR', `ZIP job ${jobId} failed`, req, err);
        });
        
        output.on('error', (err) => {
            zipTracker.errorJob(jobId, err);
            logger.log('ERROR', `ZIP job ${jobId} output error`, req, err);
        });
        
        // Pipe archive to output
        archive.pipe(output);
        
        // Add directory to archive
        archive.directory(folderPath, false);
        
        // Finalize archive
        await archive.finalize();
        
    } catch (error) {
        zipTracker.errorJob(jobId, error);
        logger.log('ERROR', `ZIP job ${jobId} failed during setup`, req, error);
    }
}

// API endpoint to get current directory info
app.get('/api/info', (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const fullCurrentPath = getValidatedPath(currentPath);
        
        res.json({
            baseDirectory: absoluteTargetDir,
            currentDirectory: fullCurrentPath,
            currentPath: currentPath,
            relativePath: getRelativePath(fullCurrentPath),
            basename: path.basename(fullCurrentPath) || path.basename(absoluteTargetDir)
        });
    } catch (error) {
        logger.log('ERROR', 'Failed to get directory info', req, error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to view server logs
app.get('/api/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = logger.getRecentLogs(limit);
        
        logger.log('INFO', `Logs accessed: returning ${logs.length} entries`, req);
        res.json({ logs });
    } catch (error) {
        logger.log('ERROR', 'Failed to retrieve logs', req, error);
        res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

// Start server
app.listen(PORT, () => {
    const startMessage = `🚀 File server started on http://localhost:${PORT}`;
    const dirMessage = `📁 Serving directory: ${absoluteTargetDir}`;
    const logMessage = `📝 Logs available at: http://localhost:${PORT}/logs`;
    
    console.log('\x1b[32m%s\x1b[0m', '='.repeat(80));
    console.log('\x1b[32m%s\x1b[0m', startMessage);
    console.log('\x1b[36m%s\x1b[0m', dirMessage);
    console.log('\x1b[36m%s\x1b[0m', logMessage);
    console.log('\x1b[32m%s\x1b[0m', '='.repeat(80));
    
    logger.log('SYSTEM', `File server started successfully on port ${PORT}`);
    logger.log('SYSTEM', `Serving directory: ${absoluteTargetDir}`);
});