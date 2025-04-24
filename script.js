document.addEventListener('DOMContentLoaded', function () {
    // Element References
    const sourceSelect = document.getElementById('source');
    const destinationSelect = document.getElementById('destination');
    const findRouteButton = document.getElementById('find-route');
    const saveRouteButton = document.getElementById('save-route');
    const shareRouteButton = document.getElementById('share-route');
    const printRouteButton = document.getElementById('print-route');
    const routeResultDiv = document.getElementById('route-result');
    const routeActionsDiv = document.getElementById('route-actions');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const darkModeIcon = darkModeToggle.querySelector('i');
    const statusMessageDiv = document.getElementById('status-message');
    const statusTextSpan = document.getElementById('status-text');
    const currentYearSpan = document.getElementById('current-year');

    // Constants
    const TIME_PER_STATION = 2; // minutes
    const TIME_PER_LINE_CHANGE = 5; // minutes
    const MAP_CENTER = [35.6892, 51.3890]; // Tehran coordinates
    const MAP_ZOOM = 11;
    const STATIONS_DATA_URL = 'https://m4tinbeigi-official.github.io/tehran-metro-data/data/stations.json'; // URL داده‌های ایستگاه‌ها

    // State Variables
    let stations = {};
    let map = null; // Map instance
    let routeLayerGroup = null; // Layer group for route lines and markers
    let savedRoutes = JSON.parse(localStorage.getItem('savedRoutes')) || [];

    // --- Initialization ---

    // Set current year in footer
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }

    // Initialize Map
    function initializeMap() {
        if (map) {
            map.remove(); // Remove previous map instance if exists
        }
        map = L.map('map').setView(MAP_CENTER, MAP_ZOOM);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18,
        }).addTo(map);
        routeLayerGroup = L.layerGroup().addTo(map); // Initialize layer group for routes
    }

    // Initialize Dark Mode based on preference or system setting
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

    // Fetch and process station data
    async function loadStationData() {
        try {
            const response = await fetch(STATIONS_DATA_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log("Station data loaded:", data); // Log data for debugging
            stations = data;
            populateSelects();
            initializeSelect2();
        } catch (error) {
            console.error('Error loading station data:', error);
            showStatusMessage('خطا در بارگذاری اطلاعات ایستگاه‌ها. لطفاً صفحه را رفرش کنید.', 'danger');
        }
    }

    // Populate select dropdowns with sorted station names
    function populateSelects() {
        const stationOptions = Object.entries(stations)
            .map(([key, station]) => ({
                id: key,
                text: station.translations?.fa || key // Use Persian name or key as fallback
            }))
            .sort((a, b) => a.text.localeCompare(b.text, 'fa')); // Sort alphabetically in Persian

        stationOptions.forEach(station => {
            const option = new Option(station.text, station.id);
            sourceSelect.appendChild(option.cloneNode(true));
            destinationSelect.appendChild(option);
        });
    }

    // Initialize Select2 library on dropdowns
    function initializeSelect2() {
        $('.select2').select2({
            theme: "bootstrap-5", // Use Bootstrap 5 theme
            placeholder: "انتخاب کنید...",
            allowClear: true,
            dir: "rtl", // Set direction for Select2
             language: "fa" // Optional: if locale file loaded
        });
    }

    // --- Core Logic ---

    // Find the shortest path using Breadth-First Search (BFS)
    function findRouteBFS(sourceKey, destinationKey) {
        if (!stations[sourceKey] || !stations[destinationKey]) {
            console.error("Invalid source or destination key");
            return null;
        }

        const queue = [{ station: sourceKey, path: [sourceKey], lines: stations[sourceKey].lines }];
        const visited = new Set([sourceKey]); // Track visited stations to prevent loops

        while (queue.length > 0) {
            const current = queue.shift();
            const currentStationKey = current.station;
            const currentPath = current.path;

            // Goal reached
            if (currentStationKey === destinationKey) {
                return currentPath; // Return the found path
            }

            const currentStationData = stations[currentStationKey];

            // Explore neighbors (relations)
            if (currentStationData.relations) {
                currentStationData.relations.forEach(neighborKey => {
                    if (stations[neighborKey] && !visited.has(neighborKey)) {
                        visited.add(neighborKey);
                        const newPath = [...currentPath, neighborKey];
                        queue.push({
                            station: neighborKey,
                            path: newPath,
                            lines: stations[neighborKey].lines
                        });
                    }
                });
            }
        }

        return null; // No path found
    }

    // Display the found route on the page and map
    function displayRoute(route) {
        routeResultDiv.innerHTML = ''; // Clear previous results
        routeLayerGroup.clearLayers(); // Clear previous route from map
        routeActionsDiv.classList.add('d-none'); // Hide action buttons initially

        if (!route || route.length === 0) {
            routeResultDiv.innerHTML = '<p class="alert alert-warning text-center">مسیری بین ایستگاه‌های انتخابی یافت نشد.</p>';
            return;
        }

        let routeHTML = `<h2 class="text-center mb-4">مسیر پیشنهادی (${route.length} ایستگاه)</h2>`;
        let previousLine = null;
        let currentLine = null;
        let totalTime = 0;
        const routeCoordinates = [];

        route.forEach((stationKey, index) => {
            const station = stations[stationKey];
            if (!station) return; // Skip if station data is missing

            // Determine the current line (handle interchanges)
            if (index > 0) {
                const prevStation = stations[route[index - 1]];
                // Find common line between current and previous station for segment color
                currentLine = station.lines.find(line => prevStation.lines.includes(line)) || station.lines[0];
            } else {
                currentLine = station.lines[0]; // First station line
            }

            // Add station coordinates for map polyline
             if (station.latitude && station.longitude) {
                routeCoordinates.push([station.latitude, station.longitude]);
             }

            // Detect line change
            if (previousLine !== null && currentLine !== previousLine) {
                routeHTML += `
                    <div class="line-change">
                        <i class="fas fa-exchange-alt"></i>
                        تغییر خط از <span class="badge" style="background-color: ${getLineColor(previousLine)};">خط ${previousLine}</span>
                        به <span class="badge" style="background-color: ${getLineColor(currentLine)};">خط ${currentLine}</span>
                        (زمان تقریبی: ${TIME_PER_LINE_CHANGE} دقیقه)
                    </div>
                `;
                totalTime += TIME_PER_LINE_CHANGE; // Add time for line change
            }

            // Add route step HTML
            const isStart = index === 0;
            const isEnd = index === route.length - 1;
            const stepClass = isStart ? 'start-station' : (isEnd ? 'end-station' : '');

            routeHTML += `
                <div class="route-step ${stepClass}">
                    <span class="line-icon line-${currentLine}" style="background-color: ${getLineColor(currentLine)};">
                        ${currentLine}
                    </span>
                    <span class="station-name">${station.translations?.fa || stationKey}</span>
                    ${!isEnd ? '<i class="fas fa-arrow-down mx-2 text-muted"></i>' : ''}
                </div>
            `;

            if (index > 0) {
                totalTime += TIME_PER_STATION; // Add time for travel between stations
            }
            previousLine = currentLine; // Update previous line for next iteration
        });

        // Add total estimated time
        routeHTML += `
            <div class="travel-time">
                <i class="fas fa-clock"></i> زمان تقریبی کل سفر: ${totalTime} دقیقه
            </div>
        `;
        routeResultDiv.innerHTML = routeHTML;

        // Display route on map
        if (routeCoordinates.length > 1) {
            const polyline = L.polyline(routeCoordinates, {
                color: getLineColor(stations[route[0]].lines[0]), // Use color of the first line initially
                weight: 5,
                opacity: 0.8
            }).addTo(routeLayerGroup);
            map.fitBounds(polyline.getBounds(), { padding: [50, 50] }); // Adjust map view to fit route
        }

         // Add markers for start and end stations
        addStationMarker(route[0], ' مبدأ: ', 'blue');
        addStationMarker(route[route.length - 1], ' مقصد: ', 'green');


        routeActionsDiv.classList.remove('d-none'); // Show action buttons
    }

     // Helper to add markers to the map
    function addStationMarker(stationKey, prefix = '', markerColor = 'red') {
        const station = stations[stationKey];
        if (station && station.latitude && station.longitude) {
            // Create a custom icon (optional, otherwise default Leaflet icon)
            // const customIcon = L.icon({ ... }); // Define custom icon if needed

            const marker = L.marker([station.latitude, station.longitude], {
                 // icon: customIcon // Use custom icon if defined
            }).addTo(routeLayerGroup);

            marker.bindPopup(`<b>${prefix}</b>${station.translations?.fa || stationKey}`);
            // marker.on('mouseover', function (e) { this.openPopup(); });
            // marker.on('mouseout', function (e) { this.closePopup(); });
        }
    }

    // Get color for a specific metro line
    function getLineColor(line) {
        const lineColors = {
            1: '#E0001F', // Red
            2: '#2F4389', // Dark Blue
            3: '#67C5F5', // Light Blue
            4: '#F8E100', // Yellow
            5: '#007E46', // Green
            6: '#EF639F', // Pink
            7: '#7F0B74', // Purple
            // Add more lines if needed
        };
        return lineColors[line] || '#777777'; // Default grey color
    }

    // Show status messages to the user
    function showStatusMessage(message, type = 'info') { // types: primary, secondary, success, danger, warning, info, light, dark
        statusTextSpan.textContent = message;
        statusMessageDiv.className = `alert alert-${type} alert-dismissible fade show`; // Reset classes
        statusMessageDiv.classList.remove('d-none');

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(statusMessageDiv);
            if (bsAlert) {
                bsAlert.close();
            }
        }, 5000);
    }

    // --- Event Listeners ---

    // Find Route Button Click
    findRouteButton.addEventListener('click', function () {
        const sourceKey = sourceSelect.value;
        const destinationKey = destinationSelect.value;

        if (!sourceKey || !destinationKey) {
            showStatusMessage('لطفاً ایستگاه مبدأ و مقصد را انتخاب کنید.', 'warning');
            return;
        }
        if (sourceKey === destinationKey) {
             showStatusMessage('ایستگاه مبدأ و مقصد نمی‌توانند یکسان باشند.', 'warning');
            return;
        }

        // Optional: Show loading state
        routeResultDiv.innerHTML = '<div class="text-center p-3"><i class="fas fa-spinner fa-spin fa-2x"></i><p>در حال جستجوی مسیر...</p></div>';
        routeActionsDiv.classList.add('d-none');

        // Use setTimeout to allow UI update before potentially long calculation
        setTimeout(() => {
            const route = findRouteBFS(sourceKey, destinationKey);
            displayRoute(route);
        }, 50); // Small delay
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
        // Re-initialize map to potentially apply dark theme tiles if available/configured
        // initializeMap(); // Uncomment if you have dark map tiles
    });

    // Save Route Button Click
    saveRouteButton.addEventListener('click', function () {
        const sourceKey = sourceSelect.value;
        const destinationKey = destinationSelect.value;
        const currentRoute = findRouteBFS(sourceKey, destinationKey); // Recalculate to be sure

        if (currentRoute) {
            // Avoid saving duplicates (simple check based on source/dest)
            const exists = savedRoutes.some(r => r.source === sourceKey && r.destination === destinationKey);
            if (!exists) {
                savedRoutes.push({
                    source: sourceKey,
                    sourceName: stations[sourceKey]?.translations?.fa || sourceKey,
                    destination: destinationKey,
                    destinationName: stations[destinationKey]?.translations?.fa || destinationKey,
                    route: currentRoute
                });
                localStorage.setItem('savedRoutes', JSON.stringify(savedRoutes));
                showStatusMessage('مسیر با موفقیت ذخیره شد!', 'success');
            } else {
                showStatusMessage('این مسیر قبلاً ذخیره شده است.', 'info');
            }
        } else {
             showStatusMessage('خطا: امکان ذخیره مسیر وجود ندارد.', 'danger');
        }
    });

    // Share Route Button Click
    shareRouteButton.addEventListener('click', function () {
        const sourceKey = sourceSelect.value;
        const destinationKey = destinationSelect.value;

        if (!sourceKey || !destinationKey) {
            showStatusMessage('لطفاً ابتدا یک مسیر پیدا کنید.', 'warning');
            return;
        }

        const route = findRouteBFS(sourceKey, destinationKey);
        if (route) {
            const sourceName = stations[sourceKey]?.translations?.fa || sourceKey;
            const destName = stations[destinationKey]?.translations?.fa || destinationKey;
            const routeText = route.map(stationKey => stations[stationKey]?.translations?.fa || stationKey).join(' -> ');
            // Construct URL with query parameters
            const shareUrl = `${window.location.origin}${window.location.pathname}?source=${encodeURIComponent(sourceKey)}&destination=${encodeURIComponent(destinationKey)}`;
            const shareContent = `مسیر مترو تهران از ${sourceName} به ${destName}:\n${routeText}\n\nمشاهده مسیر: ${shareUrl}\n\n(ایجاد شده توسط ریل ثا)`;

            if (navigator.share) { // Use Web Share API if available
                navigator.share({
                    title: `مسیر مترو از ${sourceName} به ${destName}`,
                    text: shareContent,
                    url: shareUrl,
                })
                .then(() => showStatusMessage('مسیر به اشتراک گذاشته شد!', 'success'))
                .catch((error) => {
                    console.error('خطا در اشتراک گذاری:', error);
                    // Fallback to clipboard if share fails or is cancelled
                    copyToClipboard(shareContent);
                });
            } else { // Fallback to clipboard
                copyToClipboard(shareContent);
            }
        } else {
            showStatusMessage('خطا: امکان اشتراک‌گذاری مسیر وجود ندارد.', 'danger');
        }
    });

     // Helper function to copy text to clipboard
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text)
            .then(() => showStatusMessage('مسیر در کلیپ‌بورد کپی شد!', 'success'))
            .catch(err => {
                console.error('خطا در کپی کردن:', err);
                showStatusMessage('خطا در کپی کردن مسیر در کلیپ‌بورد.', 'danger');
            });
    }

    // Print Route Button Click
    printRouteButton.addEventListener('click', function () {
        window.print(); // Uses CSS @media print rules for formatting
    });

     // Check for query parameters on page load to potentially pre-fill a shared route
    function checkUrlForRoute() {
        const urlParams = new URLSearchParams(window.location.search);
        const sourceParam = urlParams.get('source');
        const destParam = urlParams.get('destination');

        if (sourceParam && destParam && stations[sourceParam] && stations[destParam]) {
            // Set the values in the select dropdowns
            // Use jQuery's val() and trigger('change') for Select2 compatibility
             $('#source').val(sourceParam).trigger('change');
             $('#destination').val(destParam).trigger('change');

            // Find and display the route
             // Use a small timeout to ensure Select2 updates visually first
            setTimeout(() => {
                 findRouteButton.click();
                 showStatusMessage('مسیر به اشتراک گذاشته شده بارگذاری شد.', 'info');
            }, 200);
        }
    }

    // --- Run Initialization ---
    initializeMap();
    initializeDarkMode();
    loadStationData().then(() => {
        // Check for shared route in URL only after stations are loaded
        checkUrlForRoute();
    });

}); // End DOMContentLoaded
