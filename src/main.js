import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

const IS_DEV = !app.isPackaged;
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;
const DEV_DEFAULT_INTERVAL_MS = 10 * 1000;
const MIN_INTERVAL_MS = 5 * 1000;
const MAX_INTERVAL_MINUTES = 120;
const DEFAULT_BREAK_DURATION_SECONDS = 20;
const AUTO_START_REMINDERS = false;
const NOTIFICATION_BODIES = [
  'Blink 10 times and look away for 20 seconds.',
  'Look at something 20 feet away for 20 seconds.',
  'Give your eyes a rest — blink and refocus.',
  'Soft blinks. Let your eyes reset.',
  'Unlock your jaw, drop your shoulders, and blink.',
  'Look far, then near. Your eyes need the workout.',
  'Close your eyes for a moment. Breathe.',
  'Blink slowly a few times. Notice anything dry?',
];
const SHORTCUT_TOGGLE = 'CommandOrControl+Option+B';
const SHORTCUT_INSTANT = 'CommandOrControl+Option+Shift+B';
const SETTINGS_FILE_NAME = 'settings.json';
const BREAK_WINDOW_WIDTH = 340;
const BREAK_WINDOW_HEIGHT = 220;
const INTERVAL_OPTIONS = [
  { label: '10 sec', value: 10 * 1000, devOnly: true },
  { label: '20 sec', value: 20 * 1000, devOnly: true },
];
const BREAK_DURATION_OPTIONS = [
  { label: '20 sec', value: 20 },
  { label: '30 sec', value: 30 },
  { label: '60 sec', value: 60 },
];

let tray = null;
let reminderInterval = null;
let trayMenu = null;
let currentIntervalMs = IS_DEV ? DEV_DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS;
let currentBreakDurationSeconds = DEFAULT_BREAK_DURATION_SECONDS;
let settingsPath = '';
let iconRunning = null;
let iconPaused = null;
let lastNotificationBodyIndex = -1;
let breakWindow = null;

function loadTrayIcons() {
  const running = nativeImage.createFromPath(path.join(__dirname, 'iconTemplate.png'));
  const paused = nativeImage.createFromPath(path.join(__dirname, 'iconTemplatePaused.png'));
  if (process.platform === 'darwin') {
    running.setTemplateImage(true);
    paused.setTemplateImage(true);
  }
  iconRunning = running;
  iconPaused = paused;
}

function getVisibleIntervalOptions() {
  return INTERVAL_OPTIONS.filter((option) => IS_DEV || !option.devOnly);
}

