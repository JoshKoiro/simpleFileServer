# Simple File Server

A minimal, elegant Node.js file server with drag-and-drop upload and download capabilities. Perfect for quickly sharing files over a local network or managing files on remote servers.

## Features

- 🎯 **Minimalist Design** - Clean, modern web interface
- 📤 **Drag & Drop Upload** - Simply drag files into the browser
- 📥 **Easy Downloads** - One-click file downloads
- 📦 **Folder Downloads** - Download entire folders as ZIP files
- 📁 **Directory Browsing** - View all files in the target directory
- 📊 **File Information** - See file sizes and modification dates
- 📱 **Responsive** - Works on desktop and mobile devices
- 🔒 **Security** - Path traversal protection built-in

## Quick Start

### Installation

1. Clone or download the files to your server
2. Install dependencies:
```bash
npm install
```

### Usage

Start the server with a target directory:
```bash
node server.js /path/to/your/directory
```

Examples:
```bash
# Serve the current directory
node server.js .

# Serve a specific directory
node server.js /home/username/documents

# Serve user home directory
node server.js /home/username
```

The server will start at `http://localhost:8000`

## Project Structure

```
simple-file-server/
├── server.js           # Main Express server
├── package.json        # Dependencies and scripts
├── README.md          # This file
└── public/            # Static web files
    ├── index.html     # Main web interface
    ├── style.css      # Minimalist styling
    └── script.js      # Client-side functionality
```

## API Endpoints

- `GET /` - Web interface
- `GET /api/files` - List directory contents (JSON)
- `POST /api/upload` - Upload files (multipart/form-data)
- `GET /api/download/:filename` - Download a file
- `GET /api/download-folder/:foldername` - Download a folder as ZIP
- `GET /api/info` - Get directory information

## Security Notes

- Files are served only from the specified directory
- Path traversal attacks are prevented
- No authentication is provided (intended for trusted networks)
- Consider firewall rules for production use

## Deployment Tips

### Local Network Access

To allow access from other devices on your network:
```bash
# Find your local IP
ip addr show  # Linux
ifconfig      # macOS

# Then access via: http://YOUR_IP:8000
```

### Remote Server

For remote servers, consider:
- Using a reverse proxy (nginx/Apache)
- Setting up SSL certificates
- Implementing authentication if needed
- Configuring firewall rules

### Process Management

Use PM2 for production deployment:
```bash
npm install -g pm2
pm2 start server.js --name file-server -- /path/to/directory
```

## Dependencies

- **express** - Web framework
- **multer** - File upload handling
- **archiver** - ZIP file creation for folder downloads

Just 3 lightweight dependencies to keep things simple!

## Browser Support

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

Drag and drop works in all modern browsers.

## License

MIT - Use it however you'd like!
