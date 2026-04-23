import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, screen } from 'electron';
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
const DEFAULT_THEME = 'hud';
const THEMES = ['minimal', 'hud'];
const AUTO_START_REMINDERS = false;
const NOTIFICATION_BODIES = [
  'Your eyeballs called. They\'re thirsty.',
  'Stop doomscrolling for 20 seconds.',
  'Plot twist: your monitor isn\'t your bestie.',
  'Stare at something that isn\'t glowing.',
  'That spreadsheet can wait. Look away.',
  'Eye yoga break. Pose: Anywhere But Here.',
  'Glance into the distance like you\'re in a music video.',
  'Window gazing is a respected art form. Go.',
  'Your future self is begging you to look away.',
  'Unclench your face. Drop your shoulders. Blink.',
  'Soft blinks. Hard eye roll. Whatever works.',
  'Your eyelids deserve a union break.',
  'Look up. Not figuratively. Literally.',
  'Give your cornea a vacation.',
  'Dry eyes? Fake blink five times. Then do real ones.',
  'The corner of the room hasn\'t seen you in hours.',
  'Close your eyes. Picture a beach. Back to work.',
  'Look 20 feet away. Stay there 20 seconds.',
  'Your eyes are tired. Fix it.',
  'Blink like you mean it.',
];
const SHORTCUT_TOGGLE = 'CommandOrControl+Option+B';
const SHORTCUT_INSTANT = 'CommandOrControl+Option+Shift+B';
const SETTINGS_FILE_NAME = 'settings.json';
const BREAK_WINDOW_WIDTH = 360;
const BREAK_WINDOW_HEIGHT = 320;
const DIM_OPACITY = 0.55;
const DIM_FADE_MS = 280;
const BREAK_SOUND_PATH = '/System/Library/Sounds/Glass.aiff';
const INTERVAL_OPTIONS = [
  { label: '10 sec', value: 10 * 1000, devOnly: true },
  { label: '20 sec', value: 20 * 1000, devOnly: true },
  { label: '5 min', value: 5 * 60 * 1000 },
  { label: '10 min', value: 10 * 60 * 1000 },
  { label: '20 min', value: 20 * 60 * 1000 },
];
const BREAK_DURATION_OPTIONS = [
  { label: '20 sec', value: 20 },
  { label: '30 sec', value: 30 },
  { label: '60 sec', value: 60 },
];
const SNOOZE_OPTIONS = [
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour',     value: 60 * 60 * 1000 },
];

