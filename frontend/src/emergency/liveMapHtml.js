// ============================================================================
// The live map document — Leaflet in a WebView, not react-native-maps
//
// Why a WebView and not react-native-maps, which is the obvious choice:
// react-native-maps on Android has no non-Google native provider. Even with
// `provider={null}`, the Android view it instantiates is Google's MapView;
// `mapType="none"` is what actually stops it fetching Google tiles, leaving
// an OSM `UrlTile` overlay to supply the imagery. That arrangement is widely
// reported to work without an API key, but "widely reported" is not the same
// as verified, and it also requires Google Play Services to be present on the
// device at all. Leaflet has neither dependency: it renders OSM the same way
// any browser does, on any device.
//
// The cost that bought — react-native-webview is itself a native module, so
// this still needs a fresh EAS build — turned out not to be a cost at all,
// because react-native-maps needed one too. With build cost equal, the
// approach with no unknown in it won. See BUILD_LOG.md's entry for this step.
//
// This file is one static HTML document with no data baked into it. Every
// piece of live data (the marker, the safe-zone circles) arrives afterwards
// through `injectJavaScript` calling the `window.EC` functions defined at the
// bottom — so nothing user-controlled is ever interpolated into this string,
// and the document itself never has to be rebuilt to show a new position.
//
// Messages back to React Native, via `window.ReactNativeWebView.postMessage`:
//
//   {"type":"ready"}          Leaflet loaded and the map exists; safe to inject
//   {"type":"leaflet_failed"} the CDN did not load — surfaced in the app, not
//                             left as a blank grey rectangle
//   {"type":"panned"}         the person moved the map by hand; the screen
//                             turns follow-mode off so the next poll doesn't
//                             yank the view back out from under them
// ============================================================================

// Pinned, not floating on @latest: a map that silently changes behaviour
// because a CDN moved is exactly the kind of failure that would be blamed on
// this feature months later.
const LEAFLET_VERSION = '1.9.4';

// OSM's own tile server. Fine for development and a demo; their tile usage
// policy does not permit a distributed app to point at it in production —
// that needs a real tile host (MapTiler, Thunderforest, self-hosted). Flagged
// in BUILD_LOG.md rather than silently shipped as if it were settled.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const LIVE_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #F7F8FA; }
  .leaflet-control-attribution { font-size: 10px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"></script>
<script>
(function () {
  function send(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  // The CDN not loading is a real, recoverable state, not a crash: the screen
  // shows "Could not load the map" instead of an empty grey box that looks
  // like the elderly person has no location.
  if (typeof L === 'undefined') {
    send({ type: 'leaflet_failed' });
    return;
  }

  // Centred on nothing in particular at zoom 2 until the first real position
  // arrives — deliberately not a plausible-looking default location, which
  // would be indistinguishable from a real (wrong) reading for a moment.
  var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([20, 0], 2);

  L.tileLayer('${TILE_URL}', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var elderMarker = null;   // the person
  var accuracyRing = null;  // how precise that reading claims to be
  var zoneLayers = [];      // safe-zone circles
  var lastLatLng = null;

  // Dragging the map turns following off. Bound to 'dragstart' alone on
  // purpose: it is the one event only a hand produces — the programmatic
  // setView/panTo in EC.setElder below does not fire it, so following never
  // switches itself off as a side effect of doing its own job. Zoom is
  // deliberately not bound: Leaflet gives no way to tell a pinch from a
  // programmatic zoom, and wanting a closer look isn't the same as wanting
  // to stop following.
  map.on('dragstart', function () { send({ type: 'panned' }); });

  window.EC = {
    // One position, plus whether it is stale enough to say so visually. Colour
    // is the whole signal here: a fresh fix and a two-hour-old fix look
    // identical on a map otherwise, and the age is the thing family actually
    // needs to weigh.
    setElder: function (point) {
      var latLng = [point.lat, point.lng];
      lastLatLng = latLng;
      var color = point.stale ? '#B45309' : '#1D4ED8';

      if (!elderMarker) {
        elderMarker = L.circleMarker(latLng, {
          radius: 10, color: '#FFFFFF', weight: 3, fillColor: color, fillOpacity: 1
        }).addTo(map);
      } else {
        elderMarker.setLatLng(latLng);
        elderMarker.setStyle({ fillColor: color });
      }

      // The accuracy ring is drawn only when the reading carries one. A fix
      // reported as accurate to 100m is a materially different claim from one
      // accurate to 8m, and drawing both as the same dot overstates the
      // precise one and hides the vague one.
      if (point.accuracy && point.accuracy > 0) {
        if (!accuracyRing) {
          accuracyRing = L.circle(latLng, {
            radius: point.accuracy, color: color, weight: 1, opacity: 0.5,
            fillColor: color, fillOpacity: 0.10
          }).addTo(map);
        } else {
          accuracyRing.setLatLng(latLng);
          accuracyRing.setRadius(point.accuracy);
          accuracyRing.setStyle({ color: color, fillColor: color });
        }
      } else if (accuracyRing) {
        map.removeLayer(accuracyRing);
        accuracyRing = null;
      }

      if (point.follow) {
        if (map.getZoom() < 15) {
          map.setView(latLng, 16);
        } else {
          map.panTo(latLng);
        }
      }
    },

    setZones: function (zones) {
      for (var i = 0; i < zoneLayers.length; i++) map.removeLayer(zoneLayers[i]);
      zoneLayers = [];
      for (var j = 0; j < zones.length; j++) {
        var z = zones[j];
        var circle = L.circle([z.lat, z.lng], {
          radius: z.radius, color: '#047857', weight: 2, opacity: 0.8,
          fillColor: '#047857', fillOpacity: 0.10
        }).addTo(map);
        if (z.name) circle.bindTooltip(z.name, { permanent: false, direction: 'top' });
        zoneLayers.push(circle);
      }
    },

    recentre: function () {
      if (lastLatLng) map.setView(lastLatLng, Math.max(map.getZoom(), 16));
    }
  };

  send({ type: 'ready' });
}());
</script>
</body>
</html>`;