function getIntervalLabel(intervalMs) {
  const matchedOption = INTERVAL_OPTIONS.find((option) => option.value === intervalMs);
  if (matchedOption) return matchedOption.label;
  const totalSeconds = Math.round(intervalMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const minutes = intervalMs / 60000;
  const rounded = Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10;
  return `${rounded} min`;
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
    if (typeof parsed.currentBreakDurationSeconds === 'number') {
      currentBreakDurationSeconds = parsed.currentBreakDurationSeconds;
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
      JSON.stringify({ currentIntervalMs, currentBreakDurationSeconds }, null, 2),
      'utf8',
    );
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

function pickNextNotificationBody() {
  if (NOTIFICATION_BODIES.length === 1) return NOTIFICATION_BODIES[0];
  let index;
  do {
    index = Math.floor(Math.random() * NOTIFICATION_BODIES.length);
  } while (index === lastNotificationBodyIndex);
  lastNotificationBodyIndex = index;
  return NOTIFICATION_BODIES[index];
}

function buildBreakHtml(bodyText, durationSeconds) {
  const safeBody = String(bodyText).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; }
  body {
    background: rgba(18, 18, 20, 0.94);
    color: #f1f1f2;
    border-radius: 14px;
    overflow: hidden;
    -webkit-user-select: none;
    -webkit-app-region: drag;
  }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 20px 24px; text-align: center;
  }
  .title { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 10px; }
  .body { font-size: 15px; line-height: 1.35; color: rgba(255,255,255,0.88); margin-bottom: 14px; max-width: 260px; }
  .count { font-size: 72px; font-weight: 200; letter-spacing: -3px; font-variant-numeric: tabular-nums; }
  .skip {
    -webkit-app-region: no-drag;
    position: absolute; top: 10px; right: 12px;
    background: transparent; border: none;
    color: rgba(255,255,255,0.45); font-size: 12px;
    cursor: pointer; padding: 6px 10px; border-radius: 6px;
  }
  .skip:hover { color: #fff; background: rgba(255,255,255,0.08); }
</style>
</head>
<body>
  <button class="skip" id="skip">Skip</button>
  <div class="wrap">
    <div class="title">Break time</div>
    <div class="body">${safeBody}</div>
    <div class="count" id="count">${durationSeconds}</div>
  </div>
  <script>
    let seconds = ${durationSeconds};
    const el = document.getElementById('count');
    const tick = setInterval(() => {
      seconds -= 1;
      el.textContent = String(seconds);
      if (seconds <= 0) { clearInterval(tick); window.close(); }
    }, 1000);
    document.getElementById('skip').addEventListener('click', () => {
      clearInterval(tick);
      window.close();
    });
  </script>
</body>
</html>`;
}

function showBreak() {
  if (breakWindow && !breakWindow.isDestroyed()) return;

  const bodyText = pickNextNotificationBody();
  breakWindow = new BrowserWindow({
    width: BREAK_WINDOW_WIDTH,
    height: BREAK_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  breakWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  breakWindow.setAlwaysOnTop(true, 'screen-saver');

  breakWindow.once('ready-to-show', () => {
    breakWindow?.showInactive();
  });

  breakWindow.on('closed', () => {
    breakWindow = null;
  });

  const html = buildBreakHtml(bodyText, currentBreakDurationSeconds);
  breakWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
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
  tray.setImage(isRunning ? iconRunning : iconPaused);
}

function restartRemindersIfRunning() {
  if (!isReminderRunning()) {
    updateTrayVisualState();
    rebuildTrayMenu();
    return;
  }

  clearInterval(reminderInterval);
  reminderInterval = setInterval(() => {
    showBreak();
  }, currentIntervalMs);

  updateTrayVisualState();
  rebuildTrayMenu();
}

function setIntervalMs(nextIntervalMs) {
  currentIntervalMs = nextIntervalMs;
  saveSettings();
  restartRemindersIfRunning();
}

function setBreakDurationSeconds(seconds) {
  currentBreakDurationSeconds = seconds;
  saveSettings();
  rebuildTrayMenu();
}

function promptCustomInterval() {
  const currentMinutes = currentIntervalMs / 60000;
  const defaultVal = currentMinutes >= 1 ? String(Math.round(currentMinutes * 10) / 10) : '5';
  const script = `display dialog "Reminder interval (in minutes):" default answer "${defaultVal}" buttons {"Cancel", "Set"} default button "Set" with title "Blink Reminder"`;
  execFile('osascript', ['-e', script], (err, stdout) => {
    if (err) return;
    const parts = stdout.split('text returned:');
    if (parts.length < 2) return;
    const value = parseFloat(parts[1].trim());
    if (!Number.isFinite(value) || value <= 0 || value > MAX_INTERVAL_MINUTES) return;
    const ms = Math.max(MIN_INTERVAL_MS, Math.round(value * 60 * 1000));
    setIntervalMs(ms);
  });
}

function toggleReminders() {
  if (isReminderRunning()) {
    stopReminders();
  } else {
    startReminders();
  }
}

function buildIntervalMenuItems() {
  const presets = getVisibleIntervalOptions().map((option) => ({
    label: option.label,
    type: 'radio',
    checked: currentIntervalMs === option.value,
    click: () => setIntervalMs(option.value),
  }));
  const customMatchesPreset = INTERVAL_OPTIONS.some((o) => o.value === currentIntervalMs);
  const customItem = {
    label: customMatchesPreset ? 'Custom...' : `Custom (${getIntervalLabel(currentIntervalMs)})...`,
    type: 'radio',
    checked: !customMatchesPreset,
    click: () => promptCustomInterval(),
  };
  return presets.length > 0 ? [...presets, { type: 'separator' }, customItem] : [customItem];
}

function buildBreakDurationMenuItems() {
  return BREAK_DURATION_OPTIONS.map((option) => ({
    label: option.label,
    type: 'radio',
    checked: currentBreakDurationSeconds === option.value,
    click: () => setBreakDurationSeconds(option.value),
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
      label: `Interval: ${getIntervalLabel(currentIntervalMs)} · Break: ${currentBreakDurationSeconds}s`,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Start reminders',
      accelerator: SHORTCUT_TOGGLE,
      enabled: !isReminderRunning(),
      click: () => startReminders(),
    },
    {
      label: 'Stop reminders',
      accelerator: SHORTCUT_TOGGLE,
      enabled: isReminderRunning(),
      click: () => stopReminders(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Reminder interval',
      submenu: buildIntervalMenuItems(),
    },
    {
      label: 'Break duration',
      submenu: buildBreakDurationMenuItems(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Show test break',
      accelerator: SHORTCUT_INSTANT,
      click: () => showBreak(),
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
    showBreak();
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
  loadTrayIcons();
  tray = new Tray(iconPaused);
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

function registerGlobalShortcuts() {
  const toggleOk = globalShortcut.register(SHORTCUT_TOGGLE, toggleReminders);
  if (!toggleOk) console.error(`Failed to register shortcut: ${SHORTCUT_TOGGLE}`);

  const instantOk = globalShortcut.register(SHORTCUT_INSTANT, showBreak);
  if (!instantOk) console.error(`Failed to register shortcut: ${SHORTCUT_INSTANT}`);
}

app.whenReady().then(() => {
  settingsPath = getSettingsPath();
  loadSettings();

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  registerGlobalShortcuts();

  if (AUTO_START_REMINDERS) {
    startReminders();
  }

  app.on('activate', () => {
    if (!tray) {
      createTray();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
