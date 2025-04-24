document.addEventListener('DOMContentLoaded', function () {
    // --- Element References ---
    const sourceSelect = document.getElementById('source');
    const destinationSelect = document.getElementById('destination');
    const findRouteButton = document.getElementById('find-route');
    const saveRouteButton = document.getElementById('save-route');
    const shareRouteButton = document.getElementById('share-route');
    const printRouteButton = document.getElementById('print-route');
    const routeResultDiv = document.getElementById('route-result');
    const routeActionsDiv = document.getElementById('route-actions');
    const mapCardDiv = document.getElementById('map-card');
    const mapDiv = document.getElementById('map');
    const skeletonLoaderDiv = document.getElementById('skeleton-loader');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const darkModeIcon = darkModeToggle.querySelector('i');
    const statusMessageDiv = document.getElementById('status-message');
    const statusTextSpan = document.getElementById('status-text');
    const currentYearSpan = document.getElementById('current-year');

    // --- Constants ---
    const TIME_PER_STATION = 2; // Estimated minutes between stations
    const TIME_PER_LINE_CHANGE = 5; // Estimated minutes for line change
    const MAP_CENTER = [35.70, 51.39]; // Centered more accurately on Tehran metro network
    const MAP_DEFAULT_ZOOM = 11;
    const MAP_ROUTE_ZOOM_PADDING = [50, 50]; // Padding when fitting bounds
    const STATIONS_DATA_URL = 'https://m4tinbeigi-official.github.io/tehran-metro-data/data/stations.json';
    const DEBOUNCE_DELAY = 300; // ms for potential future debouncing

    // --- State Variables ---
    let stations = {};
    let map = null; // Leaflet Map instance
    let routeLayerGroup = null; // Layer group for route polylines and markers
    let savedRoutes = JSON.parse(localStorage.getItem('savedRoutes')) || [];
    let currentRoute = null; // Store the latest calculated route details

    // --- Initialization ---

    /** Sets the current year in the footer */
    function setFooterYear() {
        if (currentYearSpan) {
            currentYearSpan.textContent = new Date().getFullYear();
        }
    }

    /** Initializes the Leaflet map */
    function initializeMap() {
        if (map) { // If map exists, remove it first
            map.remove();
            map = null;
        }
        map = L.map(mapDiv, {
           zoomControl: false // Disable default zoom, add custom later
        }).setView(MAP_CENTER, MAP_DEFAULT_ZOOM);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
            maxZoom: 18,
        }).addTo(map);

        // Initialize layer group for route elements
        routeLayerGroup = L.layerGroup().addTo(map);

        // Add custom zoom control
        L.control.zoom({ position: 'topright' }).addTo(map);
    }

    /** Sets dark mode based on preference or system setting */
    function initializeDarkMode() {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const savedTheme = localStorage.getItem('theme');

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.body.classList.add('dark-mode');
            darkModeIcon.classList.replace('fa-moon', 'fa-sun');
        } else {
            document.body.classList.remove('dark-mode');
            darkModeIcon.classList.replace('fa-sun', 'fa-moon');
        }
    }

    /** Fetches and processes station data */
    async function loadStationData() {
        showStatusMessage('در حال بارگذاری اطلاعات ایستگاه‌ها...', 'info', false); // Non-dismissible initially
        try {
            const response = await fetch(STATIONS_DATA_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            stations = data; // Store globally
            populateSelects();
            initializeSelect2();
             // Dismiss the loading message on success
             const statusAlert = bootstrap.Alert.getOrCreateInstance(statusMessageDiv);
             if(statusAlert) statusAlert.close();
            return true; // Indicate success
        } catch (error) {
            console.error('Error loading station data:', error);
            showStatusMessage('خطا در بارگذاری اطلاعات ایستگاه‌ها. لطفاً اتصال اینترنت خود را بررسی کرده و صفحه را رفرش کنید.', 'danger', false); // Keep error message visible
            return false; // Indicate failure
        }
    }

    /** Populates select dropdowns with sorted station names */
    function populateSelects() {
        const stationOptions = Object.entries(stations)
            .map(([key, station]) => ({
                id: key,
                // Ensure Persian name exists, fallback to English or key
                text: station.translations?.fa || station.translations?.en || key
            }))
            // Sort stations alphabetically based on Persian names
            .sort((a, b) => a.text.localeCompare(b.text, 'fa'));

        // Clear existing options except placeholder
        sourceSelect.innerHTML = '<option value="">انتخاب کنید...</option>';
        destinationSelect.innerHTML = '<option value="">انتخاب کنید...</option>';

        // Add sorted options
        stationOptions.forEach(station => {
            const option = new Option(station.text, station.id);
            sourceSelect.appendChild(option.cloneNode(true));
            destinationSelect.appendChild(option);
        });
    }

    /** Initializes Select2 library on dropdowns */
    function initializeSelect2() {
        $('.select2-custom').select2({
            theme: "bootstrap-5",
            placeholder: "ایستگاه مورد نظر را جستجو یا انتخاب کنید...",
            allowClear: true,
            dir: "rtl",
            language: "fa", // Requires Select2 locale file for full translation
            width: '100%' // Ensure it takes full width
        });
    }

    // --- Core Logic: Routing & Display ---

    /**
     * Finds the shortest path using Breadth-First Search (BFS).
     * Returns an array of station keys representing the path, or null if no path found.
     */
    function findRouteBFS(sourceKey, destinationKey) {
        if (!stations[sourceKey] || !stations[destinationKey]) {
            console.error("Invalid source or destination key provided to BFS:", sourceKey, destinationKey);
            return null;
        }
        if (sourceKey === destinationKey) return [sourceKey]; // Path from a station to itself

        const queue = [{ station: sourceKey, path: [sourceKey] }];
        const visited = new Set([sourceKey]); // Track visited stations {stationKey}

        while (queue.length > 0) {
            const { station: currentStationKey, path: currentPath } = queue.shift();

            // Explore neighbors (relations)
            const currentStationData = stations[currentStationKey];
            if (currentStationData?.relations) {
                for (const neighborKey of currentStationData.relations) {
                    if (stations[neighborKey] && !visited.has(neighborKey)) {
                        visited.add(neighborKey);
                        const newPath = [...currentPath, neighborKey];

                        // Goal reached
                        if (neighborKey === destinationKey) {
                            return newPath; // Return the found path
                        }

                        queue.push({ station: neighborKey, path: newPath });
                    }
                }
            }
        }
        console.warn("BFS: No path found between", sourceKey, "and", destinationKey);
        return null; // No path found
    }

    /**
     * Displays the found route on the page and map.
     * @param {string[]} route - Array of station keys.
     */
        // ... (بقیه کدها و توابع مثل قبل باقی می‌مانند) ...

    /**
     * Displays the found route on the page and map with animations and line numbers.
     * @param {string[]} routePath - Array of station keys.
     */
    function displayRoute(routePath) {
        routeResultDiv.innerHTML = ''; // Clear previous results or skeleton
        routeLayerGroup.clearLayers(); // Clear previous route from map
        routeActionsDiv.classList.add('d-none'); // Hide action buttons
        mapCardDiv.classList.add('d-none'); // Hide map card

        if (!routePath || routePath.length === 0) {
            routeResultDiv.innerHTML = '<p class="alert alert-warning text-center">مسیری بین ایستگاه‌های انتخابی یافت نشد.</p>';
            return;
        }
        if (routePath.length === 1) {
            routeResultDiv.innerHTML = '<p class="alert alert-info text-center">مبدأ و مقصد یکسان است.</p>';
            const station = stations[routePath[0]];
            if (station?.latitude && station?.longitude) {
                mapCardDiv.classList.remove('d-none');
                addStationMarker(routePath[0], 'ایستگاه:', 'blue');
                map.setView([station.latitude, station.longitude], MAP_DEFAULT_ZOOM + 3);
            }
            return;
        }

        // --- 1. Build HTML for Route Steps (Similar to before) ---
        let routeHTML = `<h2 class="text-center mb-4">مسیر پیشنهادی (${routePath.length} ایستگاه)</h2>`;
        let previousLine = null;
        let currentSegmentLine = null;
        let totalTime = 0;
        const routeCoordinates = []; // Store all coordinates for bounds calculation
        let mapElements = []; // Store map layers { lineLayer, decoratorLayer, stepId } for highlighting

        routePath.forEach((stationKey, index) => {
            const station = stations[stationKey];
            if (!station) return;

            // Determine line for the current segment
            if (index > 0) {
                const prevStation = stations[routePath[index - 1]];
                currentSegmentLine = station.lines.find(line => prevStation?.lines.includes(line)) || station.lines[0];
            } else {
                currentSegmentLine = station.lines[0];
            }

             // Store coordinates
             if (station.latitude && station.longitude) {
                routeCoordinates.push([station.latitude, station.longitude]);
             }

            // Detect line change and build HTML
            if (index > 0 && previousLine !== null && currentSegmentLine !== previousLine) {
                 // Find the interchange station name
                 const interchangeStationName = stations[routePath[index-1]]?.translations?.fa || routePath[index-1];
                routeHTML += `
                    <div class="line-change" data-step-id="change-${index -1}">
                        <i class="fas fa-exchange-alt"></i>
                        تغییر خط در <strong>${interchangeStationName}</strong>:
                        از <span class="badge text-white" style="background-color: ${getLineColor(previousLine)};">خط ${previousLine}</span>
                        به <span class="badge text-white" style="background-color: ${getLineColor(currentSegmentLine)};">خط ${currentSegmentLine}</span>
                        <span class="text-muted small ms-auto">(+ ~${TIME_PER_LINE_CHANGE} دقیقه)</span>
                    </div>
                `;
                totalTime += TIME_PER_LINE_CHANGE;
            }

            // Add route step HTML
            const isStart = index === 0;
            const isEnd = index === routePath.length - 1;
            const stepClass = isStart ? 'start-station' : (isEnd ? 'end-station' : '');
            const stepId = `step-${index}`;

            routeHTML += `
                <div class="route-step ${stepClass}" data-step-id="${stepId}" data-coords="${station.latitude},${station.longitude}">
                    <span class="line-icon line-${currentSegmentLine}" style="background-color: ${getLineColor(currentSegmentLine)};">
                        ${currentSegmentLine}
                    </span>
                    <span class="station-name">${station.translations?.fa || stationKey}</span>
                    ${!isEnd ? '<i class="fas fa-arrow-down mx-2 text-muted"></i>' : ''}
                </div>
            `;

            if (index > 0) {
                totalTime += TIME_PER_STATION;
            }
            previousLine = currentSegmentLine;
        });

        // Add total estimated time HTML
        routeHTML += `<div class="travel-time"> ... </div>`; // (Same as before)
        routeResultDiv.innerHTML = routeHTML;

        // --- 2. Draw Enhanced Route on Map ---
        mapCardDiv.classList.remove('d-none'); // Show map card
        let overallBounds = L.latLngBounds([]); // To fit map view

        // Iterate through segments (pairs of coordinates) to draw animated lines and decorators
        for (let i = 0; i < routeCoordinates.length - 1; i++) {
            const startPoint = routeCoordinates[i];
            const endPoint = routeCoordinates[i + 1];
            const segmentCoords = [startPoint, endPoint];

            // Determine the line number for this specific segment
             const startStationKey = routePath[i];
             const endStationKey = routePath[i + 1];
             const startStation = stations[startStationKey];
             const endStation = stations[endStationKey];
             const segmentLineNum = endStation.lines.find(line => startStation?.lines.includes(line)) || endStation.lines[0];


            // --- a) Create Animated AntPath Polyline ---
            const antPathOptions = {
                delay: 400,          // Delay before animation starts
                dashArray: [10, 20], // Dash pattern
                weight: 6,           // Line thickness
                color: getLineColor(segmentLineNum), // Line color
                opacity: 0.85,
                pulseColor: "#FFFFFF", // Color of the animated dash/pulse
                hardwareAccelerated: true, // Use hardware acceleration if available
                // Custom options: store stepId for linking
                stepId: `step-${i + 1}` // Link segment to the step *after* it
            };
            const antPathLine = L.polyline.antPath(segmentCoords, antPathOptions).addTo(routeLayerGroup);


            // --- b) Create Polyline Decorator for Line Number ---
            const decorator = L.polylineDecorator(antPathLine, { // Decorate the antPath line itself
                patterns: [
                    {
                        offset: '50%', // Position in the middle of the segment
                        repeat: 0,     // Don't repeat on short segments
                        symbol: L.Symbol.text(String(segmentLineNum), { // Display line number as text
                            pixelSize: 12, // Font size
                            polygon: false, // Don't draw polygon background
                            pathOptions: {
                                stroke: true,
                                weight: 0.5, // Very thin stroke around text
                                color: '#000000', // Text border color (optional)
                                fill: true,
                                fillColor: '#FFFFFF', // Text color
                                fillOpacity: 1,
                                // Custom options for styling the text background (optional)
                                // Use a background shape for better visibility:
                                // L.Symbol.marker({ markerOptions: { icon: L.divIcon({className: 'line-number-label', html: String(segmentLineNum)}) }})
                            }
                        })
                    }
                    // Optionally add arrows for direction:
                    // {offset: '10%', repeat: '80px', symbol: L.Symbol.arrowHead({pixelSize: 10, pathOptions: {fillOpacity: 1, weight: 0, color: getLineColor(segmentLineNum)}})}
                ]
            }).addTo(routeLayerGroup);


             // Store layers for highlighting
             mapElements.push({
                lineLayer: antPathLine,
                decoratorLayer: decorator, // We might not need to highlight the decorator
                stepId: `step-${i + 1}`
             });

             // Extend bounds for map fitting
             overallBounds.extend(startPoint);
             overallBounds.extend(endPoint);
        }


        // --- 3. Add Markers and Fit Map ---
        if (routePath.length > 0) {
            addStationMarker(routePath[0], ' مبدأ: ', '#0d6efd'); // Primary color blue
            addStationMarker(routePath[routePath.length - 1], ' مقصد: ', '#198754'); // Success color green
        }
        if (overallBounds.isValid()) {
            map.fitBounds(overallBounds, { padding: MAP_ROUTE_ZOOM_PADDING, maxZoom: 16 }); // Avoid zooming too far in
        }

        // --- 4. Setup Hover Interactions (List <-> Map) ---
        setupListMapInteractions(mapElements);

        // --- 5. Show Action Buttons and Store Route ---
        routeActionsDiv.classList.remove('d-none');
        currentRoute = routePath; // Store for save/share/print
    }


    /** Sets up hover interactions between the route list and map elements */
    function setupListMapInteractions(mapElements) {
        const routeSteps = routeResultDiv.querySelectorAll('.route-step[data-step-id]');
        routeSteps.forEach((step) => {
            const stepId = step.getAttribute('data-step-id');
            const coords = step.getAttribute('data-coords')?.split(',');

            step.addEventListener('mouseover', () => {
                highlightMapElement(mapElements, stepId, true); // Highlight associated line segment
                 if (coords?.length === 2) highlightMapMarker(coords, true); // Highlight station marker
            });
            step.addEventListener('mouseout', () => {
                highlightMapElement(mapElements, stepId, false);
                 if (coords?.length === 2) highlightMapMarker(coords, false);
            });
        });

         // Add hover listeners to map lines (optional, might conflict with marker popups)
         mapElements.forEach(elem => {
             if (elem.lineLayer) {
                 elem.lineLayer.on('mouseover', function(e) {
                     this.setStyle({ weight: 9, opacity: 1 }); // Highlight line
                     highlightListItem(this.options.stepId, true); // Highlight corresponding list item
                     // Optional: Bring related decorator to front if needed
                     // if (elem.decoratorLayer) elem.decoratorLayer.bringToFront();
                 });
                 elem.lineLayer.on('mouseout', function(e) {
                      this.setStyle({ weight: 6, opacity: 0.85 }); // Reset style
                      highlightListItem(this.options.stepId, false);
                 });
             }
         });
    }

     /** Helper to highlight/unhighlight a map segment (AntPath) */
    function highlightMapElement(mapElements, stepId, highlight = true) {
        const element = mapElements.find(el => el.stepId === stepId);
        if (element && element.lineLayer) {
            element.lineLayer.setStyle({
                 weight: highlight ? 9 : 6, // Make line thicker on highlight
                 opacity: highlight ? 1 : 0.85
             });
              if(highlight) element.lineLayer.bringToFront();
        }
    }

    /** Helper to highlight/unhighlight a list item by adding/removing a CSS class */
    function highlightListItem(stepId, highlight = true) {
         const listItem = routeResultDiv.querySelector(`[data-step-id='${stepId}']`);
         if (listItem) {
             if (highlight) {
                listItem.classList.add('highlighted'); // Add class
             } else {
                listItem.classList.remove('highlighted'); // Remove class
             }
         }
    }

     // --- (Make sure addStationMarker, getLineColor, showStatusMessage, etc. are defined as before) ---
     // --- (Make sure Event Listeners for buttons, dark mode etc. are defined as before) ---
     // --- (Make sure Initialization calls are defined as before) ---

    /** Helper to add styled markers to the map */
    function addStationMarker(stationKey, prefix = '', markerColor = 'red') {
        const station = stations[stationKey];
        if (station?.latitude && station?.longitude) {
            const marker = L.circleMarker([station.latitude, station.longitude], {
                radius: 8,
                fillColor: markerColor, // Use passed color
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.95, // Slightly more opaque
                stationKey: stationKey,
                interactive: true // Ensure marker is interactive
            }).addTo(routeLayerGroup);

            marker.bindPopup(`<b>${prefix}</b>${station.translations?.fa || stationKey}`, {closeButton: false, autoPan: false});
             // Highlight on hover
            marker.on('mouseover', function (e) {
                 this.openPopup();
                 this.setRadius(11); // Increase size
                 this.bringToFront();
                 // Also highlight corresponding list item if possible
                 const stepElem = routeResultDiv.querySelector(`[data-coords^="${this.getLatLng().lat},${this.getLatLng().lng}"]`);
                 if(stepElem) highlightListItem(stepElem.getAttribute('data-step-id'), true);

            });
            marker.on('mouseout', function (e) {
                 this.closePopup();
                 this.setRadius(8); // Reset size
                  const stepElem = routeResultDiv.querySelector(`[data-coords^="${this.getLatLng().lat},${this.getLatLng().lng}"]`);
                 if(stepElem) highlightListItem(stepElem.getAttribute('data-step-id'), false);
            });
        }
    }

      /** Helper to highlight/unhighlight a map marker by coordinates */
     function highlightMapMarker(coords, highlight = true) {
        // ... (implementation from previous response is fine) ...
         if (!coords || coords.length !== 2) return;
         const lat = parseFloat(coords[0]);
         const lng = parseFloat(coords[1]);
         routeLayerGroup.eachLayer(layer => {
             if (layer instanceof L.CircleMarker) {
                 const layerLatLng = layer.getLatLng();
                 if (Math.abs(layerLatLng.lat - lat) < 0.00001 && Math.abs(layerLatLng.lng - lng) < 0.00001) {
                     layer.setRadius(highlight ? 11 : 8);
                     if(highlight) {
                         layer.bringToFront();
                         layer.openPopup(); // Optionally open popup on hover
                     } else {
                        // layer.closePopup(); // Close popup on mouseout
                     }
                 }
             }
         });
     }

    // --- Run Initializations ---
    // ... (same initialization flow as before) ...
    setFooterYear();
    initializeMap();
    initializeDarkMode();
    loadStationData().then(success => {
        if (success) {
            checkUrlForRoute();
        }
    });


}); // End DOMContentLoaded
