import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Cesium resta uno <script> classico (Build/Cesium/Cesium.js, già minificato)
// invece di passare dal bundler: il codice in src/ usa il globale `Cesium` e i
// Web Worker/asset di Cesium vanno comunque serviti come file statici.
// Viene copiato in dist/cesium/ e referenziato da index.html.
const CESIUM = "node_modules/cesium/Build/Cesium";

export default defineConfig({
  // "mpa": gli URL sconosciuti danno 404 (niente fallback su index.html), così
  // un dev.local.js assente non viene letto come JS dalla preview locale.
  appType: "mpa",
  // Il codice esistente usa il globale `React` con il JSX classico.
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  plugins: [
    {
      // Tag iniettati dopo l'elaborazione dell'HTML: Vite non deve né
      // risolverli né provare a bundlarli (sono file statici copiati sotto).
      name: "cesium-tags",
      transformIndexHtml: {
        order: "post",
        handler: () => [
          { tag: "link", attrs: { rel: "stylesheet", href: "/cesium/Widgets/widgets.css" }, injectTo: "head-prepend" },
          { tag: "script", children: 'window.CESIUM_BASE_URL = "/cesium/";', injectTo: "head-prepend" },
          { tag: "script", attrs: { defer: true, src: "/cesium/Cesium.js" }, injectTo: "head-prepend" },
        ],
      },
    },
    viteStaticCopy({
      // stripBase: 4 toglie node_modules/cesium/Build/Cesium → dist/cesium/{Cesium.js,Workers,…}
      targets: ["Cesium.js", "Workers", "ThirdParty", "Assets", "Widgets"].map((f) => ({
        src: `${CESIUM}/${f}`,
        dest: "cesium",
        rename: { stripBase: 4 },
      })),
    }),
  ],
  build: { target: "es2020" },
});
