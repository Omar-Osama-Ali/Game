// FLAGVERSE interactive map — renders real country boundaries with D3 + topojson
// and handles tap-to-answer plus free exploration.
const FVMap = (function () {
  const WORLD_ATLAS_URL =
    "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  // Approximate longitude/latitude bounding boxes used to auto-zoom the map
  // to a manageable region for small or hard-to-spot countries.
  const REGION_BOUNDS = {
    world: null,
    Africa: [[-25, -37], [55, 40]],
    Asia: [[24, -12], [155, 56]],
    Europe: [[-26, 33], [45, 72]],
    "North America": [[-172, 5], [-50, 84]],
    "South America": [[-84, -58], [-32, 14]],
    Oceania: [[110, -50], [185, 10]],
    middleEast: [[24, 11], [62, 43]],
    caribbean: [[-90, 8], [-58, 28]],
    europeSmall: [[-11, 34], [30, 55]],
  };

  let svgEl, gEl, projection, path, zoomBehavior;
  let worldFeatures = null;
  let byN3 = {}; // numeric id (as number) -> topojson feature
  let n3ToCountry = {}; // numeric id (string, our db format) -> country record
  let onSelectCallback = null;
  let currentTargetN3 = null;
  let width = 800;
  let height = 500;

  function init(svgSelector, countries) {
    svgEl = d3.select(svgSelector);
    width = svgEl.node().clientWidth || 800;
    height = svgEl.node().clientHeight || 500;
    svgEl.attr("viewBox", `0 0 ${width} ${height}`);
    gEl = svgEl.append("g").attr("class", "fv-map-layer");

    projection = d3.geoNaturalEarth1();
    path = d3.geoPath(projection);

    zoomBehavior = d3
      .zoom()
      .scaleExtent([1, 12])
      .on("zoom", (event) => {
        gEl.attr("transform", event.transform);
      });
    svgEl.call(zoomBehavior);

    countries.forEach((c) => {
      n3ToCountry[String(Number(c.iso_n3))] = c;
    });

    return loadWorld();
  }

  function loadWorld() {
    if (worldFeatures) return Promise.resolve(worldFeatures);
    return fetch(WORLD_ATLAS_URL)
      .then((r) => r.json())
      .then((topo) => {
        const geo = topojson.feature(topo, topo.objects.countries);
        worldFeatures = geo.features;
        worldFeatures.forEach((f) => {
          byN3[String(Number(f.id))] = f;
        });
        return worldFeatures;
      });
  }

  function resize() {
    if (!svgEl) return;
    width = svgEl.node().clientWidth || width;
    height = svgEl.node().clientHeight || height;
    svgEl.attr("viewBox", `0 0 ${width} ${height}`);
  }

  function fitTo(featureCollectionLike) {
    projection.fitExtent(
      [
        [16, 16],
        [width - 16, height - 16],
      ],
      featureCollectionLike
    );
  }

  function boundsToFeatureCollection(bounds) {
    const [[minLon, minLat], [maxLon, maxLat]] = bounds;
    return {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    };
  }

  // Renders the given features. `regionBoundsKey` (optional) zooms the
  // projection to a predefined region instead of showing the whole world.
  function render(features, { interactive, onSelect, regionBoundsKey } = {}) {
    resize();
    onSelectCallback = interactive ? onSelect : null;

    if (regionBoundsKey && REGION_BOUNDS[regionBoundsKey]) {
      fitTo(boundsToFeatureCollection(REGION_BOUNDS[regionBoundsKey]));
    } else {
      fitTo({ type: "FeatureCollection", features });
    }

    const sel = gEl.selectAll("path.fv-country").data(features, (d) => d.id);
    sel.exit().remove();

    const merged = sel
      .enter()
      .append("path")
      .attr("class", "fv-country")
      .merge(sel)
      .attr("d", path)
      .attr("data-id", (d) => d.id)
      .classed("fv-interactive", !!interactive)
      .classed("fv-correct", false)
      .classed("fv-incorrect", false)
      .classed("fv-unavailable", (d) => !n3ToCountry[String(Number(d.id))]);

    merged.on("click", interactive ? handleClick : null);

    // Reset zoom transform on new render.
    svgEl.call(zoomBehavior.transform, d3.zoomIdentity);
  }

  function handleClick(event, feature) {
    if (!onSelectCallback) return;
    const country = n3ToCountry[String(Number(feature.id))];
    onSelectCallback(country, feature);
  }

  // Highlights result after an answer: correct country green, wrong tap red.
  function showResult(correctN3, tappedN3) {
    gEl
      .selectAll("path.fv-country")
      .classed("fv-correct", (d) => Number(d.id) === Number(correctN3))
      .classed(
        "fv-incorrect",
        (d) => tappedN3 != null && Number(d.id) === Number(tappedN3) && Number(tappedN3) !== Number(correctN3)
      );
  }

  function getFeaturesForRegion(region, countries) {
    return loadWorld().then((features) => {
      if (!region || region === "world") return features;
      if (region === "custom") {
        const set = new Set(countries.map((c) => Number(c.iso_n3)));
        return features.filter((f) => set.has(Number(f.id)));
      }
      if (region === "middleEast") {
        const set = new Set(
          countries.filter((c) => c.middleEast).map((c) => Number(c.iso_n3))
        );
        return features.filter((f) => set.has(Number(f.id)));
      }
      const contMap = {
        africa: "Africa",
        asia: "Asia",
        europe: "Europe",
        northAmerica: "North America",
        southAmerica: "South America",
        oceania: "Oceania",
      };
      const cont = contMap[region];
      if (!cont) return features;
      const set = new Set(
        countries.filter((c) => c.continent === cont).map((c) => Number(c.iso_n3))
      );
      return features.filter((f) => set.has(Number(f.id)));
    });
  }

  function boundsKeyForCountry(country, regionSelected) {
    if (regionSelected === "middleEast") return "middleEast";
    if (country.difficulty >= 4) {
      if (country.continent === "Europe") return "europeSmall";
      if (country.continent === "North America") return "caribbean";
      return country.continent;
    }
    if (regionSelected && regionSelected !== "world") {
      const contMap = {
        africa: "Africa",
        asia: "Asia",
        europe: "Europe",
        northAmerica: "North America",
        southAmerica: "South America",
        oceania: "Oceania",
      };
      return contMap[regionSelected] || null;
    }
    return null;
  }

  function clearHighlights() {
    if (!gEl) return;
    gEl.selectAll("path.fv-country").classed("fv-correct", false).classed("fv-incorrect", false);
  }

  function zoomBy(factor) {
    if (!svgEl || !zoomBehavior) return;
    svgEl.transition().duration(180).call(zoomBehavior.scaleBy, factor);
  }

  function zoomReset() {
    if (!svgEl || !zoomBehavior) return;
    svgEl.transition().duration(180).call(zoomBehavior.transform, d3.zoomIdentity);
  }

  return {
    init,
    render,
    showResult,
    clearHighlights,
    getFeaturesForRegion,
    boundsKeyForCountry,
    zoomBy,
    zoomReset,
    REGION_BOUNDS,
  };
})();
