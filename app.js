/* eslint-env browser */
/* global L, PLACES */

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Primary category for the marker / card colour. Order matters: first match wins.
const CATEGORY_PRIORITY = ["bakery", "dessert", "breakfast", "café", "dinner", "lunch"];
function primaryCategory(place) {
  for (const cat of CATEGORY_PRIORITY) {
    if (place.tags.includes(cat)) return cat;
  }
  return "lunch";
}

// Meal-time sort key.
const MEAL_RANK = { breakfast: 0, lunch: 1, dinner: 2 };
function mealKey(place) {
  let best = 9;
  for (const t of place.tags) if (t in MEAL_RANK) best = Math.min(best, MEAL_RANK[t]);
  return best;
}

// Region sort key — north to south.
const REGION_RANK = { north: 0, naze: 1, central: 2, south: 3 };
function regionKey(place) {
  for (const t of place.tags) if (t in REGION_RANK) return REGION_RANK[t];
  return 9;
}

// Tag → readable label for chips inside the card meta row.
const TAG_LABELS = {
  "must-visit": "★ must-visit",
  "local-vibe": "local",
  "ice-cream": "ice cream",
};
function tagLabel(t) { return TAG_LABELS[t] || t; }

// ---------- state ----------
const state = {
  activeFilters: new Set(),  // selected tag chips
  search: "",
  sort: "must-visit",
};

// ---------- map ----------
const map = L.map("map", {
  center: [28.34, 129.50],
  zoom: 10,
  minZoom: 9,
  maxZoom: 18,
  scrollWheelZoom: true,
});

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
    '© <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// Legend (bottom-right) showing the marker colour key.
const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = [
    ["breakfast", "Breakfast"],
    ["lunch", "Lunch"],
    ["dinner", "Dinner"],
    ["café", "Café"],
    ["bakery", "Bakery"],
    ["dessert", "Dessert"],
  ]
    .map(([cat, label]) =>
      `<div><span class="swatch" style="background:var(--m-${cat === "café" ? "cafe" : cat})"></span>${label}</div>`
    )
    .join("");
  return div;
};
legend.addTo(map);

// ---------- markers ----------
const markersByName = new Map();
function buildMarker(place) {
  const cat = primaryCategory(place);
  const must = place.mustVisit;
  const size = must ? 22 : 18;
  const icon = L.divIcon({
    className: "",
    html: `<div class="pin${must ? " must-visit" : ""}" data-cat="${cat}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],   // anchor at centre = exact lat/lng
    popupAnchor: [0, -size / 2],
  });
  const marker = L.marker([place.lat, place.lng], { icon, title: place.name });
  marker.bindPopup(
    `<div class="pop-name">${place.mustVisit ? "★ " : ""}${escapeHtml(place.name)}</div>` +
    `<div class="pop-desc">${escapeHtml(place.description)}</div>` +
    `<a href="${place.url}" target="_blank" rel="noopener">Open in Google Maps →</a>`
  );
  marker.on("click", () => focusCard(place.name));
  return marker;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build all markers once.
const allMarkers = PLACES.map((p) => {
  const m = buildMarker(p);
  markersByName.set(p.name, { marker: m, place: p });
  return m;
});
const markerLayer = L.layerGroup(allMarkers).addTo(map);

// ---------- list rendering ----------
const listEl = $("#list");
const countEl = $("#visible-count");

function passesFilters(place) {
  // Search match (name or description, case insensitive)
  if (state.search) {
    const q = state.search.toLowerCase();
    if (
      !place.name.toLowerCase().includes(q) &&
      !place.description.toLowerCase().includes(q)
    ) {
      return false;
    }
  }
  // All selected tags must be present (AND across chips for precision)
  for (const t of state.activeFilters) {
    if (t === "must-visit") {
      if (!place.mustVisit) return false;
    } else if (!place.tags.includes(t)) {
      return false;
    }
  }
  return true;
}

function sortedPlaces(places) {
  const arr = places.slice();
  switch (state.sort) {
    case "name":
      arr.sort((a, b) => a.name.localeCompare(b.name, "en"));
      break;
    case "meal":
      arr.sort((a, b) => mealKey(a) - mealKey(b) || a.name.localeCompare(b.name));
      break;
    case "region":
      arr.sort((a, b) => regionKey(a) - regionKey(b) || a.name.localeCompare(b.name));
      break;
    case "must-visit":
    default:
      arr.sort((a, b) => Number(b.mustVisit) - Number(a.mustVisit) || a.name.localeCompare(b.name));
      break;
  }
  return arr;
}

function cardHtml(place) {
  const cat = primaryCategory(place);
  const tags = place.tags
    .map((t) => `<span class="tag">${escapeHtml(tagLabel(t))}</span>`)
    .join("");
  const star = place.mustVisit ? `<span class="must">★</span>` : "";
  return `
    <article class="card" data-name="${escapeHtml(place.name)}" data-cat="${cat}">
      <div class="name">${star}${escapeHtml(place.name)}</div>
      <div class="desc">${escapeHtml(place.description)}</div>
      <div class="meta">${tags}</div>
      <a class="gmaps" href="${place.url}" target="_blank" rel="noopener">Open in Google Maps →</a>
    </article>
  `;
}

function render() {
  const visible = sortedPlaces(PLACES.filter(passesFilters));
  countEl.textContent = visible.length;

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="empty">No places match these filters.</div>`;
  } else {
    listEl.innerHTML = visible.map(cardHtml).join("");
  }

  // Sync marker visibility.
  const visibleNames = new Set(visible.map((p) => p.name));
  markersByName.forEach(({ marker }, name) => {
    if (visibleNames.has(name)) {
      if (!map.hasLayer(marker)) markerLayer.addLayer(marker);
    } else if (map.hasLayer(marker)) {
      markerLayer.removeLayer(marker);
    }
  });

  // Wire card clicks (rebound each render).
  $$(".card", listEl).forEach((card) => {
    card.addEventListener("click", (ev) => {
      // Don't hijack the Google Maps link.
      if (ev.target.closest("a")) return;
      const name = card.dataset.name;
      const entry = markersByName.get(name);
      if (!entry) return;
      map.flyTo([entry.place.lat, entry.place.lng], 16, { duration: 0.6 });
      entry.marker.openPopup();
      focusCard(name);
    });
  });
}

function focusCard(name) {
  $$(".card", listEl).forEach((c) => c.classList.toggle("focused", c.dataset.name === name));
  const target = $(`.card[data-name="${cssEscape(name)}"]`, listEl);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function cssEscape(s) {
  return s.replace(/(["\\])/g, "\\$1");
}

// ---------- wiring ----------
$("#search").addEventListener("input", (e) => {
  state.search = e.target.value.trim();
  render();
});

$("#sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

$$(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const tag = chip.dataset.tag;
    if (state.activeFilters.has(tag)) {
      state.activeFilters.delete(tag);
      chip.classList.remove("active");
    } else {
      state.activeFilters.add(tag);
      chip.classList.add("active");
    }
    render();
  });
});

$("#clear-filters").addEventListener("click", () => {
  state.activeFilters.clear();
  state.search = "";
  $("#search").value = "";
  $$(".chip.active").forEach((c) => c.classList.remove("active"));
  render();
});

// Initial paint + fit to bounds.
render();
const bounds = L.latLngBounds(PLACES.map((p) => [p.lat, p.lng]));
map.fitBounds(bounds, { padding: [40, 40] });

// Make sure Leaflet picks up the final container size once flex/grid settles,
// and on every window resize.
window.addEventListener("resize", () => map.invalidateSize());
setTimeout(() => map.invalidateSize(), 100);