let tray = null;
let reminderInterval = null;
let trayMenu = null;
let currentIntervalMs = IS_DEV ? DEV_DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS;
let currentBreakDurationSeconds = DEFAULT_BREAK_DURATION_SECONDS;
let currentTheme = DEFAULT_THEME;
let settingsPath = '';
let iconRunning = null;
let iconPaused = null;
let lastNotificationBodyIndex = -1;
let breakWindow = null;
let dimOverlays = [];
let snoozeTimeoutId = null;
let snoozeUntil = null;

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
    if (typeof parsed.currentTheme === 'string' && THEMES.includes(parsed.currentTheme)) {
      currentTheme = parsed.currentTheme;
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
      JSON.stringify({ currentIntervalMs, currentBreakDurationSeconds, currentTheme }, null, 2),
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

function escapeHtml(text) {
  return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildMinimalBreakHtml(bodyText, durationSeconds) {
  const safeBody = escapeHtml(bodyText);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; }
  @keyframes pulse {
    0%   { transform: scale(1);    opacity: 1; }
    40%  { transform: scale(1.09); opacity: 0.85; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-4px); }
  }
  @keyframes blink {
    0%, 88%, 100% { transform: scaleY(1); }
    92%, 95%      { transform: scaleY(0.08); }
  }
  @keyframes lookAround {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-4px); }
    55%      { transform: translateX(3px); }
    80%      { transform: translateX(0); }
  }
  body {
    background: rgba(18, 18, 20, 0.94);
    color: #f1f1f2;
    border-radius: 14px;
    overflow: hidden;
    -webkit-user-select: none;
    -webkit-app-region: drag;
    transform: scaleY(0);
    transform-origin: center center;
    transition: transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  body.entered { transform: scaleY(1); }
  body.leaving {
    transform: scaleY(0);
    transition: transform 400ms cubic-bezier(0.76, 0, 0.84, 0);
  }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 24px 28px; text-align: center;
  }
  .eye-wrap {
    margin-bottom: 12px;
    animation: float 3.2s ease-in-out infinite;
  }
  .eye { width: 84px; height: 50px; transform-origin: 50% 50%; animation: blink 3.8s infinite; }
  .pupil-group { animation: lookAround 5.5s ease-in-out infinite; transform-origin: 50% 50%; }
  .title { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 10px; }
  .body { font-size: 15px; line-height: 1.4; color: rgba(255,255,255,0.9); margin-bottom: 14px; max-width: 280px; }
  .count {
    font-size: 60px; font-weight: 200; letter-spacing: -2px;
    font-variant-numeric: tabular-nums;
    transform-origin: center;
    line-height: 1;
  }
  .count.pulse { animation: pulse 320ms ease-out; }
  .skip {
    -webkit-app-region: no-drag;
    position: absolute; top: 10px; right: 12px;
    background: transparent; border: none;
    color: rgba(255,255,255,0.45); font-size: 12px;
    cursor: pointer; padding: 6px 10px; border-radius: 6px;
    transition: color 120ms ease, background 120ms ease;
  }
  .skip:hover { color: #fff; background: rgba(255,255,255,0.08); }
</style>
</head>
<body>
  <button class="skip" id="skip">Skip</button>
  <div class="wrap">
    <div class="eye-wrap">
      <svg class="eye" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="eyeClip"><path d="M4 30 Q 50 -2 96 30 Q 50 62 4 30 Z"/></clipPath></defs>
        <path d="M4 30 Q 50 -2 96 30 Q 50 62 4 30 Z" fill="#f5f5f7"/>
        <g clip-path="url(#eyeClip)" class="pupil-group">
          <circle cx="50" cy="30" r="17" fill="#4aa3ff"/>
          <circle cx="50" cy="30" r="9"  fill="#121218"/>
          <circle cx="54.5" cy="25" r="3" fill="#ffffff" opacity="0.95"/>
          <circle cx="46" cy="33" r="1.4" fill="#ffffff" opacity="0.6"/>
        </g>
      </svg>
    </div>
    <div class="title">Break time</div>
    <div class="body">${safeBody}</div>
    <div class="count" id="count">${durationSeconds}</div>
  </div>
  <script>
    const CLOSE_DELAY = 420;
    let seconds = ${durationSeconds};
    const el = document.getElementById('count');

    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('entered');
    }));

    function closeWithFade() {
      document.body.classList.remove('entered');
      document.body.classList.add('leaving');
      setTimeout(() => window.close(), CLOSE_DELAY);
    }

    const tick = setInterval(() => {
      seconds -= 1;
      el.textContent = String(seconds);
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      if (seconds <= 0) { clearInterval(tick); closeWithFade(); }
    }, 1000);

    document.getElementById('skip').addEventListener('click', () => {
      clearInterval(tick);
      closeWithFade();
    });
  </script>
