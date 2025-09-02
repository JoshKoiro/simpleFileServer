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
}const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');

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

const app = express();
const PORT = 8000;

// Add detailed request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers.accept)}`);
    next();
});

// Explicitly handle root route BEFORE static middleware
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    console.log('ROOT REQUEST - Serving index.html from:', indexPath);
    console.log('File exists:', fsSync.existsSync(indexPath));
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Error serving index.html:', err);
            res.status(500).send('Error serving index.html');
        } else {
            console.log('Successfully sent index.html');
        }
    });
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'ignore',
    etag: false,
    extensions: ['htm', 'html'],
    index: false, // Disable automatic index serving since we handle it explicitly
    maxAge: '1d',
    redirect: false,
    setHeaders: function (res, path, stat) {
        console.log('Static file served:', path);
        res.set('x-timestamp', Date.now());
    }
}));

// API endpoint to get directory contents
app.get('/api/files', async (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const fullCurrentPath = getValidatedPath(currentPath);
        
        const files = await fs.readdir(fullCurrentPath);
        const fileDetails = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(fullCurrentPath, file);
                const stats = await fs.stat(filePath);
                return {
                    name: file,
                    size: stats.size,
                    isDirectory: stats.isDirectory(),
                    modified: stats.mtime.toISOString()
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
                modified: new Date().toISOString()
            });
        }
        
        res.json(fileDetails);
    } catch (error) {
        console.error('Directory read error:', error);
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// API endpoint for file upload
app.post('/api/upload', (req, res) => {
    // Create a dynamic multer instance for this request
    const tempUpload = multer({
        storage: multer.memoryStorage() // Store files in memory temporarily
    }).fields([
        { name: 'files', maxCount: 50 },
        { name: 'currentPath', maxCount: 1 }
    ]);
    
    tempUpload(req, res, async (err) => {
        if (err) {
            console.error('Multer error:', err);
            return res.status(500).json({ error: 'Upload processing failed: ' + err.message });
        }
        
        try {
            if (!req.files || !req.files.files || req.files.files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }
            
            // Get the current path from form fields
            const currentPath = req.body.currentPath || '';
            const uploadDir = getValidatedPath(currentPath);
            
            console.log(`Uploading to directory: ${uploadDir}`);
            
            // Ensure upload directory exists
            if (!fsSync.existsSync(uploadDir)) {
                return res.status(500).json({ error: `Upload directory does not exist: ${uploadDir}` });
            }
            
            // Save files to the target directory
            const savedFiles = [];
            for (const file of req.files.files) {
                const filePath = path.join(uploadDir, file.originalname);
                await fs.writeFile(filePath, file.buffer);
                savedFiles.push({
                    name: file.originalname,
                    size: file.size
                });
                console.log(`Saved file: ${filePath}`);
            }
            
            res.json({ 
                message: 'Files uploaded successfully',
                files: savedFiles
            });
            
        } catch (error) {
            console.error('File save error:', error);
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
            return res.status(404).json({ error: 'File not found' });
        }
        
        const stats = fsSync.statSync(filePath);
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Use /api/download-folder/ for directories' });
        }
        
        res.download(filePath, filename);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for folder download (as ZIP)
app.get('/api/download-folder/:foldername', (req, res) => {
    try {
        const foldername = req.params.foldername;
        const currentPath = req.query.path || '';
        const currentDir = getValidatedPath(currentPath);
        const folderPath = path.join(currentDir, foldername);
        
        if (!fsSync.existsSync(folderPath)) {
            return res.status(404).json({ error: 'Folder not found' });
        }
        
        const stats = fsSync.statSync(folderPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }
        
        // Set response headers for zip download
        const zipFilename = `${foldername}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
        
        // Create zip archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create archive' });
            }
        });
        
        // Handle archive warnings
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archive warning:', err);
            } else {
                console.error('Archive error:', err);
            }
        });
        
        // Pipe archive data to response
        archive.pipe(res);
        
        // Add the entire directory to the zip
        archive.directory(folderPath, false);
        
        // Finalize the archive
        archive.finalize();
        
        console.log(`Creating ZIP archive for folder: ${folderPath}`);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`File server running at http://localhost:${PORT}`);
    console.log(`Serving directory: ${absoluteTargetDir}`);
});
