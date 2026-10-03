const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createServer } = require('http');
const { parse } = require('url');

// 1. Hardware GPU Acceleration & Chromium Engine Optimization
// Force discrete high-performance GPU, enable zero-copy tile rasterization, and hardware video decode
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization,SmoothScrolling');
app.commandLine.appendSwitch('disable-frame-rate-limit');

// 2. Prevent Multiple Instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

// Lightweight inline splash screen that renders in <50ms while Next.js prepares
const splashHTML = `data:text/html;charset=utf-8,` + encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Darling Cinemas</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background: #050303;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      overflow: hidden;
      user-select: none;
      -webkit-app-region: drag;
    }
    .logo {
      font-size: 56px;
      font-weight: 900;
      letter-spacing: 12px;
      background: linear-gradient(to bottom, #ffebd2 0%, #f69d3c 42%, #d84315 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .sub {
      font-size: 13px;
      letter-spacing: 10px;
      color: rgba(255,255,255,0.7);
      margin-bottom: 34px;
      font-weight: 500;
    }
    .bar {
      width: 220px;
      height: 3px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
      -webkit-app-region: no-drag;
    }
    .fill {
      height: 100%;
      background: linear-gradient(90deg, #ff521b, #ffcd33);
      width: 45%;
      border-radius: 3px;
      animation: load 1.6s infinite ease-in-out;
    }
    @keyframes load {
      0% { transform: translateX(-100%); }
      50% { transform: translateX(100%); }
      100% { transform: translateX(300%); }
    }
  </style>
</head>
<body>
  <div class="logo">DARLING</div>
  <div class="sub">CINEMAS</div>
  <div class="bar"><div class="fill"></div></div>
</body>
</html>`);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#050303',
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#050303',
      symbolColor: '#f2eee5',
      height: 36
    } : false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false, // Ensures continuous smooth 60fps even if unfocused
      spellcheck: false,           // Eliminates continuous AST spellcheck overhead
      webSecurity: false,          // Faster video loading without CORS pre-flight delays
      webgl: true,
      scrollBounce: true
    }
  });

  mainWindow.setMenuBarVisibility(false);

  // Show window instantly once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  return mainWindow;
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  const win = createMainWindow();

  if (app.isPackaged) {
    // Show splash screen instantly while Next.js prepares
    win.loadURL(splashHTML);

    try {
      const next = require('next');
      const nextApp = next({ 
        dev: false, 
        dir: app.getAppPath(),
        quiet: true,
        conf: { compress: false } // Avoid CPU-heavy compression over localhost loopback
      });
      const handle = nextApp.getRequestHandler();
      
      await nextApp.prepare();
      
      const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
      });
      
      // Optimize HTTP keep-alive for instant local asset serving
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
      
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        if (win && !win.isDestroyed()) {
          win.loadURL(`http://127.0.0.1:${port}`);
        }
      });
    } catch (err) {
      console.error('Failed to start production server', err);
      app.quit();
    }
  } else {
    // In dev mode, wait for Next.js dev server on port 3000
    const waitOn = require('wait-on');
    waitOn({ resources: ['tcp:127.0.0.1:3000'], timeout: 30000 })
      .then(() => {
        if (win && !win.isDestroyed()) {
          win.loadURL('http://127.0.0.1:3000');
        }
      })
      .catch((err) => {
        console.error('Next.js server failed to start', err);
        app.quit();
      });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