</body>
</html>`;
}

function buildHudBreakHtml(bodyText, durationSeconds) {
  const safeBody = escapeHtml(bodyText);
  const RING_RADIUS = 44;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --accent: #00ff88;
    --accent-dim: rgba(0, 255, 136, 0.18);
    --accent-glow: rgba(0, 255, 136, 0.5);
    --bg: rgba(6, 10, 18, 0.96);
  }
  html, body { height: 100%; font-family: 'SF Mono', 'JetBrains Mono', Menlo, monospace; }
  @keyframes pulse {
    0%   { transform: scale(1);    opacity: 1; }
    40%  { transform: scale(1.09); opacity: 0.85; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-4px); }
  }
  @keyframes blink {
    0%, 88%, 100% { transform: scaleY(1); }
    92%, 95%      { transform: scaleY(0.08); }
  }
  @keyframes lookAround {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-4px); }
    55%      { transform: translateX(3px); }
    80%      { transform: translateX(0); }
  }
  body {
    background: var(--bg);
    color: rgba(255, 255, 255, 0.9);
    border-radius: 14px;
    border: 1px solid rgba(0, 255, 136, 0.22);
    overflow: hidden;
    position: relative;
    -webkit-user-select: none;
    -webkit-app-region: drag;
    transform: scaleY(0);
    transform-origin: center center;
    transition: transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 0 30px rgba(0, 255, 136, 0.15);
  }
  body.entered { transform: scaleY(1); }
  body.leaving {
    transform: scaleY(0);
    transition: transform 400ms cubic-bezier(0.76, 0, 0.84, 0);
  }
  body::before {
    content: '';
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 2px,
      rgba(255, 255, 255, 0.025) 2px,
      rgba(255, 255, 255, 0.025) 3px
    );
  }
  .corner {
    position: absolute; width: 14px; height: 14px; z-index: 2;
    border-color: var(--accent); border-style: solid; border-width: 0;
  }
  .corner.tl { top: 10px; left: 10px;  border-top-width: 1.5px; border-left-width: 1.5px;  }
  .corner.tr { top: 10px; right: 10px; border-top-width: 1.5px; border-right-width: 1.5px; }
  .corner.bl { bottom: 10px; left: 10px;  border-bottom-width: 1.5px; border-left-width: 1.5px;  }
  .corner.br { bottom: 10px; right: 10px; border-bottom-width: 1.5px; border-right-width: 1.5px; }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 22px 26px 20px; text-align: center;
    position: relative; z-index: 2;
  }
  .eye-wrap {
    margin-bottom: 8px;
    animation: float 3.2s ease-in-out infinite;
    filter: drop-shadow(0 0 6px var(--accent-glow));
  }
  .eye {
    width: 72px; height: 44px;
    transform-origin: 50% 50%;
    animation: blink 3.8s infinite;
  }
  .pupil-group { animation: lookAround 5.5s ease-in-out infinite; transform-origin: 50% 50%; }
  .title {
    font-size: 11px; letter-spacing: 3px; text-transform: uppercase;
    color: var(--accent); margin-bottom: 10px;
    text-shadow: 0 0 8px var(--accent-glow);
  }
  .body {
    font-size: 15px; line-height: 1.4;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 14px; max-width: 280px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  .ring-wrap { position: relative; width: 100px; height: 100px; }
  .ring-track { fill: none; stroke: var(--accent-dim); stroke-width: 2.5; }
  .ring-progress {
    fill: none; stroke: var(--accent); stroke-width: 2.5;
    stroke-linecap: round;
    transform: rotate(-90deg); transform-origin: 50% 50%;
    filter: drop-shadow(0 0 4px var(--accent-glow));
  }
  .count {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 38px; font-weight: 300; letter-spacing: -1px;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    text-shadow: 0 0 10px var(--accent-glow);
  }
  .count.pulse { animation: pulse 320ms ease-out; }
  .skip {
    -webkit-app-region: no-drag;
    position: absolute; top: 12px; right: 32px;
    background: transparent; border: 1px solid rgba(0, 255, 136, 0.3);
    color: rgba(0, 255, 136, 0.75); font-size: 10px;
    cursor: pointer; padding: 4px 10px; border-radius: 3px;
    letter-spacing: 2px; text-transform: uppercase;
    font-family: 'SF Mono', Menlo, monospace;
    transition: color 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
    z-index: 3;
  }
  .skip:hover {
    color: var(--accent); border-color: var(--accent);
    background: rgba(0, 255, 136, 0.08);
    box-shadow: 0 0 10px var(--accent-glow);
  }
</style>
</head>
<body>
  <div class="corner tl"></div>
  <div class="corner tr"></div>
  <div class="corner bl"></div>
  <div class="corner br"></div>
  <button class="skip" id="skip">Skip</button>
  <div class="wrap">
    <div class="eye-wrap">
      <svg class="eye" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="eyeClip">
            <path d="M4 30 Q 50 -2 96 30 Q 50 62 4 30 Z"/>
          </clipPath>
        </defs>
        <path d="M4 30 Q 50 -2 96 30 Q 50 62 4 30 Z"
              fill="#061018" stroke="#00ff88" stroke-width="1"/>
        <g clip-path="url(#eyeClip)" class="pupil-group">
          <circle cx="50" cy="30" r="17" fill="#00ff88"/>
          <circle cx="50" cy="30" r="9"  fill="#040812"/>
          <circle cx="54.5" cy="25" r="3" fill="#ffffff" opacity="0.95"/>
        </g>
      </svg>
    </div>
    <div class="title">// Break · Eye Rest //</div>
    <div class="body">${safeBody}</div>
    <div class="ring-wrap">
      <svg viewBox="0 0 100 100" width="100" height="100">
        <circle class="ring-track" cx="50" cy="50" r="${RING_RADIUS}"/>
        <circle class="ring-progress" id="ring" cx="50" cy="50" r="${RING_RADIUS}"
                stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(3)}" stroke-dashoffset="0"/>
      </svg>
      <div class="count" id="count">${durationSeconds}</div>
    </div>
  </div>
  <script>
    const CLOSE_DELAY = 420;
    const DURATION = ${durationSeconds};
    const CIRCUMFERENCE = ${RING_CIRCUMFERENCE.toFixed(3)};
    let seconds = DURATION;
    const el = document.getElementById('count');
    const ring = document.getElementById('ring');
    ring.style.transition = 'stroke-dashoffset 1000ms linear';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('entered');
    }));

    function closeWithFade() {
      document.body.classList.remove('entered');
      document.body.classList.add('leaving');
      setTimeout(() => window.close(), CLOSE_DELAY);
    }

    const tick = setInterval(() => {
      seconds -= 1;
      el.textContent = String(seconds);
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - seconds / DURATION));
      if (seconds <= 0) { clearInterval(tick); closeWithFade(); }
    }, 1000);

    document.getElementById('skip').addEventListener('click', () => {
      clearInterval(tick);
      closeWithFade();
    });
  </script>
</body>
</html>`;
}

function buildDimHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; -webkit-user-select: none; }
    body {
      background: rgba(0, 0, 0, ${DIM_OPACITY});
      opacity: 0;
      animation: dimIn ${DIM_FADE_MS}ms ease forwards;
      transition: opacity ${DIM_FADE_MS}ms ease;
    }
    @keyframes dimIn { to { opacity: 1; } }
    body.leaving { opacity: 0; }
  </style></head><body></body></html>`;
}

function openDimOverlays() {
  closeDimOverlays();
  const displays = screen.getAllDisplays();
  const html = 'data:text/html;charset=utf-8,' + encodeURIComponent(buildDimHtml());

  dimOverlays = displays.map((display) => {
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.once('ready-to-show', () => overlay.showInactive());
    overlay.loadURL(html);
    return overlay;
  });
}

function closeDimOverlays() {
  const overlays = dimOverlays;
  dimOverlays = [];
  for (const overlay of overlays) {
    if (!overlay || overlay.isDestroyed()) continue;
    overlay.webContents
      .executeJavaScript("document.body.classList.add('leaving')")
      .catch(() => {});
    setTimeout(() => {
      if (!overlay.isDestroyed()) overlay.close();
    }, DIM_FADE_MS);
  }
}

function playBreakSound() {
  if (process.platform !== 'darwin') return;
  execFile('afplay', [BREAK_SOUND_PATH], (err) => {
    if (err) console.error('Failed to play break sound:', err.message);
  });
}

function showBreak() {
  if (breakWindow && !breakWindow.isDestroyed()) return;

  playBreakSound();
  openDimOverlays();
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
    breakWindow?.moveTop();
  });

  breakWindow.on('closed', () => {
    breakWindow = null;
    closeDimOverlays();
  });

  const builder = currentTheme === 'hud' ? buildHudBreakHtml : buildMinimalBreakHtml;
  const html = builder(bodyText, currentBreakDurationSeconds);
  breakWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function isReminderRunning() {
  return reminderInterval !== null;
}

function isSnoozed() {
  return snoozeTimeoutId !== null;
}

function formatSnoozeRemaining() {
  if (!snoozeUntil) return '0 min';
  const minutes = Math.max(1, Math.ceil((snoozeUntil - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.round(minutes / 60)} hr` : `${minutes} min`;
}

