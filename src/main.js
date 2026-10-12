// Bal'harm — entry del bundle. Gli import "side effect" mantengono lo stesso
// ordine con cui index.html caricava gli script: i file appendono i loro
// moduli a window.Bh, quindi l'ordine è significativo.
import "./globals.js";

// Dati, i18n, helper, scena
import "./data/categories.js";
import "./data/geography.js";
import "./data/curiosities.js";
import "./i18n/copy.js";
import "./lib/format.js";
import "./lib/audio.js";
import "./lib/device.js";
import "./lib/analytics.js";
import "./map/cesium/scene.js";
import "./map/cesium/landmarks.js";
import "./map/cesium/lights.js";
import "./map/cesium/pins.js";
import "./map/cesium/touch.js";
import "./map/cesium/recovery.js";
import "./map/cesium/index.js";

// UI React
import "./ui/Cornice.jsx";
import "./ui/BottomSheet.jsx";
import "./ui/Filters.jsx";
// Timeline disattivata per ora — riattivare togliendo il commento
// import "./ui/Timeline.jsx";
import "./ui/Modal.jsx";
import "./ui/GeoCard.jsx";
import "./ui/TopBar.jsx";
import "./app.jsx";
