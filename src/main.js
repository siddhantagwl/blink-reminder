import { app, Menu, Notification, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

const IS_DEV = !app.isPackaged;
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;
const DEV_DEFAULT_INTERVAL_MS = 10 * 1000;
const AUTO_START_REMINDERS = false;
const DEFAULT_LAUNCH_AT_LOGIN = false;
const NOTIFICATION_TITLE = 'Blink reminder';
const NOTIFICATION_BODY = 'Blink 10 times and look away for 20 seconds.';
const SETTINGS_FILE_NAME = 'settings.json';
const INTERVAL_OPTIONS = [
  { label: '10 sec', value: 10 * 1000, devOnly: true },
  { label: '20 sec', value: 20 * 1000, devOnly: true },
  { label: '5 min', value: 5 * 60 * 1000 },
  { label: '10 min', value: 10 * 60 * 1000 },
  { label: '20 min', value: 20 * 60 * 1000 },
];

let tray = null;
let reminderInterval = null;
let trayMenu = null;
let currentIntervalMs = IS_DEV ? DEV_DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS;
let launchAtLogin = DEFAULT_LAUNCH_AT_LOGIN;
let settingsPath = '';
let usingFallbackTrayIcon = false;

function createFallbackTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <g fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 9c1.8-2.8 4.3-4.2 7-4.2s5.2 1.4 7 4.2c-1.8 2.8-4.3 4.2-7 4.2S3.8 11.8 2 9Z"/>
        <circle cx="9" cy="9" r="2.1" fill="black" stroke="none"/>
      </g>
    </svg>
  `.trim();

  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  icon.setTemplateImage(true);
  return icon.resize({ width: 18, height: 18 });
}

function getVisibleIntervalOptions() {
  return INTERVAL_OPTIONS.filter((option) => IS_DEV || !option.devOnly);
}

function getIntervalLabel(intervalMs) {
  const matchedOption = INTERVAL_OPTIONS.find((option) => option.value === intervalMs);
  return matchedOption ? matchedOption.label : `${Math.round(intervalMs / 1000)} sec`;
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (typeof parsed.currentIntervalMs === 'number') {
      currentIntervalMs = parsed.currentIntervalMs;
    }

    if (typeof parsed.launchAtLogin === 'boolean') {
      launchAtLogin = parsed.launchAtLogin;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Failed to load settings:', error);
    }
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          currentIntervalMs,
          launchAtLogin,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

function applyLaunchAtLoginSetting() {
  if (process.platform !== 'darwin') {
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: launchAtLogin,
    });
  } catch (error) {
    console.error('Failed to apply launch at login setting:', error);
  }
}

function showBlinkNotification() {
  new Notification({
    title: NOTIFICATION_TITLE,
    body: NOTIFICATION_BODY,
  }).show();
}

function isReminderRunning() {
  return reminderInterval !== null;
}

function updateTrayVisualState() {
  if (!tray) {
    return;
  }

  const isRunning = isReminderRunning();
  tray.setToolTip(`Blink Reminder: ${isRunning ? 'running' : 'paused'} (${getIntervalLabel(currentIntervalMs)})`);

  if (process.platform === 'darwin') {
    tray.setTitle(usingFallbackTrayIcon ? (isRunning ? '👁 On' : '👁') : '');
  }
}

function restartRemindersIfRunning() {
  if (!isReminderRunning()) {
    updateTrayVisualState();
    rebuildTrayMenu();
    return;
  }

  clearInterval(reminderInterval);
  reminderInterval = setInterval(() => {
    showBlinkNotification();
  }, currentIntervalMs);

  updateTrayVisualState();
  rebuildTrayMenu();
}

function setIntervalMs(nextIntervalMs) {
  currentIntervalMs = nextIntervalMs;
  saveSettings();
  restartRemindersIfRunning();
}

function setLaunchAtLogin(nextValue) {
  launchAtLogin = nextValue;
  saveSettings();
  applyLaunchAtLoginSetting();
  rebuildTrayMenu();
}

function buildIntervalMenuItems() {
  return getVisibleIntervalOptions().map((option) => ({
    label: option.label,
    type: 'radio',
    checked: currentIntervalMs === option.value,
    click: () => setIntervalMs(option.value),
  }));
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  trayMenu = Menu.buildFromTemplate([
    {
      label: isReminderRunning() ? 'Reminders running' : 'Reminders paused',
      enabled: false,
    },
    {
      label: `Current interval: ${getIntervalLabel(currentIntervalMs)}`,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Start reminders',
      enabled: !isReminderRunning(),
      click: () => startReminders(),
    },
    {
      label: 'Stop reminders',
      enabled: isReminderRunning(),
      click: () => stopReminders(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Set interval',
      submenu: buildIntervalMenuItems(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Show test notification',
      click: () => showBlinkNotification(),
    },
    {
      type: 'separator',
    },
    {
      label: app.isPackaged ? 'Launch at login' : 'Launch at login (available after packaging)',
      type: 'checkbox',
      checked: launchAtLogin,
      enabled: app.isPackaged,
      click: (menuItem) => setLaunchAtLogin(menuItem.checked),
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        stopReminders();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(trayMenu);
}

function startReminders() {
  if (isReminderRunning()) {
    return;
  }

  reminderInterval = setInterval(() => {
    showBlinkNotification();
  }, currentIntervalMs);

  updateTrayVisualState();
  rebuildTrayMenu();
}

function stopReminders() {
  if (!isReminderRunning()) {
    return;
  }

  clearInterval(reminderInterval);
  reminderInterval = null;
  updateTrayVisualState();
  rebuildTrayMenu();
}

function createTray() {
  const iconPath = path.join(__dirname, 'iconTemplate.png');
  const hasIconFile = fs.existsSync(iconPath);
  usingFallbackTrayIcon = !hasIconFile;
  const trayIcon = hasIconFile ? nativeImage.createFromPath(iconPath) : createFallbackTrayIcon();

  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setIgnoreDoubleClickEvents(true);
  updateTrayVisualState();
  rebuildTrayMenu();

  if (process.platform === 'darwin') {
    tray.on('click', () => {
      tray?.popUpContextMenu(trayMenu ?? undefined);
    });
  }

  tray.on('right-click', () => {
    tray?.popUpContextMenu(trayMenu ?? undefined);
  });
}

app.whenReady().then(() => {
  settingsPath = getSettingsPath();
  loadSettings();
  applyLaunchAtLoginSetting();

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();

  if (AUTO_START_REMINDERS) {
    startReminders();
  }

  app.on('activate', () => {
    if (!tray) {
      createTray();
    }
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
