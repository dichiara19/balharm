// Bal'harm — globali richiesti dal codice in src/ (IIFE che usano `React` e
// `ReactDOM` senza import). Va importato PER PRIMO da main.js: gli import ES
// sono hoisted, quindi i globali devono nascere in un modulo a parte.
// `Cesium` e `CESIUM_BASE_URL` sono invece impostati da index.html (script classico).
import React from "react";
import ReactDOM from "react-dom/client";

window.React = React;
window.ReactDOM = ReactDOM;
