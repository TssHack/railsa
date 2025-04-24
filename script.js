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
            // Optionally show the single station on map
            const station = stations[routePath[0]];
             if (station?.latitude && station?.longitude) {
                 mapCardDiv.classList.remove('d-none'); // Show map card
                 addStationMarker(routePath[0], 'ایستگاه:', 'blue');
                 map.setView([station.latitude, station.longitude], MAP_DEFAULT_ZOOM + 3);
             }
            return;
        }


        let routeHTML = `<h2 class="text-center mb-4">مسیر پیشنهادی (${routePath.length} ایستگاه)</h2>`;
        let previousLine = null;
        let currentSegmentLine = null;
        let totalTime = 0;
        const routeCoordinates = [];
        let segmentData = []; // Store { coords: [[lat,lng],[lat,lng]], line: number, stepId: string }

        // Build route steps HTML and prepare map data
        routePath.forEach((stationKey, index) => {
            const station = stations[stationKey];
            if (!station) {
                console.error("Missing station data for key:", stationKey);
                return; // Skip this step if data is missing
            }

            // Determine the line for the current segment
            if (index > 0) {
                const prevStationKey = routePath[index - 1];
                const prevStation = stations[prevStationKey];
                 // Find a common line between current and previous station for this segment
                currentSegmentLine = station.lines.find(line => prevStation?.lines.includes(line)) || station.lines[0];
            } else {
                currentSegmentLine = station.lines[0]; // First station's primary line
            }

            // Add station coordinates for map polyline segments
             if (station.latitude && station.longitude) {
                routeCoordinates.push([station.latitude, station.longitude]);
                 // Create segment data for map highlighting
                 if (index > 0) {
                     const prevCoords = routeCoordinates[routeCoordinates.length - 2]; // Get previous coord
                     segmentData.push({
                         coords: [prevCoords, [station.latitude, station.longitude]],
                         line: previousLine, // The line used *before* arriving at current station
                         stepId: `step-${index}` // Link segment to the step *after* it
                     });
                 }
             }

            // Detect line change: Occurs *at* the current station if its line differs from the previous segment's line
            if (previousLine !== null && currentSegmentLine !== previousLine) {
                routeHTML += `
                    <div class="line-change" data-step-id="change-${index}">
                        <i class="fas fa-exchange-alt"></i>
                        تغییر خط در <strong>${station.translations?.fa || stationKey}</strong>:
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
            const stepId = `step-${index}`; // Unique ID for interaction

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
                totalTime += TIME_PER_STATION; // Add time for travel from previous station
            }
            previousLine = currentSegmentLine; // Update line for the next segment calculation
        });

        // Add total estimated time
        routeHTML += `
            <div class="travel-time">
                <i class="fas fa-clock"></i> زمان تقریبی کل سفر: ${totalTime} دقیقه
            </div>
        `;
        routeResultDiv.innerHTML = routeHTML; // Display generated HTML

        // --- Draw on Map ---
        mapCardDiv.classList.remove('d-none'); // Show map card
        let overallBounds = L.latLngBounds([]); // To fit map view

        // Draw segments first for highlighting
        segmentData.forEach((segment) => {
             const segmentLine = L.polyline(segment.coords, {
                 color: getLineColor(segment.line),
                 weight: 6,
                 opacity: 0.85,
                 stepId: segment.stepId // Store related step ID
             }).addTo(routeLayerGroup);

              // Extend bounds for map fitting
              overallBounds.extend(segment.coords[0]);
              overallBounds.extend(segment.coords[1]);

             // Add hover effect on map polyline segment
             segmentLine.on('mouseover', function (e) {
                 this.setStyle({ weight: 9, opacity: 1 });
                 highlightListItem(this.options.stepId, true);
             });
             segmentLine.on('mouseout', function (e) {
                 this.setStyle({ weight: 6, opacity: 0.85 });
                 highlightListItem(this.options.stepId, false);
             });
        });

        // Add Markers for Start and End
        if (routePath.length > 0) {
            addStationMarker(routePath[0], ' مبدأ: ', 'blue');
            addStationMarker(routePath[routePath.length - 1], ' مقصد: ', 'green');
        }

        // Fit map view to the route bounds
        if (overallBounds.isValid()) {
             map.fitBounds(overallBounds, { padding: MAP_ROUTE_ZOOM_PADDING });
        } else if (routeCoordinates.length === 1) {
             // Handle single point case (start=end) - already handled above
             map.setView(routeCoordinates[0], MAP_DEFAULT_ZOOM + 3);
        }


        // --- Add Hover Listeners to List Items for Map Interaction ---
        const routeSteps = routeResultDiv.querySelectorAll('.route-step[data-step-id]');
        routeSteps.forEach((step, index) => {
            step.addEventListener('mouseover', () => {
                // Highlight the segment *leading* to this step
                const segmentStepId = `step-${index}`;
                highlightMapSegment(segmentStepId, true);
                // Highlight the marker *at* this step
                const coords = step.getAttribute('data-coords').split(',');
                 if (coords.length === 2) {
                     highlightMapMarker(coords, true);
                 }

            });
            step.addEventListener('mouseout', () => {
                const segmentStepId = `step-${index}`;
                highlightMapSegment(segmentStepId, false);
                 const coords = step.getAttribute('data-coords').split(',');
                 if (coords.length === 2) {
                     highlightMapMarker(coords, false);
                 }
            });
        });

        // Show action buttons
        routeActionsDiv.classList.remove('d-none');
        // Store the current route for actions
        currentRoute = routePath;
    }


    /** Helper to add styled markers to the map */
    function addStationMarker(stationKey, prefix = '', iconColor = 'red') {
        const station = stations[stationKey];
        if (station?.latitude && station?.longitude) {
            // Create a simple circle marker
            const marker = L.circleMarker([station.latitude, station.longitude], {
                radius: 8,
                fillColor: iconColor,
                color: "#fff", // White border
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9,
                stationKey: stationKey // Store key for potential future use
            }).addTo(routeLayerGroup);

            marker.bindPopup(`<b>${prefix}</b>${station.translations?.fa || stationKey}`, {closeButton: false});
            marker.on('mouseover', function (e) { this.openPopup(); this.setRadius(10); });
            marker.on('mouseout', function (e) { this.closePopup(); this.setRadius(8); });
        }
    }

    /** Helper to highlight/unhighlight a list item */
    function highlightListItem(stepId, highlight = true) {
         const listItem = routeResultDiv.querySelector(`[data-step-id='${stepId}']`);
         if (listItem) {
            // Using CSS classes for highlighting is cleaner
             if (highlight) {
                listItem.classList.add('highlighted');
             } else {
                listItem.classList.remove('highlighted');
             }
             // listItem.style.backgroundColor = highlight ? 'var(--light-hover-bg, #e0e0e0)' : '';
             // listItem.style.transform = highlight ? 'scale(1.02)' : 'scale(1)';
         }
    }
     /** Helper to highlight/unhighlight a map segment */
    function highlightMapSegment(stepId, highlight = true) {
         routeLayerGroup.eachLayer(layer => {
            if (layer instanceof L.Polyline && layer.options.stepId === stepId) {
                 layer.setStyle({
                     weight: highlight ? 9 : 6,
                     opacity: highlight ? 1 : 0.85
                 });
                 if(highlight) layer.bringToFront();
            }
        });
    }
      /** Helper to highlight/unhighlight a map marker by coordinates */
    function highlightMapMarker(coords, highlight = true) {
        if (!coords || coords.length !== 2) return;
         const lat = parseFloat(coords[0]);
         const lng = parseFloat(coords[1]);
         routeLayerGroup.eachLayer(layer => {
             if (layer instanceof L.CircleMarker) {
                 const layerLatLng = layer.getLatLng();
                 // Compare with tolerance due to potential float precision issues
                 if (Math.abs(layerLatLng.lat - lat) < 0.00001 && Math.abs(layerLatLng.lng - lng) < 0.00001) {
                     layer.setRadius(highlight ? 11 : 8);
                     if(highlight) layer.bringToFront();
                 }
             }
         });
    }


    /** Gets the color for a specific metro line */
    function getLineColor(line) {
        // Ensure line is treated as a number if it's passed as string
        const lineNum = parseInt(line, 10);
        const lineColors = {
            1: '#E0001F', // Red
            2: '#2F4389', // Dark Blue
            3: '#67C5F5', // Light Blue
            4: '#F8E100', // Yellow
            5: '#007E46', // Green
            6: '#EF639F', // Pink
            7: '#7F0B74', // Purple
        };
        return lineColors[lineNum] || '#777777'; // Default grey
    }

    /** Shows status messages to the user */
    function showStatusMessage(message, type = 'info', autoDismiss = true) {
        statusTextSpan.textContent = message;
        // Set class for alert type
        statusMessageDiv.className = `alert alert-${type} alert-dismissible fade show`;
        statusMessageDiv.classList.remove('d-none'); // Make it visible

        // Auto-dismiss logic
        if (autoDismiss) {
            setTimeout(() => {
                const bsAlert = bootstrap.Alert.getOrCreateInstance(statusMessageDiv);
                if (bsAlert && statusMessageDiv.classList.contains('show')) {
                    bsAlert.close();
                }
            }, 5000); // Dismiss after 5 seconds
        }
    }

    /** Copies text to clipboard */
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text)
            .then(() => showStatusMessage('مسیر در کلیپ‌بورد کپی شد!', 'success'))
            .catch(err => {
                console.error('Clipboard copy failed:', err);
                showStatusMessage('خطا در کپی کردن مسیر. لطفاً دستی کپی کنید.', 'danger');
                // As a fallback, could display the text in a modal for manual copy
            });
    }

    // --- Event Listeners ---

    // Find Route Button Click
    findRouteButton.addEventListener('click', function () {
        const sourceKey = sourceSelect.value;
        const destinationKey = destinationSelect.value;

        // Basic Validation
        if (!sourceKey || !destinationKey) {
            showStatusMessage('لطفاً ایستگاه مبدأ و مقصد را انتخاب کنید.', 'warning');
            return;
        }
        // Note: Same source/destination is handled within displayRoute now.

        // Show Skeleton Loader
        routeResultDiv.innerHTML = ''; // Clear previous content first
        skeletonLoaderDiv.classList.remove('d-none');
        routeResultDiv.appendChild(skeletonLoaderDiv); // Ensure skeleton is inside
        routeActionsDiv.classList.add('d-none'); // Hide actions
        routeLayerGroup.clearLayers(); // Clear map layers
        mapCardDiv.classList.add('d-none'); // Hide map card
        currentRoute = null; // Reset current route

        // Perform calculation after a short delay to allow UI update
        setTimeout(() => {
            const routePath = findRouteBFS(sourceKey, destinationKey);
            skeletonLoaderDiv.classList.add('d-none'); // Hide skeleton
             if (routeResultDiv.contains(skeletonLoaderDiv)) {
                 routeResultDiv.removeChild(skeletonLoaderDiv); // Remove skeleton from DOM
             }
            displayRoute(routePath); // Display results (or 'no route' message)
        }, 400); // Delay to ensure skeleton visibility
    });

    // Dark Mode Toggle Click
    darkModeToggle.addEventListener('click', function () {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        if (isDarkMode) {
            darkModeIcon.classList.replace('fa-moon', 'fa-sun');
            localStorage.setItem('theme', 'dark');
        } else {
            darkModeIcon.classList.replace('fa-sun', 'fa-moon');
            localStorage.setItem('theme', 'light');
        }
         // Note: Map tiles don't automatically switch theme unless using specific tile provider/plugin
    });

    // Save Route Button Click
    saveRouteButton.addEventListener('click', function () {
        if (!currentRoute) {
            showStatusMessage('ابتدا باید مسیری را پیدا کنید.', 'warning');
            return;
        }
        const sourceKey = sourceSelect.value; // Get current selection
        const destinationKey = destinationSelect.value;

         // Basic check if route matches current selection (might be redundant if findRoute is always clicked first)
         if (!currentRoute || currentRoute[0] !== sourceKey || currentRoute[currentRoute.length - 1] !== destinationKey) {
              showStatusMessage('مسیر نمایش داده شده با انتخاب فعلی مطابقت ندارد. لطفاً دوباره مسیر را پیدا کنید.', 'warning');
              return;
         }

        // Avoid saving duplicates (simple check)
        const exists = savedRoutes.some(r => r.source === sourceKey && r.destination === destinationKey);
        if (!exists) {
            const sourceName = stations[sourceKey]?.translations?.fa || sourceKey;
            const destName = stations[destinationKey]?.translations?.fa || destinationKey;
            savedRoutes.push({
                source: sourceKey,
                sourceName: sourceName,
                destination: destinationKey,
                destinationName: destName,
                route: currentRoute // Save the calculated path
            });
            try {
                 localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes));
                 showStatusMessage(`مسیر ${sourceName} به ${destName} ذخیره شد.`, 'success');
            } catch (e) {
                 console.error("Error saving to localStorage:", e);
                 showStatusMessage('خطا در ذخیره‌سازی مسیر. (ممکن است حافظه پر باشد)', 'danger');
            }
        } else {
            showStatusMessage('این مسیر قبلاً ذخیره شده است.', 'info');
        }
    });

    // Share Route Button Click
    shareRouteButton.addEventListener('click', function () {
         if (!currentRoute) {
            showStatusMessage('ابتدا باید مسیری را پیدا کنید.', 'warning');
            return;
        }
        const sourceKey = currentRoute[0];
        const destinationKey = currentRoute[currentRoute.length - 1];
        const sourceName = stations[sourceKey]?.translations?.fa || sourceKey;
        const destName = stations[destinationKey]?.translations?.fa || destinationKey;

        // Generate text summary
        const routeText = currentRoute.map(key => stations[key]?.translations?.fa || key).join(' -> ');
        // Generate shareable URL
        const shareUrl = `${window.location.origin}${window.location.pathname}?source=${encodeURIComponent(sourceKey)}&destination=${encodeURIComponent(destinationKey)}`;
        // Combine text and URL
        const shareContent = `مسیر مترو تهران از ${sourceName} به ${destName}:\n${routeText}\n\nمشاهده آنلاین مسیر:\n${shareUrl}\n\n(ایجاد شده توسط ریل ثا)`;

        if (navigator.share) { // Use Web Share API if available
            navigator.share({
                title: `مسیر مترو: ${sourceName} به ${destName}`,
                text: shareContent,
                // url: shareUrl // URL included in text is often better for cross-platform compatibility
            })
            .then(() => console.log('Successful share'))
            .catch((error) => {
                 console.error('Share failed:', error);
                 // Fallback to clipboard only if share API exists but fails
                 copyToClipboard(shareContent);
            });
        } else { // Fallback to clipboard if Web Share API not supported
            copyToClipboard(shareContent);
        }
    });

    // Print Route Button Click
    printRouteButton.addEventListener('click', function () {
         if (!currentRoute) {
            showStatusMessage('ابتدا باید مسیری را پیدا کنید.', 'warning');
            return;
        }
        window.print(); // Uses CSS @media print rules
    });

    /** Checks URL for route parameters on page load */
    function checkUrlForRoute() {
        const urlParams = new URLSearchParams(window.location.search);
        const sourceParam = urlParams.get('source');
        const destParam = urlParams.get('destination');

        if (sourceParam && destParam && stations[sourceParam] && stations[destParam]) {
             console.log("Loading route from URL parameters:", sourceParam, destParam);
            // Set the values in the select dropdowns using Select2's API
             $('#source').val(sourceParam).trigger('change');
             $('#destination').val(destParam).trigger('change');

            // Automatically find and display the route
             // Use a timeout to ensure Select2 updates visually and data is ready
            setTimeout(() => {
                 findRouteButton.click(); // Simulate click
                 showStatusMessage('مسیر اشتراک گذاشته شده بارگذاری شد.', 'info');
            }, 500); // Adjust delay if needed
        }
    }

    // --- Run Initializations ---
    setFooterYear();
    initializeMap(); // Initialize map structure first
    initializeDarkMode();
    // Load station data, then check URL params
    loadStationData().then(success => {
        if (success) {
            checkUrlForRoute();
        }
    });

}); // End DOMContentLoaded