function snooze(ms) {
  cancelSnoozeTimer();
  if (isReminderRunning()) stopReminders();
  snoozeUntil = Date.now() + ms;
  snoozeTimeoutId = setTimeout(() => {
    snoozeTimeoutId = null;
    snoozeUntil = null;
    startReminders();
  }, ms);
  updateTrayVisualState();
  rebuildTrayMenu();
}

function cancelSnoozeTimer() {
  if (snoozeTimeoutId) {
    clearTimeout(snoozeTimeoutId);
    snoozeTimeoutId = null;
    snoozeUntil = null;
  }
}

function cancelSnooze() {
  cancelSnoozeTimer();
  updateTrayVisualState();
  rebuildTrayMenu();
}

function resumeFromSnooze() {
  cancelSnoozeTimer();
  startReminders();
}

function updateTrayVisualState() {
  if (!tray) {
    return;
  }

  const isRunning = isReminderRunning();
  const stateLabel = isSnoozed()
    ? `snoozed (${formatSnoozeRemaining()} left)`
    : isRunning ? 'running' : 'paused';
  tray.setToolTip(`Blink Reminder: ${stateLabel} (${getIntervalLabel(currentIntervalMs)})`);
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

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  currentTheme = theme;
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
  if (isSnoozed()) {
    resumeFromSnooze();
    return;
  }
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

function buildThemeMenuItems() {
  return [
    { label: 'Minimal (dark)', type: 'radio', checked: currentTheme === 'minimal', click: () => setTheme('minimal') },
    { label: 'HUD (neon green)', type: 'radio', checked: currentTheme === 'hud', click: () => setTheme('hud') },
  ];
}

function buildSnoozeMenuItems() {
  return SNOOZE_OPTIONS.map((option) => ({
    label: option.label,
    click: () => snooze(option.value),
  }));
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  trayMenu = Menu.buildFromTemplate([
    {
      label: isSnoozed()
        ? `Snoozed (${formatSnoozeRemaining()} left)`
        : isReminderRunning() ? 'Reminders running' : 'Reminders paused',
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
      label: isSnoozed() ? 'Resume reminders now' : 'Start reminders',
      accelerator: SHORTCUT_TOGGLE,
      visible: !isReminderRunning(),
      click: () => (isSnoozed() ? resumeFromSnooze() : startReminders()),
    },
    {
      label: 'Stop reminders',
      accelerator: SHORTCUT_TOGGLE,
      visible: isReminderRunning(),
      click: () => stopReminders(),
    },
    {
      label: 'Snooze',
      submenu: buildSnoozeMenuItems(),
      visible: isReminderRunning(),
    },
    {
      label: 'Cancel snooze',
      visible: isSnoozed(),
      click: () => cancelSnooze(),
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
      label: 'Popup theme',
      submenu: buildThemeMenuItems(),
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
      rebuildTrayMenu();
      tray?.popUpContextMenu(trayMenu ?? undefined);
    });
  }

  tray.on('right-click', () => {
    rebuildTrayMenu();
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
