// Persistent settings stored in the browser's localStorage.
// Global keys: printerIp, cameraUrl, jogStep, zoom, contrast
// Per-camera (keyed by stream URL): flipH, flipV, jog (direction mapping)
const AxiscopeSettings = (() => {
    const KEY = 'axiscope_settings';

    function load() {
        try {
            return JSON.parse(localStorage.getItem(KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function save(settings) {
        try {
            localStorage.setItem(KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Could not save Axiscope settings:', e);
        }
    }

    function get(key, fallback) {
        const value = load()[key];
        return value === undefined || value === null ? fallback : value;
    }

    function set(key, value) {
        const settings = load();
        settings[key] = value;
        save(settings);
    }

    function getCamera(url) {
        if (!url) return {};
        return (load().cameras || {})[url] || {};
    }

    function setCamera(url, patch) {
        if (!url) return;
        const settings = load();
        settings.cameras = settings.cameras || {};
        settings.cameras[url] = Object.assign({}, settings.cameras[url], patch);
        save(settings);
    }

    return { get, set, getCamera, setCamera };
})();
