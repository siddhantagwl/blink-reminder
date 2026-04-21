import { app, Menu, Notification, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

const IS_DEV = !app.isPackaged;
const DEV_REMINDER_INTERVAL_MS = 10 * 1000;
const PROD_REMINDER_INTERVAL_MS = 20 * 60 * 1000;
const REMINDER_INTERVAL_MS = IS_DEV ? DEV_REMINDER_INTERVAL_MS : PROD_REMINDER_INTERVAL_MS;
const AUTO_START_REMINDERS = false;
const NOTIFICATION_TITLE = 'Blink reminder';
const NOTIFICATION_BODY = 'Blink 10 times and look away for 20 seconds.';

let tray = null;
let reminderInterval = null;
let trayMenu = null;

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
  tray.setToolTip(`Blink Reminder: ${isRunning ? 'running' : 'paused'}`);

  if (process.platform === 'darwin') {
    tray.setTitle(isRunning ? '👁 On' : '👁');
  }
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
      label: 'Show test notification',
      click: () => showBlinkNotification(),
    },
    {
      label: `Current interval: ${Math.round(REMINDER_INTERVAL_MS / 1000)} sec`,
      enabled: false,
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
  }, REMINDER_INTERVAL_MS);

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
  const trayIcon = hasIconFile ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
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
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  showBlinkNotification();

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
