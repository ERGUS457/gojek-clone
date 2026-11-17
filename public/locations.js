// Jakarta Locations Seed & Helpers
const JAKARTA_LOCATIONS = [
  {
    name: 'Monumen Nasional (Monas)',
    address: 'Gambir, Jakarta Pusat',
    lat: -6.1754,
    lng: 106.8272
  },
  {
    name: 'Grand Indonesia Mall',
    address: 'Jl. M.H. Thamrin No.1, Kb. Melati',
    lat: -6.1954,
    lng: 106.8218
  },
  {
    name: 'Stasiun Gambir',
    address: 'Jl. Medan Merdeka Tim. No.1, Gambir',
    lat: -6.1767,
    lng: 106.8306
  },
  {
    name: 'Pacific Place / SCBD',
    address: 'Jl. Jend. Sudirman Kav. 52-53, Senayan',
    lat: -6.2255,
    lng: 106.8097
  },
  {
    name: 'Senayan City Mall',
    address: 'Jl. Asia Afrika No.19, Gelora',
    lat: -6.2272,
    lng: 106.7974
  },
  {
    name: 'Stasiun MRT Blok M',
    address: 'Kebayoran Baru, Jakarta Selatan',
    lat: -6.2443,
    lng: 106.7979
  },
  {
    name: 'Kota Kasablanka (Kokas)',
    address: 'Jl. Casablanca Raya Kav. 88, Menteng Dalam',
    lat: -6.2239,
    lng: 106.8431
  },
  {
    name: 'Stasiun Manggarai',
    address: 'Tebet, Jakarta Selatan',
    lat: -6.2100,
    lng: 106.8500
  }
];

// Utility: Format currency to IDR (e.g. Rp 14.500)
function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// Utility: Calculate Distance in KM
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

// Generate intermediate waypoint path between 2 coordinates for smooth simulation
function generateRouteSteps(start, end, numSteps = 25) {
  const steps = [];
  // Add a slight realistic curve jitter
  const midLat = (start.lat + end.lat) / 2 + (Math.random() - 0.5) * 0.002;
  const midLng = (start.lng + end.lng) / 2 + (Math.random() - 0.5) * 0.002;

  // Quadratic bezier interpolation for realistic road curve
  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const invT = 1 - t;
    const lat = invT * invT * start.lat + 2 * invT * t * midLat + t * t * end.lat;
    const lng = invT * invT * start.lng + 2 * invT * t * midLng + t * t * end.lng;
    steps.push({ lat, lng });
  }
  return steps;
}

// Fetch real address from coordinates via backend reverse geocoder
async function fetchRealAddress(lat, lng) {
  try {
    const res = await fetch(`/api/locations/reverse?lat=${lat}&lng=${lng}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Reverse geocoding error:', e);
  }
  return {
    name: `Titik GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    address: 'Koordinat GPS Terpilih',
    lat,
    lng
  };
}

// Search real address by query string via backend geocoder
async function searchRealAddress(query) {
  try {
    const res = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Geocoding search error:', e);
  }
  return [];
}

window.JAKARTA_LOCATIONS = JAKARTA_LOCATIONS;
window.formatRupiah = formatRupiah;
window.calcDistance = calcDistance;
window.generateRouteSteps = generateRouteSteps;
window.fetchRealAddress = fetchRealAddress;
window.searchRealAddress = searchRealAddress;
