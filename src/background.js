'use strict';

import path from 'path';
import electron, {
  app,
  dialog,
  protocol,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';

import saveHtmlAsPdf from './saveHtmlAsPdf';
import { IPC_MESSAGES, IPC_ACTIONS } from './messages';
import theme from '@/theme';

const isDevelopment = process.env.NODE_ENV !== 'production';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const title = 'Frappe Books';
const icon = path.resolve('./build/icon.png');

// Global ref to prevent garbage collection.
let mainWindow;
let winURL;
let checkedForUpdate = false;

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
]);

Store.initRenderer();

/* -----------------------------
 * Main process helper functions
 * -----------------------------*/

function getMainWindowSize() {
  let height;
  if (app.isReady()) {
    const screen = electron.screen;
    height = screen.getPrimaryDisplay().workAreaSize.height;
    height = height > 907 ? 907 : height;
  } else {
    height = 907;
  }
  const width = Math.ceil(1.323 * height);
  return { height, width };
}

function createWindow() {
  let { width, height } = getMainWindowSize();
  mainWindow = new BrowserWindow({
    vibrancy: 'sidebar',
    transparent: isMac,
    backgroundColor: '#80FFFFFF',
    width,
    height,
    icon,
    title,
    webPreferences: {
      contextIsolation: false, // TODO: Switch this off
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
    },
    frame: isLinux,
    resizable: true,
  });

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    winURL = process.env.WEBPACK_DEV_SERVER_URL;
    mainWindow.loadURL(winURL);
    // to share with renderer process
    global.WEBPACK_DEV_SERVER_URL = process.env.WEBPACK_DEV_SERVER_URL;
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools();
  } else {
    createProtocol('app');
    // Load the index.html when not in development
    winURL = 'app://./index.html';
    mainWindow.loadURL(winURL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('store-on-window', {
      appVersion: app.getVersion(),
    });
  });
}

function createSettingsWindow(tab = 'General') {
  let settingsWindow = new BrowserWindow({
    parent: mainWindow,
    frame: isLinux,
    width: 460,
    height: 577,
    icon,
    title,
    backgroundColor: theme.backgroundColor.gray['200'],
    webPreferences: {
      contextIsolation: false, // TODO: Switch this on
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
    },
    resizable: false,
  });

  settingsWindow.loadURL(`${winURL}#/settings/${tab}`);
  settingsWindow.on('close', () => {
    mainWindow.reload();
  });
}

/* ---------------------------------
 * Register ipcMain message handlers
 * ---------------------------------*/

ipcMain.on(IPC_MESSAGES.CHECK_FOR_UPDATES, () => {
  if (!isDevelopment && !checkedForUpdate) {
    autoUpdater.checkForUpdatesAndNotify();
    checkedForUpdate = true;
  }
});

ipcMain.on(IPC_MESSAGES.OPEN_SETTINGS, (event, tab) => {
  createSettingsWindow(tab);
});

ipcMain.on(IPC_MESSAGES.OPEN_MENU, (event) => {
  const window = event.sender.getOwnerBrowserWindow();
  const menu = Menu.getApplicationMenu();
  menu.popup({ window });
});

ipcMain.on(IPC_MESSAGES.RELOAD_MAIN_WINDOW, () => {
  mainWindow.reload();
});

ipcMain.on(IPC_MESSAGES.RESIZE_MAIN_WINDOW, (event, size, resizable) => {
  const [width, height] = size;
  if (!width || !height) return;
  mainWindow.setSize(width, height);
  mainWindow.setResizable(resizable);
});

ipcMain.on(IPC_MESSAGES.CLOSE_CURRENT_WINDOW, (event) => {
  event.sender.getOwnerBrowserWindow().close();
});

ipcMain.on(IPC_MESSAGES.MINIMIZE_CURRENT_WINDOW, (event) => {
  event.sender.getOwnerBrowserWindow().minimize();
});

ipcMain.on(IPC_MESSAGES.OPEN_EXTERNAL, (event, link) => {
  shell.openExternal(link);
});

/* ----------------------------------
 * Register ipcMain function handlers
 * ----------------------------------*/

ipcMain.handle(IPC_ACTIONS.TOGGLE_MAXIMIZE_CURRENT_WINDOW, (event) => {
  const window = event.sender.getOwnerBrowserWindow();
  const maximizing = !window.isMaximized();
  if (maximizing) {
    window.maximize();
  } else {
    window.unmaximize();
  }
  return maximizing;
});

ipcMain.handle(IPC_ACTIONS.GET_OPEN_FILEPATH, async (event, options) => {
  const window = event.sender.getOwnerBrowserWindow();
  return await dialog.showOpenDialog(window, options);
});

ipcMain.handle(IPC_ACTIONS.GET_SAVE_FILEPATH, async (event, options) => {
  const window = event.sender.getOwnerBrowserWindow();
  return await dialog.showSaveDialog(window, options);
});

ipcMain.handle(IPC_ACTIONS.GET_PRIMARY_DISPLAY_SIZE, (event) => {
  return getMainWindowSize();
});

ipcMain.handle(IPC_ACTIONS.GET_DIALOG_RESPONSE, async (event, options) => {
  const window = event.sender.getOwnerBrowserWindow();
  Object.assign(options, { icon });
  return await dialog.showMessageBox(window, options);
});

ipcMain.handle(IPC_ACTIONS.SAVE_HTML_AS_PDF, async (event, html, savePath) => {
  return await saveHtmlAsPdf(html, savePath);
});

/* ------------------------------
 * Register app lifecycle methods
 * ------------------------------*/

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    // Devtools extensions are broken in Electron 6.0.0 and greater
    // See https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/378 for more info
    // Electron will not launch with Devtools extensions installed on Windows 10 with dark mode
    // If you are not using Windows 10 dark mode, you may uncomment these lines
    // In addition, if the linked issue is closed, you can upgrade electron and uncomment these lines
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString());
    }
  }
  createWindow();
});

if (isMac) {
  app.dock.setIcon(icon);
}

/* ------------------------------
 * Register node#process messages
 * ------------------------------*/

if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit();
      }
    });
  } else {
    process.on('SIGTERM', () => {
      app.quit();
    });
  }
}
